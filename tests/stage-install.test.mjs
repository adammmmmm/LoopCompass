import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, after } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runRelease(args, cwd = root) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "release.mjs"), ...args], {
    cwd,
    encoding: "utf8",
  });
}

describe("stage-install dual host", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "lc-stage-"));
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it("copies skill into agents and claude paths without touching state", () => {
    const project = path.join(tmp, "proj");
    mkdirSync(project, { recursive: true });
    const stateRec = path.join(project, ".loopcompass", "recoveries");
    mkdirSync(stateRec, { recursive: true });
    writeFileSync(path.join(stateRec, "keep-me.md"), "# keep\n", "utf8");

    const r = runRelease([
      "stage-install",
      "--project",
      project,
      "--hosts",
      "agents,claude",
    ]);
    assert.equal(r.status, 0, r.stderr || r.stdout);

    const a = path.join(project, ".agents", "skills", "loop-compass", "SKILL.md");
    const c = path.join(project, ".claude", "skills", "loop-compass", "SKILL.md");
    assert.ok(existsSync(a));
    assert.ok(existsSync(c));
    assert.equal(
      readFileSync(a, "utf8"),
      readFileSync(c, "utf8"),
    );
    assert.ok(existsSync(path.join(stateRec, "keep-me.md")));
  });
});
