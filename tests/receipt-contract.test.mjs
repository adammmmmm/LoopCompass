import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  receiptPayloadDigest,
  validateParentReceipt,
  validateTerminalReceipt,
} from "../scripts/lib/receipt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptReference = readFileSync(
  path.join(root, "skills", "loop-compass", "references", "terminal-receipts.md"),
  "utf8",
);
const incidentTemplate = readFileSync(
  path.join(root, "skills", "loop-compass", "assets", "incident-template.md"),
  "utf8",
);
const recoveryTemplate = readFileSync(
  path.join(root, "skills", "loop-compass", "assets", "recovery-template.md"),
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
const parentNoArtifactCase = fixture.cases.find(
  (c) => c.id === "lc-eval-014-parent-no-artifact",
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

  it("binds a parent to the canonical complete child payload and distinct ids", () => {
    const swappedChild = structuredClone(propagatedCase.terminal_receipt);
    swappedChild.evidence.push("Different sanitized evidence.");
    assert.throws(
      () =>
        validateParentReceipt(
          structuredClone(propagatedCase.parent_receipt),
          swappedChild,
        ),
      /child_payload_sha256 must bind the complete child receipt/,
    );

    const duplicateId = structuredClone(propagatedCase.parent_receipt);
    duplicateId.receipt_id = duplicateId.child_receipt_id;
    assert.throws(
      () => validateParentReceipt(duplicateId, propagatedCase.terminal_receipt),
      /receipt_id must differ from child_receipt_id/,
    );

    const reordered = Object.fromEntries(
      Object.entries(propagatedCase.terminal_receipt).reverse(),
    );
    assert.equal(
      receiptPayloadDigest(reordered),
      receiptPayloadDigest(propagatedCase.terminal_receipt),
    );
  });

  it("requires exact persistence escalation for authoritative incident actions", () => {
    const authoritativeCase = fixture.cases.find(
      (c) => c.id === "lc-eval-008-subagent-readonly-handoff",
    ).receipt;
    const parent = structuredClone(authoritativeCase.parent_receipt);
    parent.escalation = null;
    assert.throws(
      () => validateParentReceipt(parent, authoritativeCase.terminal_receipt),
      /escalation is required when persisting an incident/,
    );
  });

  it("requires escalation for authoritative persisted external incidents", () => {
    const authoritativeCase = fixture.cases.find(
      (c) => c.id === "lc-eval-008-subagent-readonly-handoff",
    ).receipt;
    const child = structuredClone(authoritativeCase.terminal_receipt);
    child.classification = "external";
    const parent = structuredClone(authoritativeCase.parent_receipt);
    parent.child_payload_sha256 = receiptPayloadDigest(child);
    parent.escalation = null;
    assert.throws(
      () => validateParentReceipt(parent, child),
      /escalation is required when persisting an incident or external incident/,
    );
  });

  it("accepts a linked parent no-artifact action with an exact reason", () => {
    assert.doesNotThrow(() =>
      validateParentReceipt(
        structuredClone(parentNoArtifactCase.parent_receipt),
        structuredClone(parentNoArtifactCase.terminal_receipt),
      ),
    );
    assert.equal(parentNoArtifactCase.parent_receipt.terminal_action, "no_artifact");
    assert.ok(parentNoArtifactCase.parent_receipt.no_artifact_reason);

    const continuingEscalation = structuredClone(parentNoArtifactCase.parent_receipt);
    continuingEscalation.escalation =
      structuredClone(parentNoArtifactCase.terminal_receipt.escalation);
    assert.throws(
      () =>
        validateParentReceipt(
          continuingEscalation,
          parentNoArtifactCase.terminal_receipt,
        ),
      /no_artifact requires escalation null/,
    );
  });

  it("requires a propagating parent to preserve the child proposed artifact", () => {
    const changed = structuredClone(propagatedCase.parent_receipt);
    changed.proposed_artifact.content =
      changed.proposed_artifact.content.replace(
        "Make launcher discovery and authentication preflight host-aware.",
        "Make launcher discovery host-aware and authentication preflight deterministic.",
      );
    assert.throws(
      () => validateParentReceipt(changed, propagatedCase.terminal_receipt),
      /proposed_artifact must preserve the complete child proposed artifact/,
    );
  });

  it("rejects unknown fields at every receipt layer", () => {
    const terminal = structuredClone(persisted);
    terminal.raw_log = "unmodeled content";
    assert.throws(
      () => validateTerminalReceipt(terminal),
      /terminal_receipt\.raw_log is not allowed/,
    );

    const nested = structuredClone(persisted);
    nested.containment.transcript = "unmodeled content";
    assert.throws(
      () => validateTerminalReceipt(nested),
      /terminal_receipt\.containment\.transcript is not allowed/,
    );

    const parent = structuredClone(parentNoArtifactCase.parent_receipt);
    parent.raw_output = "unmodeled content";
    assert.throws(
      () => validateParentReceipt(parent, parentNoArtifactCase.terminal_receipt),
      /parent_receipt\.raw_output is not allowed/,
    );
  });

  it("distinguishes a missing required key from deliberate null", () => {
    const missingTerminalKey = structuredClone(propagatedCase.terminal_receipt);
    delete missingTerminalKey.artifact_ref;
    assert.throws(
      () => validateTerminalReceipt(missingTerminalKey),
      /terminal_receipt\.artifact_ref is required/,
    );
    assert.equal(propagatedCase.terminal_receipt.artifact_ref, null);
    assert.doesNotThrow(() =>
      validateTerminalReceipt(structuredClone(propagatedCase.terminal_receipt)),
    );

    const missingParentKey = structuredClone(parentNoArtifactCase.parent_receipt);
    delete missingParentKey.artifact_ref;
    assert.throws(
      () => validateParentReceipt(missingParentKey, parentNoArtifactCase.terminal_receipt),
      /parent_receipt\.artifact_ref is required/,
    );
    assert.equal(parentNoArtifactCase.parent_receipt.artifact_ref, null);

    const missingDigest = structuredClone(parentNoArtifactCase.parent_receipt);
    delete missingDigest.child_payload_sha256;
    assert.throws(
      () => validateParentReceipt(missingDigest, parentNoArtifactCase.terminal_receipt),
      /parent_receipt\.child_payload_sha256 is required/,
    );
  });

  it("enforces classification and proposed-artifact consistency", () => {
    const wrongKind = structuredClone(propagatedCase.terminal_receipt);
    wrongKind.classification = "recovery";
    assert.throws(
      () => validateTerminalReceipt(wrongKind),
      /proposed_artifact\.kind must be recovery for recovery/,
    );

    const incidentNoArtifact = structuredClone(propagatedCase.terminal_receipt);
    incidentNoArtifact.terminal_outcome = "no_artifact";
    incidentNoArtifact.no_artifact_reason = "No durable artifact is justified.";
    incidentNoArtifact.proposed_artifact = null;
    incidentNoArtifact.escalation = null;
    assert.throws(
      () => validateTerminalReceipt(incidentNoArtifact),
      /terminal_outcome no_artifact requires classification none/,
    );

    const nonePersisted = structuredClone(persisted);
    nonePersisted.classification = "none";
    assert.throws(
      () => validateTerminalReceipt(nonePersisted),
      /classification none requires terminal_outcome no_artifact/,
    );
  });

  it("accepts a complete filled multiline incident artifact with a safe date", () => {
    const proposed = structuredClone(propagatedCase.terminal_receipt);
    assert.ok(incidentTemplate.includes("## Failure"));
    assert.ok(proposed.proposed_artifact.content.includes("opened: 2026-07-26"));
    assert.ok(proposed.proposed_artifact.content.includes("\n## Verification\n"));
    assert.doesNotThrow(() => validateTerminalReceipt(proposed));

    const summaryOnly = structuredClone(proposed);
    summaryOnly.proposed_artifact.content =
      "Open an incident for the launcher discovery failure.";
    assert.throws(
      () => validateTerminalReceipt(summaryOnly),
      /content must be a complete filled sanitized incident artifact/,
    );
  });

  it("accepts a complete filled multiline recovery artifact", () => {
    const proposed = structuredClone(propagatedCase.terminal_receipt);
    proposed.classification = "recovery";
    proposed.proposed_artifact = {
      kind: "recovery",
      content: `---
id: documented-validator-launcher-works-with-managed-runtime
schema: 1
signature: "Documented validator launcher works with managed runtime."
scope:
  os: any
  shell: any
  tool: validator
  versions: managed
status: candidate
first_seen: 2026-07-26
last_verified: null
expires_after_days: 30
supersedes: null
---
# Run the managed validator launcher

## Symptom

The default runtime lacks the declared validator dependency.

## Recovery

Use the documented managed launcher.

## Verification

Run from clean preconditions and observe successful validation.

## Limits

Applies only to the documented managed runtime.
`,
    };
    assert.ok(recoveryTemplate.includes("## Recovery"));
    assert.doesNotThrow(() => validateTerminalReceipt(proposed));
  });

  it("rejects high-confidence sensitive values without claiming comprehensive identity proof", () => {
    const unsafeSignature = structuredClone(persisted);
    unsafeSignature.signature =
      "Validator fails under /Users/PersonalName/private-project.";
    assert.throws(
      () => validateTerminalReceipt(unsafeSignature),
      /signature contains a high-confidence sensitive value/,
    );

    const unsafeEvidence = structuredClone(persisted);
    unsafeEvidence.evidence = ["Contact person@example.com for access."];
    assert.throws(
      () => validateTerminalReceipt(unsafeEvidence),
      /evidence contains a high-confidence sensitive value/,
    );

    const unsafeId = structuredClone(persisted);
    unsafeId.receipt_id = "Worker@PrivateOrg";
    assert.throws(
      () => validateTerminalReceipt(unsafeId),
      /receipt_id must be a lowercase host-neutral identifier/,
    );

    const unsafeProposed = structuredClone(propagatedCase.terminal_receipt);
    const unsafeBodies = [
      unsafeProposed.proposed_artifact.content.replace(
        "Make launcher discovery and authentication preflight host-aware.",
        "Contact person@example.com before repair.",
      ),
      unsafeProposed.proposed_artifact.content.replace(
        "Make launcher discovery and authentication preflight host-aware.",
        "Use ghp_abcdefghijklmnopqrstuvwxyz for the repair.",
      ),
      unsafeProposed.proposed_artifact.content.replace(
        "Make launcher discovery and authentication preflight host-aware.",
        "Inspect /Users/PrivateUser/private-project before repair.",
      ),
      unsafeProposed.proposed_artifact.content.replace(
        "Make launcher discovery and authentication preflight host-aware.",
        "Inspect C:\\Users\\PrivateUser\\private-project before repair.",
      ),
    ];
    for (const content of unsafeBodies) {
      const receipt = structuredClone(unsafeProposed);
      receipt.proposed_artifact.content = content;
      assert.throws(
        () => validateTerminalReceipt(receipt),
        /content contains a high-confidence sensitive value/,
      );
    }
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
