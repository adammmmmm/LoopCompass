import assert from "node:assert/strict";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

function runReleaseAt(releaseRoot, args, cwd = releaseRoot) {
  return spawnSync(
    process.execPath,
    [path.join(releaseRoot, "scripts", "release.mjs"), ...args],
    { cwd, encoding: "utf8" },
  );
}

function copyReleaseFixture(destination) {
  for (const name of ["scripts", "skills", "docs"]) {
    cpSync(path.join(root, name), path.join(destination, name), { recursive: true });
  }
  for (const name of ["VERSION", "LICENSE", "CHANGELOG.md", "README.md"]) {
    copyFileSync(path.join(root, name), path.join(destination, name));
  }
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
    for (const args of [
      ["init", "-q"],
      ["config", "user.name", "Worker"],
      ["config", "user.email", "worker@example.com"],
      ["add", ".loopcompass"],
      ["commit", "-m", "test state"],
    ]) {
      const git = spawnSync("git", args, { cwd: project, encoding: "utf8" });
      assert.equal(git.status, 0, git.stderr || git.stdout);
    }

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
    const checkerRel = path.join("scripts", "redact-check.mjs");
    const sourceChecker = readFileSync(
      path.join(root, "skills", "loop-compass", checkerRel),
    );
    assert.deepEqual(
      readFileSync(
        path.join(project, ".agents", "skills", "loop-compass", checkerRel),
      ),
      sourceChecker,
    );
    assert.deepEqual(
      readFileSync(
        path.join(project, ".claude", "skills", "loop-compass", checkerRel),
      ),
      sourceChecker,
    );
    const installedCheck = spawnSync(
      process.execPath,
      [
        path.join(
          project,
          ".agents",
          "skills",
          "loop-compass",
          checkerRel,
        ),
        "--project",
        project,
        "--mode",
        "audit",
      ],
      { cwd: project, encoding: "utf8" },
    );
    assert.equal(installedCheck.status, 0, installedCheck.stderr || installedCheck.stdout);
    assert.match(installedCheck.stdout, /loopcompass-redaction audit/);
    assert.ok(existsSync(path.join(stateRec, "keep-me.md")));
  });

  it("leaves both host destinations untouched when the source is invalid", () => {
    for (const scenario of ["invalid-name", "byte-drift"]) {
      const fixture = path.join(tmp, `release-${scenario}`);
      const project = path.join(tmp, `project-${scenario}`);
      mkdirSync(fixture);
      mkdirSync(project);
      copyReleaseFixture(fixture);

      const destinations = [
        path.join(project, ".agents", "skills", "loop-compass"),
        path.join(project, ".claude", "skills", "loop-compass"),
      ];
      for (const destination of destinations) {
        mkdirSync(destination, { recursive: true });
        writeFileSync(path.join(destination, "sentinel.txt"), `${scenario}\n`);
      }

      if (scenario === "invalid-name") {
        writeFileSync(
          path.join(
            fixture,
            "skills",
            "loop-compass",
            "references",
            "unsafe # comment.md",
          ),
          "payload\n",
        );
      } else {
        writeFileSync(
          path.join(fixture, "skills", "loop-compass", "SKILL.md"),
          "drifted source\n",
        );
      }

      const result = runReleaseAt(fixture, [
        "stage-install",
        "--project",
        project,
        "--hosts",
        "agents,claude",
      ]);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, /unsafe|comment|SKILL\.md/);
      for (const destination of destinations) {
        assert.equal(
          readFileSync(path.join(destination, "sentinel.txt"), "utf8"),
          `${scenario}\n`,
        );
        assert.deepEqual(
          readdirSync(destination),
          ["sentinel.txt"],
        );
      }
    }
  });

  it("rejects a symlinked host ancestor without touching its target", () => {
    const project = path.join(tmp, "project-symlink-parent");
    const outside = path.join(tmp, "outside-symlink-parent");
    mkdirSync(project);
    mkdirSync(outside);
    writeFileSync(path.join(outside, "sentinel.txt"), "unchanged\n");
    symlinkSync(outside, path.join(project, ".agents"));

    const result = runRelease([
      "stage-install",
      "--project",
      project,
      "--hosts",
      "agents",
    ]);
    assert.notEqual(result.status, 0);
    assert.equal(
      readFileSync(path.join(outside, "sentinel.txt"), "utf8"),
      "unchanged\n",
    );
    assert.deepEqual(readdirSync(outside), ["sentinel.txt"]);
  });
});
