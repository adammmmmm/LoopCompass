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
});
