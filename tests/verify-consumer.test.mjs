import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
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

  it("passes a dual-host staged project with policy and empty state", () => {
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

    const policy = readFileSync(
      path.join(root, "skills", "loop-compass", "assets", "project-policy.md"),
      "utf8",
    ).trim();
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      writeFileSync(
        path.join(project, name),
        `# ${name}\n\n${policy}\n\n## Other\n\nkeep\n`,
        "utf8",
      );
    }
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
});
