import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { after, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(
  root,
  "skills",
  "loop-compass",
  "scripts",
  "redact-check.mjs",
);

function run(project, mode = "enforce") {
  git(project, "add", ".loopcompass");
  const staged = git(project, "diff", "--cached", "--quiet", { allowFailure: true });
  if (staged.status !== 0) git(project, "commit", "-m", "test state");
  return spawnSync(
    process.execPath,
    [checker, "--project", project, "--mode", mode],
    { encoding: "utf8" },
  );
}

function git(project, ...input) {
  let options = {};
  if (
    input.length &&
    typeof input[input.length - 1] === "object" &&
    !Array.isArray(input[input.length - 1])
  ) {
    options = input.pop();
  }
  const result = spawnSync("git", input, {
    cwd: project,
    encoding: "utf8",
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${input[0]} failed`);
  }
  return result;
}

function runHead(project, mode = "enforce", environment = process.env) {
  return spawnSync(
    process.execPath,
    [checker, "--project", project, "--mode", mode],
    { encoding: "utf8", env: environment },
  );
}

function writeState(project, lane, name, content) {
  const directory = path.join(project, ".loopcompass", lane);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, name), content);
}

function stateDigest(rootPath) {
  const hash = createHash("sha256");
  function walk(directory, prefix = "") {
    for (const name of readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(full);
      hash.update(relative);
      if (stat.isDirectory()) walk(full, relative);
      else if (stat.isSymbolicLink()) hash.update("symlink");
      else hash.update(readFileSync(full));
    }
  }
  walk(rootPath);
  return hash.digest("hex");
}

describe("shipped redaction checker", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "lc-redaction-"));
  let project;

  beforeEach(() => {
    project = path.join(tmp, `project-${Date.now()}-${Math.random()}`);
    mkdirSync(path.join(project, ".loopcompass"), { recursive: true });
    git(project, "init", "-q");
    git(project, "config", "user.name", "Worker");
    git(project, "config", "user.email", "worker@example.com");
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it("blocks high-confidence findings across incidents, recoveries, and receipts", () => {
    writeState(
      project,
      "incidents",
      "incident.md",
      [
        "contact person@private-company.com",
        "path /Users/private-person/project",
        "url https://service.invalid?access_token=actualcredentialvalue",
      ].join("\n"),
    );
    writeState(
      project,
      "recoveries",
      "recovery.md",
      "token: ghp_abcdefghijklmnopqrstuvwxyz123456\n",
    );
    writeState(
      project,
      "receipts",
      "receipt.json",
      '{"password":"actualcredentialvalue"}\n',
    );

    const result = run(project);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    for (const rule of [
      "BLOCK_EMAIL",
      "BLOCK_PERSONAL_HOME_PATH",
      "BLOCK_CREDENTIAL_URL",
      "BLOCK_KNOWN_TOKEN",
      "BLOCK_CREDENTIAL_VALUE",
    ]) {
      assert.match(result.stdout, new RegExp(`block ${rule} \\d+`));
    }
    assert.doesNotMatch(result.stdout + result.stderr, /person@|private-person|ghp_|actualcredential/);
  });

  it("detects a quoted JSON credential assignment without revealing it", () => {
    writeState(
      project,
      "receipts",
      "receipt.json",
      '{"password":"p@ssw0rd!:$value"}\n',
    );
    const result = run(project);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /block BLOCK_CREDENTIAL_VALUE 1/);
    assert.doesNotMatch(result.stdout + result.stderr, /p@ss|receipt\.json/);
  });

  it("detects a bounded bearer credential without revealing it", () => {
    writeState(
      project,
      "incidents",
      "incident.md",
      "Authorization: Bearer opaque:credential$value-123\n",
    );
    const result = run(project);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /block BLOCK_CREDENTIAL_VALUE 1/);
    assert.doesNotMatch(result.stdout + result.stderr, /opaque:|incident\.md/);
  });

  it("detects a fine-grained GitHub token without revealing it", () => {
    writeState(
      project,
      "recoveries",
      "recovery.md",
      "credential github_pat_abcdefghijklmnopqrstuvwxyz1234567890\n",
    );
    const result = run(project);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /block BLOCK_KNOWN_TOKEN 1/);
    assert.doesNotMatch(result.stdout + result.stderr, /github_pat_|recovery\.md/);
  });

  it("detects a credential URL parameter after an earlier parameter", () => {
    writeState(
      project,
      "recoveries",
      "recovery.md",
      "url: https://service.example/path?mode=read&api_key=credentialvalue123\n",
    );
    const result = run(project);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /block BLOCK_CREDENTIAL_URL 1/);
    assert.doesNotMatch(result.stdout, /BLOCK_CREDENTIAL_VALUE/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /credentialvalue|recovery\.md/,
    );
  });

  it("warns for lower-confidence values and permits reserved examples and roles", () => {
    writeState(
      project,
      "recoveries",
      "safe.md",
      [
        "operator@example.com",
        "worker@subdomain.example.org",
        "worker@service.test",
        "/Users/Operator/project",
        "/home/Worker/project",
        "contact @possiblehandle",
        "call +1 212-555-0101",
      ].join("\n"),
    );
    const result = run(project);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /warn WARN_POSSIBLE_HANDLE 1/);
    assert.match(result.stdout, /warn WARN_POSSIBLE_PHONE 1/);
    assert.doesNotMatch(result.stdout, /BLOCK_EMAIL|BLOCK_PERSONAL_HOME_PATH/);
  });

  it("does not treat root as a functional-role home directory", () => {
    writeState(
      project,
      "incidents",
      "homes.md",
      "/home/root/private\n/Users/root/private\n",
    );
    const result = run(project);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /block BLOCK_PERSONAL_HOME_PATH 2/);
    assert.doesNotMatch(result.stdout + result.stderr, /homes\.md|\/home\/root|\/Users\/root/);
  });

  it("applies bounded project patterns without echoing config content or identifiers", () => {
    writeFileSync(
      path.join(project, ".loopcompass", "redaction.yaml"),
      [
        "version: 1",
        "patterns:",
        "  - id: confidential-term",
        '    literal: "Sensitive Synthetic Organization"',
        "    severity: block",
        "    flags: i",
        "  - id: account-shape",
        '    regex: "\\\\bACCOUNT-[0-9]{8}\\\\b"',
        "    severity: warn",
        "",
      ].join("\n"),
    );
    writeState(
      project,
      "incidents",
      "finding.md",
      "Sensitive Synthetic Organization ACCOUNT-12345678\n",
    );
    const result = run(project);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /block BLOCK_PROJECT_PATTERN 1/);
    assert.match(result.stdout, /warn WARN_PROJECT_PATTERN 1/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /confidential-term|account-shape|Synthetic Organization|ACCOUNT-/,
    );
  });

  it("fails safely on invalid config without revealing its content", () => {
    writeFileSync(
      path.join(project, ".loopcompass", "redaction.yaml"),
      [
        "version: 1",
        "patterns:",
        "  - id: hidden-pattern",
        '    regex: "(catastrophic+)+"',
        "",
      ].join("\n"),
    );
    const result = run(project, "audit");
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "error SCAN_FAILED\n");
    assert.doesNotMatch(result.stderr, /hidden-pattern|catastrophic/);
  });

  it("rejects adjacent variable-width project quantifiers and accepts fixed width", () => {
    writeFileSync(
      path.join(project, ".loopcompass", "redaction.yaml"),
      [
        "version: 1",
        "patterns:",
        "  - id: adversarial",
        `    regex: "^${"a{0,256}".repeat(20)}b$"`,
        "",
      ].join("\n"),
    );
    let result = run(project, "audit");
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "error SCAN_FAILED\n");

    writeFileSync(
      path.join(project, ".loopcompass", "redaction.yaml"),
      [
        "version: 1",
        "patterns:",
        "  - id: escaped-parity",
        "    regex: '^a\\\\\\\\+b$'",
        "",
      ].join("\n"),
    );
    result = run(project, "audit");
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "error SCAN_FAILED\n");

    writeFileSync(
      path.join(project, ".loopcompass", "redaction.yaml"),
      [
        "version: 1",
        "patterns:",
        "  - id: fixed-account",
        '    regex: "\\\\bACCOUNT-[0-9]{8}\\\\b"',
        "    severity: warn",
        "",
      ].join("\n"),
    );
    writeState(project, "incidents", "fixed.md", "ACCOUNT-12345678\n");
    result = run(project, "audit");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /warn WARN_PROJECT_PATTERN 1/);
  });

  it("scans durable filenames but never echoes a sensitive filename", () => {
    writeState(project, "incidents", "person@private-company.com.md", "sanitized body\n");
    const result = run(project);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /block BLOCK_EMAIL 1/);
    assert.doesNotMatch(result.stdout + result.stderr, /person@|private-company/);
  });

  it("does not follow symlinks or escape the state root", () => {
    const outside = path.join(tmp, `outside-${Date.now()}.md`);
    writeFileSync(outside, "outside@private-company.com\n");
    const incidents = path.join(project, ".loopcompass", "incidents");
    mkdirSync(incidents, { recursive: true });
    symlinkSync(outside, path.join(incidents, "external.md"));

    const result = run(project);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /block BLOCK_SYMLINK 1/);
    assert.doesNotMatch(result.stdout, /BLOCK_EMAIL/);
    assert.doesNotMatch(result.stdout + result.stderr, /outside-|external\.md/);
  });

  it("fails safely when the state root itself is a symlink", () => {
    const externalState = path.join(tmp, `external-state-${Date.now()}`);
    mkdirSync(externalState);
    rmSync(path.join(project, ".loopcompass"), { recursive: true });
    symlinkSync(externalState, path.join(project, ".loopcompass"));
    const result = run(project, "audit");
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "error UNSAFE_STATE_ROOT\n");
    assert.doesNotMatch(result.stdout + result.stderr, /external-state/);
  });

  it("fails closed across repeated atomic config and state-directory swaps", () => {
    writeState(project, "incidents", "clean.md", "role: Operator\n");
    writeFileSync(
      path.join(project, ".loopcompass", "redaction.yaml"),
      "version: 1\npatterns:\n",
    );
    assert.equal(run(project, "audit").status, 0);

    const config = path.join(project, ".loopcompass", "redaction.yaml");
    const safeConfig = path.join(project, ".loopcompass", "redaction.safe");
    const outsideConfig = path.join(tmp, "outside-config.yaml");
    writeFileSync(
      outsideConfig,
      "version: 1\npatterns:\n  - id: outside\n    literal: outside-marker\n",
    );
    for (let iteration = 0; iteration < 8; iteration += 1) {
      renameSync(config, safeConfig);
      symlinkSync(outsideConfig, config);
      const swapped = runHead(project, "audit");
      assert.equal(swapped.status, 2);
      assert.equal(swapped.stderr, "error SCAN_FAILED\n");
      assert.doesNotMatch(swapped.stdout + swapped.stderr, /outside-marker|outside-config/);
      rmSync(config);
      renameSync(safeConfig, config);
      assert.equal(runHead(project, "audit").status, 0);
    }

    const state = path.join(project, ".loopcompass");
    const savedState = path.join(project, ".loopcompass-safe");
    const outsideState = path.join(tmp, "outside-state-swap");
    mkdirSync(path.join(outsideState, "incidents"), { recursive: true });
    writeFileSync(
      path.join(outsideState, "incidents", "outside.md"),
      "outside-marker@private-company.com\n",
    );
    for (let iteration = 0; iteration < 8; iteration += 1) {
      renameSync(state, savedState);
      symlinkSync(outsideState, state);
      const swapped = runHead(project, "audit");
      assert.equal(swapped.status, 2);
      assert.equal(swapped.stderr, "error UNSAFE_STATE_ROOT\n");
      assert.doesNotMatch(swapped.stdout + swapped.stderr, /outside-marker|outside-state/);
      rmSync(state);
      renameSync(savedState, state);
      assert.equal(runHead(project, "audit").status, 0);
    }
  });

  it("never passes while the committed config is interleaved with an alternate file", async () => {
    writeFileSync(
      path.join(project, ".loopcompass", "redaction.yaml"),
      [
        "version: 1",
        "patterns:",
        "  - id: committed-rule",
        '    literal: "Sensitive Synthetic Organization"',
        "",
      ].join("\n"),
    );
    writeState(
      project,
      "incidents",
      "finding.md",
      "Sensitive Synthetic Organization\n",
    );
    assert.equal(run(project).status, 1);

    const config = path.join(project, ".loopcompass", "redaction.yaml");
    const held = path.join(project, ".loopcompass", "redaction.held");
    const alternate = path.join(tmp, `alternate-config-${Date.now()}.yaml`);
    writeFileSync(alternate, "version: 1\npatterns:\n");
    const swapper = spawn(
      process.execPath,
      [
        "-e",
        `
          const fs = require("node:fs");
          const [target, held, alternate] = process.argv.slice(1);
          const until = Date.now() + 1200;
          while (Date.now() < until) {
            try {
              fs.renameSync(target, held);
              fs.copyFileSync(alternate, target);
              fs.rmSync(target);
              fs.renameSync(held, target);
            } catch {}
          }
          try {
            if (!fs.existsSync(target) && fs.existsSync(held)) fs.renameSync(held, target);
          } catch {}
        `,
        config,
        held,
        alternate,
      ],
      { stdio: "ignore" },
    );
    const swapperDone = new Promise((resolve, reject) => {
      swapper.once("error", reject);
      swapper.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`swapper exited ${code}`)),
      );
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = runHead(project);
      assert.notEqual(result.status, 0, result.stdout);
      assert.ok([1, 2].includes(result.status), result.stderr || result.stdout);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /Sensitive Synthetic Organization|alternate-config|finding\.md/,
      );
    }
    await swapperDone;
    assert.ok(existsSync(config));
    assert.equal(runHead(project).status, 1);
  });

  it("skips oversized and binary files with stable warnings", () => {
    writeState(project, "recoveries", "large.md", "a".repeat(1024 * 1024 + 1));
    writeState(project, "incidents", "binary.md", Buffer.from([0x61, 0x00, 0x62]));
    const result = run(project);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /warn WARN_BINARY_SKIPPED 1/);
    assert.match(result.stdout, /warn WARN_SIZE_LIMIT 1/);
    assert.match(result.stdout, /files_skipped 2/);
  });

  it("keeps historical audit findings non-failing while enforce blocks", () => {
    writeState(project, "terminal-receipts", "old.yaml", "email: old@private-company.com\n");
    const audit = run(project, "audit");
    const enforce = run(project, "enforce");
    assert.equal(audit.status, 0, audit.stderr || audit.stdout);
    assert.match(audit.stdout, /result findings_audit_only/);
    assert.equal(enforce.status, 1);
    assert.match(enforce.stdout, /result blocked/);
  });

  it("does not mutate LoopCompass state", () => {
    writeState(project, "recoveries", "clean.md", "role: Operator\n");
    writeState(project, "receipts", "clean.json", '{"outcome":"no_artifact"}\n');
    const before = stateDigest(path.join(project, ".loopcompass"));
    const result = run(project, "audit");
    const after = stateDigest(path.join(project, ".loopcompass"));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(after, before);
  });

  it("rejects a sanitized dirty worktree that differs from committed HEAD", () => {
    writeState(
      project,
      "incidents",
      "committed.md",
      "contact committed@private-company.com\n",
    );
    run(project, "audit");
    writeState(project, "incidents", "committed.md", "role: Operator\n");
    const result = runHead(project);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "error SCAN_FAILED\n");
    assert.doesNotMatch(result.stdout + result.stderr, /committed@|committed\.md/);
  });

  it("rejects untracked content in a committed-state lane", () => {
    writeState(project, "incidents", "clean.md", "role: Operator\n");
    run(project, "audit");
    writeState(
      project,
      "incidents",
      "untracked-private.md",
      "contact untracked@private-company.com\n",
    );
    const result = runHead(project);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "error SCAN_FAILED\n");
    assert.doesNotMatch(result.stdout + result.stderr, /untracked@|untracked-private/);
  });

  it("rejects ignored lane content hidden by repository ignore rules", () => {
    writeState(project, "incidents", "clean.md", "role: Operator\n");
    run(project, "audit");
    writeFileSync(
      path.join(project, ".gitignore"),
      ".loopcompass/incidents/ignored.md\n",
    );
    git(project, "add", ".gitignore");
    git(project, "commit", "-m", "ignore fixture");
    writeState(
      project,
      "incidents",
      "ignored.md",
      "contact ignored@private-company.com\n",
    );
    const result = runHead(project);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "error SCAN_FAILED\n");
    assert.doesNotMatch(result.stdout + result.stderr, /ignored@|ignored\.md/);
  });

  it("rejects lane content hidden by info exclude rules", () => {
    writeState(project, "incidents", "clean.md", "role: Operator\n");
    run(project, "audit");
    writeFileSync(
      path.join(project, ".git", "info", "exclude"),
      ".loopcompass/incidents/info-hidden.md\n",
    );
    writeState(
      project,
      "incidents",
      "info-hidden.md",
      "contact hidden@private-company.com\n",
    );
    const result = runHead(project);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "error SCAN_FAILED\n");
    assert.doesNotMatch(result.stdout + result.stderr, /hidden@|info-hidden/);
  });

  it("rejects lane content hidden by a configured global exclude file", () => {
    writeState(project, "incidents", "clean.md", "role: Operator\n");
    run(project, "audit");
    const excludes = path.join(tmp, `global-excludes-${Date.now()}`);
    writeFileSync(excludes, ".loopcompass/incidents/global-hidden.md\n");
    git(project, "config", "core.excludesFile", excludes);
    writeState(
      project,
      "incidents",
      "global-hidden.md",
      "contact hidden@private-company.com\n",
    );
    const result = runHead(project);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "error SCAN_FAILED\n");
    assert.doesNotMatch(result.stdout + result.stderr, /hidden@|global-hidden|global-excludes/);
  });

  it("does not let a dirty or deleted config hide a committed project rule", () => {
    writeFileSync(
      path.join(project, ".loopcompass", "redaction.yaml"),
      [
        "version: 1",
        "patterns:",
        "  - id: committed-rule",
        '    literal: "Sensitive Synthetic Organization"',
        "",
      ].join("\n"),
    );
    writeState(
      project,
      "incidents",
      "finding.md",
      "Sensitive Synthetic Organization\n",
    );
    assert.equal(run(project).status, 1);

    writeFileSync(
      path.join(project, ".loopcompass", "redaction.yaml"),
      "version: 1\npatterns:\n",
    );
    let result = runHead(project);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "error SCAN_FAILED\n");
    rmSync(path.join(project, ".loopcompass", "redaction.yaml"));
    result = runHead(project);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "error SCAN_FAILED\n");
  });

  it("ignores ambient Git repository and replacement configuration", () => {
    writeState(
      project,
      "incidents",
      "secret.md",
      "contact person@private-company.com\n",
    );
    assert.equal(run(project, "audit").status, 0);

    const alternate = path.join(tmp, `alternate-${Date.now()}`);
    mkdirSync(alternate);
    git(alternate, "init", "-q");
    git(alternate, "config", "user.name", "Worker");
    git(alternate, "config", "user.email", "worker@example.com");
    writeFileSync(path.join(alternate, "safe.txt"), "safe\n");
    git(alternate, "add", "safe.txt");
    git(alternate, "commit", "-m", "safe alternate");

    const treeEntry = git(
      project,
      "ls-tree",
      "HEAD",
      ".loopcompass/incidents/secret.md",
    ).stdout.trim();
    const secretObject = treeEntry.split(/\s+/)[2];
    const safeObject = spawnSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: project,
      input: "role: Operator\n",
      encoding: "utf8",
    });
    assert.equal(safeObject.status, 0, safeObject.stderr);
    git(project, "replace", secretObject, safeObject.stdout.trim());

    const result = runHead(project, "enforce", {
      ...process.env,
      GIT_DIR: path.join(alternate, ".git"),
      GIT_WORK_TREE: alternate,
      GIT_NAMESPACE: "alternate",
      GIT_REPLACE_REF_BASE: "refs/replace",
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /block BLOCK_EMAIL 1/);
    assert.doesNotMatch(result.stdout + result.stderr, /person@|secret\.md|alternate-/);
  });
});
