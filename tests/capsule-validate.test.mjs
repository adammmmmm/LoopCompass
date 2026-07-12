import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  validateCapsuleText,
  validateStateDir,
} from "../scripts/lib/capsule.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "fixtures", "capsules");
const examples = path.join(root, "examples", "capsules");

describe("capsule validator", () => {
  it("accepts good recovery fixture", () => {
    const text = readFileSync(path.join(fixtures, "good-recovery.md"), "utf8");
    const r = validateCapsuleText(text, {
      kind: "recovery",
      filename: "sandbox-package-cache-outside-writable-root.md",
    });
    assert.deepEqual(r.errors, []);
  });

  it("rejects non-mechanical recovery id", () => {
    const text = readFileSync(path.join(fixtures, "bad-recovery-slug.md"), "utf8");
    const r = validateCapsuleText(text, {
      kind: "recovery",
      filename: "bad-recovery-slug.md",
    });
    assert.ok(r.errors.some((e) => /mechanical slug|filename/i.test(e)));
  });

  it("accepts good incident fixture with future expiry", () => {
    const text = readFileSync(path.join(fixtures, "good-incident.md"), "utf8");
    const r = validateCapsuleText(text, {
      kind: "incident",
      filename: "null-identity-replay-state-stops-periodic-refresh.md",
      today: new Date("2026-07-12T00:00:00Z"),
    });
    assert.deepEqual(r.errors, []);
  });

  it("rejects expired containment on open incident", () => {
    const text = readFileSync(
      path.join(fixtures, "bad-incident-expired.md"),
      "utf8",
    );
    const r = validateCapsuleText(text, {
      kind: "incident",
      filename: "expired-containment-fixture.md",
      today: new Date("2026-07-12T00:00:00Z"),
    });
    assert.ok(r.errors.some((e) => /containment_expires/i.test(e)));
  });

  it("validate-state ok on examples/capsules layout", () => {
    // examples use recoveries/ and incidents/ under examples/capsules
    const tmp = mkdtempSync(path.join(os.tmpdir(), "lc-ex-"));
    after(() => rmSync(tmp, { recursive: true, force: true }));
    // point validate at a synthetic .loopcompass that copies examples
    const state = path.join(tmp, ".loopcompass");
    mkdirSync(path.join(state, "recoveries"), { recursive: true });
    mkdirSync(path.join(state, "incidents"), { recursive: true });
    for (const name of ["automated-browser-vendor-login-blocked.md", "branded-browser-ignores-extension-load-flags.md", "sandbox-package-cache-outside-writable-root.md"]) {
      writeFileSync(
        path.join(state, "recoveries", name),
        readFileSync(path.join(examples, "recoveries", name)),
      );
    }
    for (const name of [
      "exchange-ticker-utc-hhmm-misread-as-local.md",
      "worktree-spawn-from-non-git-cwd.md",
      "null-identity-replay-state-stops-periodic-refresh.md",
    ]) {
      writeFileSync(
        path.join(state, "incidents", name),
        readFileSync(path.join(examples, "incidents", name)),
      );
    }
    const result = validateStateDir(state, {
      today: new Date("2026-07-12T00:00:00Z"),
    });
    assert.deepEqual(result.errors, [], result.errors.join("\n"));
    assert.equal(result.recoveryFiles, 3);
    assert.equal(result.incidentFiles, 3);
  });

  it("CLI validate-state succeeds on staged examples", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "lc-cli-"));
    after(() => rmSync(tmp, { recursive: true, force: true }));
    const state = path.join(tmp, ".loopcompass");
    mkdirSync(path.join(state, "recoveries"), { recursive: true });
    mkdirSync(path.join(state, "incidents"), { recursive: true });
    writeFileSync(
      path.join(state, "recoveries", "sandbox-package-cache-outside-writable-root.md"),
      readFileSync(path.join(examples, "recoveries", "sandbox-package-cache-outside-writable-root.md")),
    );
    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts", "validate-state.mjs"), "--dir", state],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /validate-state ok/);
  });
});
