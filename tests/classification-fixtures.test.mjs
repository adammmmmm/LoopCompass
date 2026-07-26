import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { LANES } from "../scripts/lib/frontmatter.mjs";
import { signatureIdentity } from "../scripts/lib/signature.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures", "classification", "cases.json");
const completionFixturePath = path.join(
  root,
  "fixtures",
  "classification",
  "completion-cases.json",
);

function completionResult(c) {
  const hasTerminalOutcome = new Set([
    "persisted_artifact",
    "no_artifact",
    "proposed_artifact",
  ]).has(c.terminal_outcome);
  if (!c.triggered) return hasTerminalOutcome;
  if (!hasTerminalOutcome) return false;

  if (c.mechanism_health !== "healthy") {
    return (
      c.classification === "incident"
      && new Set(["persisted_artifact", "proposed_artifact"]).has(c.terminal_outcome)
    );
  }

  if (c.directional_resolution) {
    return (
      c.normal_path_authority_updated
      && c.containment_removed
      && c.normal_path_verified
    );
  }
  return c.normal_path_verified;
}

describe("classification fixtures", () => {
  const doc = JSON.parse(readFileSync(fixturePath, "utf8"));

  it("has schema and non-empty cases", () => {
    assert.equal(doc.schema, 1);
    assert.ok(Array.isArray(doc.cases));
    assert.ok(doc.cases.length >= 10);
  });

  it("every case has unique id, valid lane, and mechanical identity", () => {
    const seen = new Set();
    for (const c of doc.cases) {
      assert.ok(c.id, "missing id");
      assert.equal(seen.has(c.id), false, `duplicate id ${c.id}`);
      seen.add(c.id);
      assert.ok(LANES.has(c.lane), `invalid lane ${c.lane} on ${c.id}`);
      assert.ok(c.failure && c.failure.length > 10, `weak failure on ${c.id}`);
      assert.ok(c.rationale && c.rationale.length > 10, `weak rationale on ${c.id}`);

      const { normalized, slug } = signatureIdentity(c.failure);
      assert.ok(normalized.length > 0, `empty normalized on ${c.id}`);
      assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(slug.length <= 96);
      // Secrets and raw emails must not survive normalization.
      assert.equal(/\bBearer\s+\S+/i.test(normalized), false, c.id);
      assert.equal(/ghp_[A-Za-z0-9]+/.test(normalized), false, c.id);
      assert.equal(/@example\.com/i.test(normalized), false, c.id);
    }
  });

  it("covers all four lanes", () => {
    const lanes = new Set(doc.cases.map((c) => c.lane));
    for (const lane of LANES) {
      assert.ok(lanes.has(lane), `missing lane coverage: ${lane}`);
    }
  });

  it("volatile noise does not fork identity for uuid-path case", () => {
    const base = doc.cases.find((c) => c.id === "uuid-path-collision-shape");
    assert.ok(base);
    const a = signatureIdentity(base.failure);
    const b = signatureIdentity(
      base.failure
        .replace(/550e8400-e29b-41d4-a716-446655440000/, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
        .replace(/TASK-042-abc/, "TASK-099-zzz"),
    );
    assert.equal(a.slug, b.slug);
  });
});

describe("classification completion fixtures", () => {
  const doc = JSON.parse(readFileSync(completionFixturePath, "utf8"));

  it("keeps task outcome distinct from mechanism health", () => {
    assert.equal(doc.schema, 1);
    assert.ok(doc.cases.length >= 5);
    for (const c of doc.cases) {
      assert.ok(c.id);
      assert.equal(c.task_outcome, "succeeded", c.id);
      assert.ok(c.mechanism_health, c.id);
      assert.ok(c.terminal_outcome, c.id);
      assert.ok(["pass", "fail"].includes(c.expected_result), c.id);
      assert.equal(
        completionResult(c) ? "pass" : "fail",
        c.expected_result,
        c.id,
      );
    }
  });

  it("rejects later workaround success without terminal classification", () => {
    const c = doc.cases.find(
      (item) => item.id === "alternate-runtime-success-erases-classification",
    );
    assert.ok(c);
    assert.equal(c.task_outcome, "succeeded");
    assert.equal(c.mechanism_health, "broken");
    assert.equal(completionResult(c), false);
  });

  it("accepts successful containment only while the incident remains reviewable", () => {
    const c = doc.cases.find(
      (item) => item.id === "alternate-runtime-is-bounded-containment",
    );
    assert.ok(c);
    assert.equal(c.task_outcome, "succeeded");
    assert.equal(c.mechanism_health, "broken");
    assert.equal(c.terminal_outcome, "persisted_artifact");
    assert.equal(completionResult(c), true);
  });

  it("requires authority update, containment removal, and verification for directional closure", () => {
    const invalid = doc.cases.find(
      (item) => item.id === "directional-decision-without-authority-update",
    );
    const valid = doc.cases.find(
      (item) => item.id === "verified-directional-resolution",
    );
    assert.ok(invalid);
    assert.ok(valid);
    assert.equal(completionResult(invalid), false);
    assert.equal(completionResult(valid), true);
  });

  it("does not let acknowledgment close a verification-pending incident", () => {
    const c = doc.cases.find(
      (item) => item.id === "acknowledgment-without-verification",
    );
    assert.ok(c);
    assert.equal(c.acknowledged, true);
    assert.equal(c.normal_path_verified, false);
    assert.equal(completionResult(c), false);
  });

  it("does not infer credential failure from a restricted-network auth status", () => {
    const c = doc.cases.find(
      (item) => item.id === "restricted-network-credential-diagnosis",
    );
    assert.ok(c);
    assert.deepEqual(c.network_reachability, {
      restricted_probe: "unavailable",
      supported_probe: "reachable",
    });
    assert.equal(c.credential_validity, "valid");
    assert.equal(c.git_commit_identity, "configured_separately");
    assert.equal(c.credential_mutation_recommended, false);
    assert.equal(completionResult(c), true);
  });
});
