import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  classifyRecoveryFreshness,
  parseIsoDate,
  validateCapsuleText,
  validateStateDir,
} from "../scripts/lib/capsule.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "fixtures", "capsules");
const examples = path.join(root, "examples", "capsules");

describe("capsule validator", () => {
  it("accepts only real calendar dates", () => {
    assert.ok(parseIsoDate("2026-02-28") instanceof Date);
    assert.equal(parseIsoDate("2026-02-30"), null);
    assert.equal(parseIsoDate("2026-13-01"), null);
  });

  it("keeps recovery freshness current through the exact expiry date", () => {
    const fields = {
      last_verified: "2026-07-01",
      expires_after_days: "30",
    };
    assert.deepEqual(
      classifyRecoveryFreshness(fields, new Date("2026-07-31T23:59:59Z")),
      { freshness: "current", expiryDate: "2026-07-31", errors: [] },
    );
    assert.deepEqual(
      classifyRecoveryFreshness(fields, new Date("2026-08-01T00:00:00Z")),
      { freshness: "stale", expiryDate: "2026-07-31", errors: [] },
    );
  });

  it("uses UTC calendar arithmetic across leap-day and year rollover", () => {
    assert.deepEqual(
      classifyRecoveryFreshness(
        { last_verified: "2024-02-28", expires_after_days: "1" },
        new Date("2024-02-29T12:00:00-08:00"),
      ),
      { freshness: "current", expiryDate: "2024-02-29", errors: [] },
    );
    assert.deepEqual(
      classifyRecoveryFreshness(
        { last_verified: "2025-12-31", expires_after_days: "1" },
        new Date("2026-01-02T00:00:00Z"),
      ),
      { freshness: "stale", expiryDate: "2026-01-01", errors: [] },
    );
  });

  it("classifies null or missing freshness fields as unknown", () => {
    for (const fields of [
      { last_verified: "null", expires_after_days: "30" },
      { last_verified: null, expires_after_days: "30" },
      { expires_after_days: "30" },
      { last_verified: "2026-07-01" },
    ]) {
      assert.deepEqual(
        classifyRecoveryFreshness(fields, new Date("2026-07-01T00:00:00Z")),
        { freshness: "unknown", expiryDate: null, errors: [] },
      );
    }
  });

  it("reports malformed populated freshness values as validation errors", () => {
    const badDate = classifyRecoveryFreshness(
      { last_verified: "2026-02-30", expires_after_days: "30" },
      new Date("2026-07-01T00:00:00Z"),
    );
    assert.match(badDate.errors.join("\n"), /last_verified/);

    for (const expiresAfterDays of ["null", "-1", "1.5", "thirty"]) {
      const result = classifyRecoveryFreshness(
        {
          last_verified: "2026-07-01",
          expires_after_days: expiresAfterDays,
        },
        new Date("2026-07-01T00:00:00Z"),
      );
      assert.match(result.errors.join("\n"), /expires_after_days/);
    }

    const text = readFileSync(path.join(fixtures, "good-recovery.md"), "utf8")
      .replace("last_verified: 2026-07-02", "last_verified: 2026-02-30")
      .replace("expires_after_days: 180", "expires_after_days: thirty");
    const validation = validateCapsuleText(text, {
      kind: "recovery",
      filename: "sandbox-package-cache-outside-writable-root.md",
      today: new Date("2026-07-01T00:00:00Z"),
    });
    assert.match(validation.errors.join("\n"), /last_verified/);
    assert.match(validation.errors.join("\n"), /expires_after_days/);
  });

  it("reports freshness diagnostics without changing stored status", () => {
    const text = readFileSync(path.join(fixtures, "good-recovery.md"), "utf8");
    const stale = validateCapsuleText(text, {
      kind: "recovery",
      filename: "sandbox-package-cache-outside-writable-root.md",
      today: new Date("2027-01-01T00:00:00Z"),
    });
    assert.deepEqual(stale.errors, []);
    assert.match(stale.warnings.join("\n"), /freshness is stale/);
    assert.match(text, /status: verified/);

    const unknown = validateCapsuleText(
      text.replace("last_verified: 2026-07-02", "last_verified: null"),
      {
        kind: "recovery",
        filename: "sandbox-package-cache-outside-writable-root.md",
        today: new Date("2027-01-01T00:00:00Z"),
      },
    );
    assert.deepEqual(unknown.errors, []);
    assert.match(unknown.warnings.join("\n"), /freshness is unknown/);
  });

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

  it("accepts only exact or unpadded collision ids across capsule validation", () => {
    const text = readFileSync(path.join(fixtures, "good-recovery.md"), "utf8");
    const baseId = "sandbox-package-cache-outside-writable-root";
    for (const suffix of ["-0", "-1", "-01", "-02"]) {
      const id = `${baseId}${suffix}`;
      const result = validateCapsuleText(
        text.replace(`id: ${baseId}`, `id: ${id}`),
        { kind: "recovery", filename: `${id}.md` },
      );
      assert.ok(
        result.errors.some((error) => /id must be mechanical slug of signature/.test(error)),
        suffix,
      );
    }

    const collisionId = `${baseId}-2`;
    const collision = validateCapsuleText(
      text.replace(`id: ${baseId}`, `id: ${collisionId}`),
      { kind: "recovery", filename: `${collisionId}.md` },
    );
    assert.deepEqual(collision.errors, []);
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
