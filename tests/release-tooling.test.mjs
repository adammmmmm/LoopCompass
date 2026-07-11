import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runRelease(...args) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "release.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("release tooling", () => {
  it("validate succeeds on current tree", () => {
    const result = runRelease("validate");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /validate ok/);
  });

  it("manifest lists every required skill file with sha256 digests", () => {
    const manifestPath = path.join(root, "skills", "loop-compass", "manifest.yaml");
    assert.ok(existsSync(manifestPath));
    const text = readFileSync(manifestPath, "utf8");
    for (const rel of [
      "SKILL.md",
      "agents/openai.yaml",
      "assets/project-policy.md",
      "assets/recovery-template.md",
      "assets/incident-template.md",
      "references/classification.md",
      "references/integration.md",
    ]) {
      assert.match(text, new RegExp(`^\\s+${rel.replace(".", "\\.")}:\\s+[0-9a-f]{64}$`, "m"));
    }
  });

  it("policy markers are exactly one start/end pair", () => {
    const policy = readFileSync(
      path.join(root, "skills", "loop-compass", "assets", "project-policy.md"),
      "utf8",
    );
    const starts = policy.match(/<!--\s*loopcompass:start/g) || [];
    const ends = policy.match(/<!--\s*loopcompass:end/g) || [];
    assert.equal(starts.length, 1);
    assert.equal(ends.length, 1);
  });
});
