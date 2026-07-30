import assert from "node:assert/strict";
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, after } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("verify-consumer", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "lc-consumer-"));
  after(() => rmSync(tmp, { recursive: true, force: true }));

  function stageOne(project) {
    mkdirSync(project, { recursive: true });
    const stage = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts", "release.mjs"),
        "stage-install",
        "--project",
        project,
        "--hosts",
        "agents",
      ],
      { encoding: "utf8" },
    );
    assert.equal(stage.status, 0, stage.stderr || stage.stdout);
    return path.join(project, ".agents", "skills", "loop-compass");
  }

  function verify(project, timeout = undefined) {
    return spawnSync(
      process.execPath,
      [
        path.join(root, "scripts", "verify-consumer.mjs"),
        "--project",
        project,
      ],
      { encoding: "utf8", timeout },
    );
  }

  function trackOneSource(project) {
    let result = spawnSync("git", ["init", "-q"], {
      cwd: project,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = spawnSync(
      "git",
      [
        "add",
        "-f",
        ".agents/skills/loop-compass",
        ".claude/skills/loop-compass",
        "AGENTS.md",
        "CLAUDE.md",
      ],
      { cwd: project, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  function writeOneSourcePolicy(project) {
    const policy = readFileSync(
      path.join(root, "skills", "loop-compass", "assets", "project-policy.md"),
      "utf8",
    ).trim();
    writeFileSync(
      path.join(project, "AGENTS.md"),
      `# Project instructions\n\n${policy}\n`,
      "utf8",
    );
    writeFileSync(path.join(project, "CLAUDE.md"), "@AGENTS.md\n", "utf8");
  }

  it("passes a tracked one-source project with provider import and empty state", () => {
    const project = path.join(tmp, "consumer");
    mkdirSync(project, { recursive: true });

    const stage = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts", "release.mjs"),
        "stage-install",
        "--project",
        project,
        "--hosts",
        "agents,claude",
      ],
      { encoding: "utf8" },
    );
    assert.equal(stage.status, 0, stage.stderr || stage.stdout);
    assert.equal(
      lstatSync(
        path.join(project, ".claude", "skills", "loop-compass"),
      ).isSymbolicLink(),
      true,
    );
    writeOneSourcePolicy(project);
    trackOneSource(project);
    mkdirSync(path.join(project, ".loopcompass", "recoveries"), {
      recursive: true,
    });
    mkdirSync(path.join(project, ".loopcompass", "incidents"), {
      recursive: true,
    });

    const r = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts", "verify-consumer.mjs"),
        "--project",
        project,
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /verify-consumer ok/);
  });

  it("rejects one-source symlink escape and a divergent in-repository target", () => {
    for (const kind of ["escape", "divergent"]) {
      const project = path.join(tmp, `consumer-${kind}`);
      const agents = stageOne(project);
      writeOneSourcePolicy(project);
      const link = path.join(project, ".claude", "skills", "loop-compass");
      mkdirSync(path.dirname(link), { recursive: true });
      if (kind === "escape") {
        const outside = path.join(tmp, "outside-skill");
        cpSync(agents, outside, { recursive: true });
        symlinkSync(outside, link);
      } else {
        const divergent = path.join(project, "vendor", "loop-compass");
        cpSync(agents, divergent, { recursive: true });
        symlinkSync(path.relative(path.dirname(link), divergent), link);
      }
      trackOneSource(project);
      const result = verify(project);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /confined-target validation/);
      assert.doesNotMatch(result.stderr, new RegExp(`consumer-${kind}`));
    }
  });

  it("rejects untracked one-source installs and drifting provider imports", () => {
    const untracked = path.join(tmp, "consumer-untracked");
    mkdirSync(untracked, { recursive: true });
    const staged = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts", "release.mjs"),
        "stage-install",
        "--project",
        untracked,
        "--hosts",
        "agents,claude",
      ],
      { encoding: "utf8" },
    );
    assert.equal(staged.status, 0, staged.stderr || staged.stdout);
    writeOneSourcePolicy(untracked);
    let result = verify(untracked);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not fully tracked/);

    const drifting = path.join(tmp, "consumer-provider-drift");
    mkdirSync(drifting, { recursive: true });
    const stage = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts", "release.mjs"),
        "stage-install",
        "--project",
        drifting,
        "--hosts",
        "agents,claude",
      ],
      { encoding: "utf8" },
    );
    assert.equal(stage.status, 0, stage.stderr || stage.stdout);
    writeOneSourcePolicy(drifting);
    for (const provider of [
      "@AGENTS.md",
      "@AGENTS.md\n# local drift\n",
      "@./AGENTS.md\n",
    ]) {
      writeFileSync(path.join(drifting, "CLAUDE.md"), provider, "utf8");
      trackOneSource(drifting);
      result = verify(drifting);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /expected exact @AGENTS\.md provider import/);
    }
  });

  it("rejects a one-source project without AGENTS.md and its policy block", () => {
    const project = path.join(tmp, "consumer-missing-agents-policy");
    mkdirSync(project, { recursive: true });
    const stage = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts", "release.mjs"),
        "stage-install",
        "--project",
        project,
        "--hosts",
        "agents,claude",
      ],
      { encoding: "utf8" },
    );
    assert.equal(stage.status, 0, stage.stderr || stage.stdout);
    writeOneSourcePolicy(project);
    trackOneSource(project);
    rmSync(path.join(project, "AGENTS.md"));

    const result = verify(project);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /AGENTS\.md: required one-source instruction file is unavailable/,
    );
    assert.doesNotMatch(result.stderr, /consumer-missing-agents-policy/);
  });

  it("rejects an unexpected execution surface even when other files are valid", () => {
    const project = path.join(tmp, "consumer-unexpected-script");
    mkdirSync(project, { recursive: true });
    const stage = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts", "release.mjs"),
        "stage-install",
        "--project",
        project,
        "--hosts",
        "agents",
      ],
      { encoding: "utf8" },
    );
    assert.equal(stage.status, 0, stage.stderr || stage.stdout);
    const unexpected = path.join(
      project,
      ".agents",
      "skills",
      "loop-compass",
      "scripts",
      "unexpected.mjs",
    );
    writeFileSync(unexpected, "process.exit(0);\n");

    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts", "verify-consumer.mjs"),
        "--project",
        project,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /inventory does not match manifest/);
    assert.doesNotMatch(result.stderr, /unexpected\.mjs|consumer-unexpected-script/);
  });

  it("rejects a required file replaced by a directory and an extra empty directory", () => {
    const project = path.join(tmp, "consumer-typed-tree");
    const skill = stageOne(project);
    rmSync(path.join(skill, "SKILL.md"));
    mkdirSync(path.join(skill, "SKILL.md"));
    let result = verify(project);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /typed-tree|inventory|required regular file/);
    assert.doesNotMatch(result.stderr, /consumer-typed-tree|SKILL\.md/);

    rmSync(path.join(skill, "SKILL.md"), { recursive: true });
    writeFileSync(
      path.join(skill, "SKILL.md"),
      readFileSync(path.join(root, "skills", "loop-compass", "SKILL.md")),
    );
    mkdirSync(path.join(skill, "empty-extra"));
    result = verify(project);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /inventory/);
    assert.doesNotMatch(result.stderr, /empty-extra|consumer-typed-tree/);
  });

  it("rejects a manifest with comment or unknown-field byte drift", () => {
    const project = path.join(tmp, "consumer-manifest-drift");
    const skill = stageOne(project);
    const manifest = path.join(skill, "manifest.yaml");
    const original = readFileSync(manifest, "utf8");
    for (const suffix of ["# comment\n", "unknown_field: value\n"]) {
      writeFileSync(manifest, `${original}${suffix}`);
      const result = verify(project);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /manifest failed canonical validation/);
      assert.doesNotMatch(result.stderr, /comment|unknown_field|consumer-manifest-drift/);
    }
  });

  it("rejects a FIFO before attempting to read it", (context) => {
    const project = path.join(tmp, "consumer-fifo");
    const skill = stageOne(project);
    const target = path.join(skill, "SKILL.md");
    rmSync(target);
    const created = spawnSync("mkfifo", [target], { encoding: "utf8" });
    if (created.status !== 0) {
      context.skip("mkfifo unavailable on this host");
      return;
    }
    const result = verify(project, 3000);
    assert.notEqual(result.signal, "SIGTERM", "verification must not block on FIFO");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /typed-tree/);
    assert.doesNotMatch(result.stderr, /consumer-fifo|SKILL\.md/);
  });

  it("rejects a FIFO in state before validation without blocking", (context) => {
    const project = path.join(tmp, "consumer-state-fifo");
    stageOne(project);
    const incidents = path.join(project, ".loopcompass", "incidents");
    mkdirSync(incidents, { recursive: true });
    const target = path.join(incidents, "candidate.md");
    const created = spawnSync("mkfifo", [target], { encoding: "utf8" });
    if (created.status !== 0) {
      context.skip("mkfifo unavailable on this host");
      return;
    }
    const result = verify(project, 3000);
    assert.notEqual(result.signal, "SIGTERM", "verification must not block on FIFO");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /regular-tree validation/);
    assert.doesNotMatch(result.stderr, /consumer-state-fifo|candidate\.md/);
  });

  it("requires the shipped human-attention profile", () => {
    const project = path.join(tmp, "missing-human-profile");
    const skill = stageOne(project);
    rmSync(path.join(skill, "references", "human-attention.md"));

    const result = verify(project);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /skill install inventory does not match manifest/);
    assert.doesNotMatch(result.stderr, /human-attention\.md|missing-human-profile/);
  });
});
