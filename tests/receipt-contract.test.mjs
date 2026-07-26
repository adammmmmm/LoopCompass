import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateParentReceipt,
  validateTerminalReceipt,
} from "../scripts/lib/receipt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptReference = readFileSync(
  path.join(root, "skills", "loop-compass", "references", "terminal-receipts.md"),
  "utf8",
);
const fixture = JSON.parse(
  readFileSync(path.join(root, "fixtures", "evaluation", "cases.json"), "utf8"),
);
const persisted = fixture.cases.find(
  (c) => c.id === "lc-eval-012-workaround-is-containment",
).receipt.terminal_receipt;
const propagatedCase = fixture.cases.find(
  (c) => c.id === "lc-eval-013-parent-without-store-propagates",
).receipt;

describe("terminal receipt contract", () => {
  it("accepts task completion while mechanism health remains broken", () => {
    assert.equal(persisted.task_outcome, "completed");
    assert.equal(persisted.mechanism_health, "broken");
    assert.doesNotThrow(() => validateTerminalReceipt(structuredClone(persisted)));
  });

  it("rejects every missing load-bearing classification field", () => {
    const required = [
      "receipt_schema",
      "receipt_id",
      "signature",
      "dedupe_key",
      "classification",
      "evidence",
      "task_outcome",
      "mechanism_health",
      "containment",
      "terminal_outcome",
      "artifact_ref",
      "no_artifact_reason",
      "proposed_artifact",
      "escalation",
    ];

    for (const field of required) {
      const receipt = structuredClone(persisted);
      delete receipt[field];
      assert.throws(
        () => validateTerminalReceipt(receipt),
        new RegExp(`terminal_receipt\\.${field} is required`),
        field,
      );
    }
  });

  it("rejects blank, malformed, and outcome-inconsistent payloads", () => {
    const blank = structuredClone(persisted);
    blank.signature = " ";
    assert.throws(
      () => validateTerminalReceipt(blank),
      /terminal_receipt\.signature must be a non-empty string/,
    );

    const malformed = structuredClone(persisted);
    malformed.evidence = "raw transcript";
    assert.throws(
      () => validateTerminalReceipt(malformed),
      /terminal_receipt\.evidence must be a non-empty array/,
    );

    const inconsistent = structuredClone(persisted);
    inconsistent.terminal_outcome = "no_artifact";
    assert.throws(
      () => validateTerminalReceipt(inconsistent),
      /no_artifact_reason is required for no_artifact/,
    );
  });

  it("requires bounded containment details and a verification gate", () => {
    const receipt = structuredClone(persisted);
    receipt.containment.verification_gate = null;
    assert.throws(
      () => validateTerminalReceipt(receipt),
      /requires summary and verification_gate when used is true/,
    );
  });

  it("requires an exact escalation for incident and external classifications", () => {
    const receipt = structuredClone(persisted);
    receipt.escalation = null;
    assert.throws(
      () => validateTerminalReceipt(receipt),
      /escalation is required for incident classification/,
    );
  });

  it("validates linked authoritative and propagating parent receipts", () => {
    const worker = propagatedCase.terminal_receipt;
    const parent = propagatedCase.parent_receipt;
    assert.doesNotThrow(() =>
      validateParentReceipt(structuredClone(parent), structuredClone(worker)),
    );

    const authoritativeCase = fixture.cases.find(
      (c) => c.id === "lc-eval-008-subagent-readonly-handoff",
    ).receipt;
    assert.doesNotThrow(() =>
      validateParentReceipt(
        structuredClone(authoritativeCase.parent_receipt),
        structuredClone(authoritativeCase.terminal_receipt),
      ),
    );

    const reordered = structuredClone(parent);
    reordered.forwarded_receipt = Object.fromEntries(
      Object.entries(reordered.forwarded_receipt).reverse(),
    );
    assert.doesNotThrow(() =>
      validateParentReceipt(reordered, structuredClone(worker)),
    );
  });

  it("rejects broken links and partial further propagation", () => {
    const wrongLink = structuredClone(propagatedCase.parent_receipt);
    wrongLink.child_receipt_id = "different-child";
    assert.throws(
      () => validateParentReceipt(wrongLink, propagatedCase.terminal_receipt),
      /child_receipt_id must match/,
    );

    const partial = structuredClone(propagatedCase.parent_receipt);
    delete partial.forwarded_receipt.evidence;
    assert.throws(
      () => validateParentReceipt(partial, propagatedCase.terminal_receipt),
      /forwarded_receipt must preserve the complete child receipt unchanged/,
    );
  });

  it("independently rejects a malformed child passed to the parent validator", () => {
    const malformedChild = structuredClone(propagatedCase.terminal_receipt);
    delete malformedChild.mechanism_health;
    assert.throws(
      () =>
        validateParentReceipt(
          structuredClone(propagatedCase.parent_receipt),
          malformedChild,
        ),
      /parent_receipt\.child_receipt\.mechanism_health is required/,
    );
  });

  it("requires worker-side sanitation before identity derivation and first handoff", () => {
    const sanitize = receiptReference.indexOf("Sanitize source");
    const derive = receiptReference.indexOf("Only after sanitation");
    assert.ok(sanitize >= 0);
    assert.ok(derive > sanitize);
    assert.match(receiptReference, /before the first handoff or write/i);
    assert.match(receiptReference, /every field/i);
    assert.match(receiptReference, /functional\s+roles instead of identities/i);
    assert.match(
      receiptReference,
      /Host sanitation\s+checks are defense in depth only/i,
    );
    assert.match(
      receiptReference,
      /do not defer or replace the emitting actor's sanitation/i,
    );
  });
});
