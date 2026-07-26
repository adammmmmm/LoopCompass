import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  return spawnSync(
    process.execPath,
    [checker, "--project", project, "--mode", mode],
    { encoding: "utf8" },
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
});
