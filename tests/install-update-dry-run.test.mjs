import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
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
const skillSrc = path.join(root, "skills", "loop-compass");
const policySrc = path.join(skillSrc, "assets", "project-policy.md");
const releaseManifest = path.join(skillSrc, "manifest.yaml");

function runNode(args, cwd = root) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
  });
}

describe("install and update dry-run", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "loopcompass-dry-"));
  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("stages a project-scope skill and validates digests against release manifest", () => {
    const project = path.join(tmp, "consumer-project");
    const skillDest = path.join(project, "skills", "loop-compass");
    mkdirSync(path.dirname(skillDest), { recursive: true });
    cpSync(skillSrc, skillDest, { recursive: true });

    assert.ok(existsSync(path.join(skillDest, "SKILL.md")));
    assert.ok(existsSync(path.join(skillDest, "manifest.yaml")));

    const policy = readFileSync(policySrc, "utf8");
    assert.match(policy, /loopcompass:start policy=\d+/);
    assert.match(policy, /loopcompass:end/);

    const agentsPath = path.join(project, "AGENTS.md");
    writeFileSync(
      agentsPath,
      `# Project\n\n${policy}\n\n## Other rules\n\nKeep this byte-stable.\n`,
      "utf8",
    );

    const installed = readFileSync(agentsPath, "utf8");
    assert.equal(installed.includes(policy.trim()), true);
    assert.match(installed, /Other rules/);

    // Non-mutating check: installed skill matches the repo release manifest.
    const check = runNode([
      path.join(root, "scripts", "release.mjs"),
      "check",
      "--installed",
      skillDest,
      "--release-manifest",
      releaseManifest,
    ]);
    assert.equal(check.status, 0, check.stderr || check.stdout);
    assert.match(check.stdout, /status: up to date/);
  });

  it("detects a behind install when release version is higher", () => {
    const project = path.join(tmp, "behind-project");
    const skillDest = path.join(project, "skills", "loop-compass");
    mkdirSync(path.dirname(skillDest), { recursive: true });
    cpSync(skillSrc, skillDest, { recursive: true });

    const installedManifest = path.join(skillDest, "manifest.yaml");
    const text = readFileSync(installedManifest, "utf8").replace(
      /^version:\s*.+$/m,
      "version: 0.0.1",
    );
    writeFileSync(installedManifest, text, "utf8");

    const check = runNode([
      path.join(root, "scripts", "release.mjs"),
      "check",
      "--installed",
      skillDest,
      "--release-manifest",
      releaseManifest,
    ]);
    assert.equal(check.status, 2, check.stderr || check.stdout);
    assert.match(check.stdout, /behind/);
  });

  it("preserves .loopcompass state paths during a staged skill replace", () => {
    const project = path.join(tmp, "state-project");
    const skillDest = path.join(project, "skills", "loop-compass");
    const recoveries = path.join(project, ".loopcompass", "recoveries");
    mkdirSync(skillDest, { recursive: true });
    mkdirSync(recoveries, { recursive: true });
    cpSync(skillSrc, skillDest, { recursive: true });

    const recoveryFile = path.join(recoveries, "sample-recovery.md");
    const body = `---
id: sample-recovery
schema: 1
signature: "sample recovery signature"
status: verified
---

# Sample
`;
    writeFileSync(recoveryFile, body, "utf8");

    // Simulate update: replace skill tree only.
    rmSync(skillDest, { recursive: true, force: true });
    cpSync(skillSrc, skillDest, { recursive: true });

    assert.equal(readFileSync(recoveryFile, "utf8"), body);
    assert.ok(existsSync(path.join(skillDest, "manifest.yaml")));
  });
});
