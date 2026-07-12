import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, after } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runRelease(...args) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "release.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function parseManifestFiles(text) {
  const files = {};
  let inFiles = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles) {
      const m = line.match(/^\s+([^:]+):\s*([0-9a-f]{64})\s*$/i);
      if (m) files[m[1].trim()] = m[2].toLowerCase();
      else if (/^\S/.test(line)) inFiles = false;
    }
  }
  return files;
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

  it("package stages skill files whose raw digests match the manifest", () => {
    // Simulate a CRLF worktree file for openai.yaml without dirtying git permanently:
    // package must still emit LF-canonical members.
    const skillYaml = path.join(root, "skills", "loop-compass", "agents", "openai.yaml");
    const original = readFileSync(skillYaml);
    const crlf = Buffer.from(
      original.toString("utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"),
      "utf8",
    );
    writeFileSync(skillYaml, crlf);
    after(() => {
      writeFileSync(skillYaml, original);
    });

    const result = runRelease("package");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const staged = path.join(root, "dist", "staging", "LoopCompass", "skills", "loop-compass");
    const man = parseManifestFiles(
      readFileSync(path.join(staged, "manifest.yaml"), "utf8"),
    );
    for (const [rel, expected] of Object.entries(man)) {
      const raw = readFileSync(path.join(staged, rel));
      assert.equal(
        raw.includes(0x0d),
        false,
        `${rel} must not contain CR in package staging`,
      );
      const actual = createHash("sha256").update(raw).digest("hex");
      assert.equal(actual, expected, `raw digest mismatch for ${rel}`);
    }
  });
});
