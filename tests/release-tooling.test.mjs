import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runRelease(...args) {
  return runReleaseAt(root, ...args);
}

function runReleaseAt(releaseRoot, ...args) {
  return spawnSync(process.execPath, [path.join(releaseRoot, "scripts", "release.mjs"), ...args], {
    cwd: releaseRoot,
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

  it("requires every classification to persist, report no artifact, or escalate", () => {
    const policy = readFileSync(
      path.join(root, "skills", "loop-compass", "assets", "project-policy.md"),
      "utf8",
    );
    const skill = readFileSync(
      path.join(root, "skills", "loop-compass", "SKILL.md"),
      "utf8",
    );

    for (const text of [policy, skill]) {
      assert.match(text, /persistence is automatic within current repository\s+authority/i);
      assert.match(text, /no artifact/i);
      assert.match(text, /exact (missing )?permission/i);
    }
    assert.match(policy, /Brief-only\s+or read-only workers/i);
    assert.doesNotMatch(`${policy}\n${skill}`, /operator approval by default/i);
  });

  it("package stages skill files whose raw digests match the manifest", () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "lc-package-"));
    try {
      for (const name of ["scripts", "skills", "docs"]) {
        cpSync(path.join(root, name), path.join(fixtureRoot, name), { recursive: true });
      }
      for (const name of ["VERSION", "LICENSE", "CHANGELOG.md", "README.md"]) {
        copyFileSync(path.join(root, name), path.join(fixtureRoot, name));
      }

      // Simulate a CRLF worktree file in the isolated fixture. Packaging must
      // still emit LF-canonical members without racing other test files.
      const skillYaml = path.join(
        fixtureRoot,
        "skills",
        "loop-compass",
        "agents",
        "openai.yaml",
      );
      const original = readFileSync(skillYaml);
      const crlf = Buffer.from(
        original.toString("utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"),
        "utf8",
      );
      writeFileSync(skillYaml, crlf);

      const result = runReleaseAt(fixtureRoot, "package");
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const staged = path.join(
        fixtureRoot,
        "dist",
        "staging",
        "LoopCompass",
        "skills",
        "loop-compass",
      );
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
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
