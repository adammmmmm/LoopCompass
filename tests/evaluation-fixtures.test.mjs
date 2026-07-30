import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures", "evaluation", "cases.json");

describe("evaluation benchmark fixtures", () => {
  it("provides versioned deterministic cases with a recorded baseline", () => {
    assert.ok(existsSync(fixturePath), "missing fixtures/evaluation/cases.json");

    const doc = JSON.parse(readFileSync(fixturePath, "utf8"));
    assert.equal(doc.schema, 1);
    assert.equal(doc.baseline.commit, "d7879fec762322ae658603104c7c334ade6ba43f");
    assert.equal(doc.live_integration_required, false);
    assert.ok(Array.isArray(doc.cases));
    assert.ok(doc.cases.length >= 13);
    assert.equal(doc.metrics[2], "skill_decision_quality");
  });

  it("covers host, parent, subagent, missing-skill, and missing-instruction dimensions", () => {
    const doc = JSON.parse(readFileSync(fixturePath, "utf8"));
    const hosts = new Set(doc.cases.map((c) => c.scope?.host));
    const roles = new Set(doc.cases.map((c) => c.scope?.agent_role));
    const skillStates = new Set(doc.cases.map((c) => c.scope?.skill_state));
    const projectInstructions = new Set(doc.cases.map((c) => c.scope?.project_instructions));

    assert.deepEqual(hosts, new Set(["claude-synthetic", "codex-synthetic", "grok-cli-synthetic"]));
    assert.ok(roles.has("parent"));
    assert.ok(roles.has("subagent-readonly"));
    assert.ok(skillStates.has("present"));
    assert.ok(skillStates.has("missing"));
    assert.ok(projectInstructions.has("present"));
    assert.ok(projectInstructions.has("inherited"));
    assert.ok(projectInstructions.has("missing"));
  });

  it("keeps missing-skill fallback narrow and policy-directed", () => {
    const doc = JSON.parse(readFileSync(fixturePath, "utf8"));
    const fallback = doc.cases.find(
      (c) => c.id === "lc-eval-009-missing-skill-fallback",
    );
    assert.ok(fallback);
    assert.match(fallback.scenario, /top matching/i);
    assert.equal(fallback.scope.skill_state, "missing");
    assert.equal(fallback.scope.project_instructions, "present");
  });

  it("pairs workaround failure with containment and closes read-only handoffs", () => {
    const doc = JSON.parse(readFileSync(fixturePath, "utf8"));
    const byId = new Map(doc.cases.map((c) => [c.id, c]));
    const missed = byId.get("lc-eval-011-workaround-erases-classification");
    const contained = byId.get("lc-eval-012-workaround-is-containment");
    const closed = byId.get("lc-eval-008-subagent-readonly-handoff");
    const propagated = byId.get("lc-eval-013-parent-without-store-propagates");
    const external = byId.get("lc-eval-006-external-limit");

    assert.equal(missed.receipt.terminal_receipt, null);
    assert.equal(missed.expected.terminal_receipt_required, true);
    assert.equal(contained.receipt.terminal_receipt.task_outcome, "completed");
    assert.equal(contained.receipt.terminal_receipt.mechanism_health, "broken");
    assert.equal(contained.receipt.terminal_receipt.containment.used, true);
    assert.equal(external.receipt.terminal_outcome, "persisted_artifact");
    assert.equal(external.expected.parent_receipt_required, false);
    assert.deepEqual(
      contained.expected.terminal_receipt_semantics,
      {
        signature: contained.receipt.terminal_receipt.signature,
        dedupe_key: contained.receipt.terminal_receipt.dedupe_key,
        evidence: contained.receipt.terminal_receipt.evidence,
        task_outcome: contained.receipt.terminal_receipt.task_outcome,
        mechanism_health: contained.receipt.terminal_receipt.mechanism_health,
        containment: contained.receipt.terminal_receipt.containment,
        artifact_ref: contained.receipt.terminal_receipt.artifact_ref,
        no_artifact_reason: contained.receipt.terminal_receipt.no_artifact_reason,
        proposed_artifact: contained.receipt.terminal_receipt.proposed_artifact,
        escalation: contained.receipt.terminal_receipt.escalation,
      },
    );
    assert.equal(closed.receipt.parent_receipt.terminal_action, "persisted_artifact");
    assert.equal(propagated.receipt.parent_receipt.terminal_action, "proposed_artifact");
    assert.deepEqual(
      propagated.receipt.parent_receipt.forwarded_receipt,
      propagated.receipt.terminal_receipt,
    );
    const parentNoArtifact = byId.get("lc-eval-014-parent-no-artifact");
    const missingParent = byId.get("lc-eval-015-missing-parent-receipt");
    assert.equal(parentNoArtifact.receipt.parent_receipt.terminal_action, "no_artifact");
    assert.ok(parentNoArtifact.receipt.parent_receipt.no_artifact_reason);
    assert.equal(missingParent.receipt.parent_receipt, null);
    assert.equal(
      missingParent.expected.parent_receipt_semantics.terminal_action,
      "persisted_artifact",
    );
  });
});
