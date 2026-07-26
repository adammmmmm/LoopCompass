import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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

  it("rejects noncanonical manifest grammar", () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "lc-manifest-grammar-"));
    try {
      for (const name of ["scripts", "skills", "docs"]) {
        cpSync(path.join(root, name), path.join(fixtureRoot, name), { recursive: true });
      }
      for (const name of ["VERSION", "LICENSE", "CHANGELOG.md", "README.md"]) {
        copyFileSync(path.join(root, name), path.join(fixtureRoot, name));
      }
      const manifestPath = path.join(
        fixtureRoot,
        "skills",
        "loop-compass",
        "manifest.yaml",
      );
      const canonical = readFileSync(manifestPath, "utf8");
      const cases = [
        `${canonical}# extra comment\n`,
        `${canonical}unknown_field: value\n`,
        canonical.replace(
          /^version: (.+)$/m,
          "version: $1\nversion: $1",
        ),
        canonical.replace(
          /^(version: .+)\n(source: .+)$/m,
          "$2\n$1",
        ),
      ];
      for (const candidate of cases) {
        writeFileSync(manifestPath, candidate);
        const result = runReleaseAt(fixtureRoot, "validate");
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /release operation failed stable filesystem validation/);
        assert.doesNotMatch(result.stderr, /extra comment|unknown_field/);
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects YAML-significant filenames in generation and validation", () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "lc-manifest-paths-"));
    try {
      for (const name of ["scripts", "skills", "docs"]) {
        cpSync(path.join(root, name), path.join(fixtureRoot, name), { recursive: true });
      }
      for (const name of ["VERSION", "LICENSE", "CHANGELOG.md", "README.md"]) {
        copyFileSync(path.join(root, name), path.join(fixtureRoot, name));
      }
      const references = path.join(
        fixtureRoot,
        "skills",
        "loop-compass",
        "references",
      );
      const manifestPath = path.join(
        fixtureRoot,
        "skills",
        "loop-compass",
        "manifest.yaml",
      );
      for (const name of ["unsafe # comment.md", "tag!anchor.md", "colon:key.md"]) {
        const candidate = path.join(references, name);
        writeFileSync(candidate, "payload\n");
        const generated = runReleaseAt(fixtureRoot, "generate");
        assert.notEqual(generated.status, 0);
        assert.match(
          generated.stderr,
          /release operation failed stable filesystem validation/,
        );
        assert.doesNotMatch(generated.stderr, /unsafe|comment|anchor|colon/);
        rmSync(candidate);
      }

      const canonical = readFileSync(manifestPath, "utf8");
      const digest = "a".repeat(64);
      writeFileSync(
        manifestPath,
        canonical.replace(/^files:$/m, `files:\n  unsafe # comment.md: ${digest}`),
      );
      const validated = runReleaseAt(fixtureRoot, "validate");
      assert.notEqual(validated.status, 0);
      assert.match(
        validated.stderr,
        /release operation failed stable filesystem validation/,
      );
      assert.doesNotMatch(validated.stderr, /unsafe|comment/);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
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
      "references/human-attention.md",
      "references/integration.md",
      "references/pii-sanitation.md",
      "references/redaction-audit.md",
      "scripts/redact-check.mjs",
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

  it("keeps successful workarounds from erasing classification", () => {
    const policy = readFileSync(
      path.join(root, "skills", "loop-compass", "assets", "project-policy.md"),
      "utf8",
    );
    const skill = readFileSync(
      path.join(root, "skills", "loop-compass", "SKILL.md"),
      "utf8",
    );

    for (const text of [policy, skill]) {
      assert.match(
        text,
        /A workaround may complete the task; it does not complete the classification\./,
      );
      assert.match(text, /persisted_artifact/);
      assert.match(text, /proposed_artifact/);
      assert.match(text, /no_artifact/);
      assert.match(text, /task outcome and mechanism health/i);
    }
  });

  it("keeps schema-1 coordination and closure semantics explicit", () => {
    const skill = readFileSync(
      path.join(root, "skills", "loop-compass", "SKILL.md"),
      "utf8",
    );
    const classification = readFileSync(
      path.join(root, "skills", "loop-compass", "references", "classification.md"),
      "utf8",
    );
    const incidentTemplate = readFileSync(
      path.join(root, "skills", "loop-compass", "assets", "incident-template.md"),
      "utf8",
    );

    for (const text of [skill, classification]) {
      assert.match(text, /state schema 1/i);
      assert.match(text, /`owner` (?:is|means) the coordinator/i);
      assert.match(text, /acknowledgment[\s\S]{0,180}not closure/i);
      assert.match(
        text,
        /source\s+of\s+authority[\s\S]{0,240}containment[\s\S]{0,160}verified/i,
      );
    }
    assert.match(incidentTemplate, /owner:\s*<incident-coordinator>/);
    assert.match(incidentTemplate, /in schema 1, owner is the lifecycle coordinator/i);
    assert.match(incidentTemplate, /action actor may differ/i);
    assert.match(incidentTemplate, /actor responsible for operating or expiring it/i);
  });

  it("top-level verify includes evaluation benchmark tests", () => {
    const verify = readFileSync(path.join(root, "scripts", "verify.mjs"), "utf8");
    assert.match(verify, /tests\/evaluation-fixtures\.test\.mjs/);
    assert.match(verify, /tests\/evaluation-report\.test\.mjs/);
  });

  it("top-level verify avoids shell-spawned node commands", () => {
    const verify = readFileSync(path.join(root, "scripts", "verify.mjs"), "utf8");
    assert.doesNotMatch(verify, /shell:\s*process\.platform\s*===\s*"win32"/);
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
      const nestedManifest = path.join(
        fixtureRoot,
        "skills",
        "loop-compass",
        "references",
        "manifest.yaml",
      );
      writeFileSync(nestedManifest, "nested payload\n");
      const generated = runReleaseAt(fixtureRoot, "generate");
      assert.equal(generated.status, 0, generated.stderr || generated.stdout);

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
      assert.ok(man["references/manifest.yaml"]);
      assert.equal(
        readFileSync(path.join(staged, "references", "manifest.yaml"), "utf8"),
        "nested payload\n",
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
      assert.equal(
        readFileSync(path.join(staged, "scripts", "redact-check.mjs"), "utf8"),
        readFileSync(
          path.join(root, "skills", "loop-compass", "scripts", "redact-check.mjs"),
          "utf8",
        ),
      );
      const stagedManifest = path.join(staged, "manifest.yaml");
      writeFileSync(
        stagedManifest,
        readFileSync(stagedManifest, "utf8").replace(
          /^commit:\s*.+$/m,
          `commit: ${"f".repeat(40)}`,
        ),
      );
      const consumer = path.join(fixtureRoot, "consumer");
      mkdirSync(consumer);
      const stagedInstall = runReleaseAt(
        fixtureRoot,
        "stage-install",
        "--project",
        consumer,
        "--hosts",
        "agents",
      );
      assert.equal(stagedInstall.status, 0, stagedInstall.stderr || stagedInstall.stdout);
      const installedSkill = path.join(
        consumer,
        ".agents",
        "skills",
        "loop-compass",
      );
      const compatibility = runReleaseAt(
        fixtureRoot,
        "check",
        "--installed",
        installedSkill,
        "--release-manifest",
        stagedManifest,
      );
      assert.equal(
        compatibility.status,
        0,
        compatibility.stderr || compatibility.stdout,
      );
      assert.match(compatibility.stdout, /status: up to date/);
      const installedManifest = path.join(installedSkill, "manifest.yaml");
      const originalInstalledManifest = readFileSync(installedManifest, "utf8");
      for (const suffix of ["# comment\n", "unknown_field: value\n"]) {
        writeFileSync(installedManifest, `${originalInstalledManifest}${suffix}`);
        const drift = runReleaseAt(
          fixtureRoot,
          "check",
          "--installed",
          installedSkill,
          "--release-manifest",
          stagedManifest,
        );
        assert.notEqual(drift.status, 0);
        assert.match(drift.stderr, /release operation failed stable filesystem validation/);
        assert.doesNotMatch(drift.stderr, /comment|unknown_field/);
      }
      writeFileSync(installedManifest, originalInstalledManifest);

      const bothDrift = `${originalInstalledManifest}# identical drift\n`;
      writeFileSync(installedManifest, bothDrift);
      const driftedRelease = path.join(fixtureRoot, "both-drift.yaml");
      writeFileSync(driftedRelease, bothDrift);
      const sameInvalidBytes = runReleaseAt(
        fixtureRoot,
        "check",
        "--installed",
        installedSkill,
        "--release-manifest",
        driftedRelease,
      );
      assert.notEqual(sameInvalidBytes.status, 0);
      assert.match(
        sameInvalidBytes.stderr,
        /release operation failed stable filesystem validation/,
      );
      assert.doesNotMatch(sameInvalidBytes.stderr, /identical drift/);
      writeFileSync(installedManifest, originalInstalledManifest);

      const unsafePathManifest = originalInstalledManifest.replace(
        /^files:$/m,
        `files:\n  unsafe # comment.md: ${"a".repeat(64)}`,
      );
      writeFileSync(installedManifest, unsafePathManifest);
      const unsafeInstall = runReleaseAt(
        fixtureRoot,
        "check",
        "--installed",
        installedSkill,
        "--release-manifest",
        stagedManifest,
      );
      assert.notEqual(unsafeInstall.status, 0);
      assert.match(
        unsafeInstall.stderr,
        /release operation failed stable filesystem validation/,
      );
      assert.doesNotMatch(unsafeInstall.stderr, /unsafe|comment/);
      writeFileSync(installedManifest, originalInstalledManifest);

      writeFileSync(path.join(installedSkill, ".hidden-payload"), "unexpected\n");
      let unexpected = runReleaseAt(
        fixtureRoot,
        "check",
        "--installed",
        installedSkill,
        "--release-manifest",
        stagedManifest,
      );
      assert.notEqual(unexpected.status, 0);
      assert.match(unexpected.stderr, /payload does not match its manifest/);
      assert.doesNotMatch(unexpected.stderr, /hidden-payload/);
      rmSync(path.join(installedSkill, ".hidden-payload"));

      symlinkSync("SKILL.md", path.join(installedSkill, "unexpected-link"));
      unexpected = runReleaseAt(
        fixtureRoot,
        "check",
        "--installed",
        installedSkill,
        "--release-manifest",
        stagedManifest,
      );
      assert.notEqual(unexpected.status, 0);
      assert.match(unexpected.stderr, /payload does not match its manifest/);
      assert.doesNotMatch(unexpected.stderr, /unexpected-link/);
      rmSync(path.join(installedSkill, "unexpected-link"));

      const mismatchedRelease = path.join(fixtureRoot, "same-commit-mismatch.yaml");
      writeFileSync(
        mismatchedRelease,
        readFileSync(installedManifest, "utf8").replace(
          /^policy_version:\s*.+$/m,
          "policy_version: 999",
        ).replace(
          /^minimum_policy_version:\s*.+$/m,
          "minimum_policy_version: 999",
        ),
      );
      const sameCommitMismatch = runReleaseAt(
        fixtureRoot,
        "check",
        "--installed",
        installedSkill,
        "--release-manifest",
        mismatchedRelease,
      );
      assert.notEqual(sameCommitMismatch.status, 0);
      assert.match(
        sameCommitMismatch.stderr,
        /manifest bytes do not match release payload/,
      );
      writeFileSync(
        path.join(
          installedSkill,
          "scripts",
          "redact-check.mjs",
        ),
        "// payload drift\n",
      );
      const drifted = runReleaseAt(
        fixtureRoot,
        "check",
        "--installed",
        path.join(fixtureRoot, "skills", "loop-compass"),
        "--release-manifest",
        stagedManifest,
      );
      assert.notEqual(drifted.status, 0);
      assert.match(drifted.stderr, /payload does not match its manifest/);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("never accepts substituted installed bytes during an interleaved integrity walk", async () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "lc-check-race-"));
    try {
      const project = path.join(fixtureRoot, "consumer");
      mkdirSync(project);
      const stage = runRelease(
        "stage-install",
        "--project",
        project,
        "--hosts",
        "agents",
      );
      assert.equal(stage.status, 0, stage.stderr || stage.stdout);
      const installed = path.join(
        project,
        ".agents",
        "skills",
        "loop-compass",
      );
      const target = path.join(installed, "SKILL.md");
      const held = path.join(installed, "SKILL.held");
      const alternate = path.join(fixtureRoot, "alternate");
      writeFileSync(alternate, "outside-marker\n");
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
          target,
          held,
          alternate,
        ],
        { stdio: "ignore" },
      );
      const done = new Promise((resolve, reject) => {
        swapper.once("error", reject);
        swapper.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`swapper exited ${code}`)),
        );
      });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const check = runRelease(
          "check",
          "--installed",
          installed,
          "--release-manifest",
          path.join(root, "skills", "loop-compass", "manifest.yaml"),
        );
        assert.ok([0, 1].includes(check.status), check.stderr || check.stdout);
        assert.doesNotMatch(check.stdout + check.stderr, /outside-marker|SKILL\.held/);
      }
      await done;
      const finalCheck = runRelease(
        "check",
        "--installed",
        installed,
        "--release-manifest",
        path.join(root, "skills", "loop-compass", "manifest.yaml"),
      );
      assert.equal(finalCheck.status, 0, finalCheck.stderr || finalCheck.stdout);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
