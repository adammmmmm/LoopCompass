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
import { parseFrontmatter } from "../scripts/lib/frontmatter.mjs";

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
const prohibitedLineSeparators = ["\r", "\n", "\u0085", "\u2028", "\u2029"];

function rawTemplateMarkers(template) {
  const prose = template.replace(/<!--[\s\S]*?-->/g, "");
  return [...prose.matchAll(/<([\s\S]*?)>/g)].map((match) => match[1]);
}

function templateMarkers(template) {
  return rawTemplateMarkers(template).map((marker) =>
    marker.replace(/\s+/gu, " ").trim(),
  );
}

const allShippedTemplateMarkers = [
  ...new Set([
    ...templateMarkers(incidentTemplate),
    ...templateMarkers(recoveryTemplate),
  ]),
];
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
const filledRecoveryArtifact = `---
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
<!-- candidate recovery: retain this harmless template guidance -->
# Run the managed validator launcher

## Symptom

The default runtime lacks the declared validator dependency.

## Recovery

Use the documented managed launcher.

## Verification

Run from clean preconditions and observe successful validation.

## Limits

Applies only to the documented managed runtime.
`;

function recoveryProposalReceipt() {
  const receipt = structuredClone(propagatedCase.terminal_receipt);
  receipt.classification = "recovery";
  receipt.containment = {
    used: false,
    summary: null,
    verification_gate: null,
  };
  receipt.proposed_artifact = {
    kind: "recovery",
    content: filledRecoveryArtifact,
  };
  return receipt;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected function to throw");
}

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

  it("bounds minimal evidence and rejects transcript-like multiline items", () => {
    const tooMany = structuredClone(persisted);
    tooMany.evidence = Array.from(
      { length: 9 },
      (_, index) => `Sanitized evidence item ${index + 1}.`,
    );
    assert.throws(
      () => validateTerminalReceipt(tooMany),
      /evidence must contain at most 8 one-line items/,
    );

    const tooLong = structuredClone(persisted);
    tooLong.evidence = ["x".repeat(513)];
    assert.throws(
      () => validateTerminalReceipt(tooLong),
      /evidence must contain at most 8 one-line items of at most 512 characters/,
    );

    for (const separator of prohibitedLineSeparators) {
      const multiline = structuredClone(persisted);
      multiline.evidence = [`First output line.${separator}PrivatePayload`];
      const error = captureError(() => validateTerminalReceipt(multiline));
      assert.match(error.message, /evidence must contain at most 8 one-line items/);
      assert.equal(error.message.includes("PrivatePayload"), false);
    }
  });

  it("requires bounded containment details and a verification gate", () => {
    const receipt = structuredClone(persisted);
    receipt.containment.verification_gate = null;
    assert.throws(
      () => validateTerminalReceipt(receipt),
      /requires summary and verification_gate when used is true/,
    );
  });

  it("allows containment only for incident and external classifications", () => {
    for (const classification of ["recovery", "none"]) {
      const receipt = structuredClone(persisted);
      receipt.classification = classification;
      if (classification === "recovery") {
        receipt.artifact_ref =
          "skill-validator-exits-before-validation-at-import-yaml-in-documented-python-runtimes";
      } else {
        receipt.terminal_outcome = "no_artifact";
        receipt.artifact_ref = null;
        receipt.no_artifact_reason = "The observation is expected test behavior.";
        receipt.escalation = null;
      }
      assert.throws(
        () => validateTerminalReceipt(receipt),
        /containment\.used may be true only for incident or external classification/,
      );
    }
  });

  it("bounds every compact prose field and rejects multiline smuggling", () => {
    const receiptMutations = [
      (receipt, value) => {
        receipt.containment.summary = value;
      },
      (receipt, value) => {
        receipt.containment.verification_gate = value;
      },
      (receipt, value) => {
        receipt.escalation.target = value;
      },
      (receipt, value) => {
        receipt.escalation.action = value;
      },
    ];
    for (const mutate of receiptMutations) {
      for (const value of [
        "x".repeat(513),
        ...prohibitedLineSeparators.map(
          (separator) => `First line.${separator}PrivatePayload`,
        ),
      ]) {
        const receipt = structuredClone(persisted);
        mutate(receipt, value);
        const error = captureError(() => validateTerminalReceipt(receipt));
        assert.match(error.message, /must be one line of at most 512 characters/);
        assert.equal(error.message.includes("PrivatePayload"), false);
      }
    }

    for (const value of [
      "x".repeat(513),
      ...prohibitedLineSeparators.map(
        (separator) => `First line.${separator}PrivatePayload`,
      ),
    ]) {
      const receipt = structuredClone(persisted);
      receipt.classification = "none";
      receipt.containment = {
        used: false,
        summary: null,
        verification_gate: null,
      };
      receipt.terminal_outcome = "no_artifact";
      receipt.artifact_ref = null;
      receipt.no_artifact_reason = value;
      receipt.escalation = null;
      const error = captureError(() => validateTerminalReceipt(receipt));
      assert.match(error.message, /must be one line of at most 512 characters/);
      assert.equal(error.message.includes("PrivatePayload"), false);
    }
  });

  it("bounds escalation capabilities on terminal and parent receipts", () => {
    const invalidRequires = [
      Array.from({ length: 9 }, (_, index) => `capability_${index + 1}`),
      ["x".repeat(129)],
      ...prohibitedLineSeparators.map((separator) => [
        `repository_write${separator}PrivatePayload`,
      ]),
    ];

    for (const requires of invalidRequires) {
      const terminal = structuredClone(persisted);
      terminal.escalation.requires = requires;
      let error = captureError(() => validateTerminalReceipt(terminal));
      assert.match(error.message, /requires must contain at most 8 one-line items/);
      assert.equal(error.message.includes("PrivatePayload"), false);

      const parent = structuredClone(propagatedCase.parent_receipt);
      parent.escalation.requires = requires;
      error = captureError(() =>
        validateParentReceipt(parent, propagatedCase.terminal_receipt),
      );
      assert.match(error.message, /requires must contain at most 8 one-line items/);
      assert.equal(error.message.includes("PrivatePayload"), false);
    }
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

  it("binds authoritative persistence to the proposed mechanical artifact id", () => {
    const authoritativeCase = fixture.cases.find(
      (c) => c.id === "lc-eval-008-subagent-readonly-handoff",
    ).receipt;
    const proposedId = parseFrontmatter(
      authoritativeCase.terminal_receipt.proposed_artifact.content,
    ).fields.id;
    assert.equal(authoritativeCase.parent_receipt.artifact_ref, proposedId);

    const wrong = structuredClone(authoritativeCase.parent_receipt);
    wrong.artifact_ref = "different-mechanical-id";
    assert.throws(
      () => validateParentReceipt(wrong, authoritativeCase.terminal_receipt),
      /artifact_ref must equal the proposed artifact id/,
    );

    const collision = structuredClone(authoritativeCase.parent_receipt);
    collision.artifact_ref = `${proposedId}-2`;
    assert.doesNotThrow(() =>
      validateParentReceipt(collision, authoritativeCase.terminal_receipt),
    );

    const paddedCollision = structuredClone(authoritativeCase.parent_receipt);
    paddedCollision.artifact_ref = `${proposedId}-02`;
    assert.throws(
      () => validateParentReceipt(paddedCollision, authoritativeCase.terminal_receipt),
      /artifact_ref must equal the proposed artifact id/,
    );
  });

  it("binds direct persistence to the mechanical signature slug", () => {
    assert.doesNotThrow(() => validateTerminalReceipt(structuredClone(persisted)));

    const wrong = structuredClone(persisted);
    wrong.artifact_ref = "skill-validator-default-runtime-missing-dependency";
    assert.throws(
      () => validateTerminalReceipt(wrong),
      /artifact_ref must equal the mechanical slug of signature/,
    );

    const collision = structuredClone(persisted);
    collision.artifact_ref = `${persisted.artifact_ref}-2`;
    assert.doesNotThrow(() => validateTerminalReceipt(collision));

    const paddedCollision = structuredClone(persisted);
    paddedCollision.artifact_ref = `${persisted.artifact_ref}-02`;
    assert.throws(
      () => validateTerminalReceipt(paddedCollision),
      /artifact_ref must equal the mechanical slug of signature/,
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
    wrongKind.containment = {
      used: false,
      summary: null,
      verification_gate: null,
    };
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

  it("allows normalized functional tokens but rejects template placeholders", () => {
    const proposed = structuredClone(propagatedCase.terminal_receipt);
    proposed.proposed_artifact.content = proposed.proposed_artifact.content
      .replace(
        "id: panel-launcher-discovery-differs-between-sandbox-and-host-contexts",
        "id: launcher-at-path-fails-at-ts",
      )
      .replace(
        'signature: "Panel launcher discovery differs between sandbox and host contexts."',
        'signature: "Launcher at <path> fails at <ts>."',
      )
      .replace(
        "Evidence: sandbox discovery omitted a verified launcher and could not observe host-backed authentication.",
        "Evidence: <https://example.test/docs>, HTML <code>status</code>, and type <T> are safe technical prose.",
      );
    assert.doesNotThrow(() => validateTerminalReceipt(proposed));

    proposed.proposed_artifact.content = proposed.proposed_artifact.content.replace(
      "owner: Incident Coordinator",
      "owner: <incident-coordinator>",
    );
    assert.throws(
      () => validateTerminalReceipt(proposed),
      /content must be a complete filled sanitized incident artifact/,
    );
  });

  it("rejects every exact shipped template marker, including multiline markers", () => {
    assert.ok(allShippedTemplateMarkers.length > 10);
    assert.ok(allShippedTemplateMarkers.some((marker) => marker.includes("frontmatter owner")));

    for (const marker of allShippedTemplateMarkers) {
      const proposed = structuredClone(propagatedCase.terminal_receipt);
      proposed.proposed_artifact.content =
        proposed.proposed_artifact.content.replace(
          "Normal path: resolve authenticated reviewer launchers from the host execution context.",
          `Normal path: <${marker}>`,
        );
      assert.throws(
        () => validateTerminalReceipt(proposed),
        /content must be a complete filled sanitized incident artifact/,
        marker,
      );
    }

    const multilineMarker = rawTemplateMarkers(incidentTemplate).find(
      (marker) => /[\r\n\u0085\u2028\u2029]/u.test(marker),
    );
    assert.ok(multilineMarker);
    const proposed = structuredClone(propagatedCase.terminal_receipt);
    proposed.proposed_artifact.content =
      proposed.proposed_artifact.content.replace(
        "Normal path: resolve authenticated reviewer launchers from the host execution context.",
        `Normal path: <${multilineMarker}>`,
      );
    assert.throws(
      () => validateTerminalReceipt(proposed),
      /content must be a complete filled sanitized incident artifact/,
    );
  });

  it("requires exact or unpadded -N proposed capsule identity", () => {
    const baseId =
      "panel-launcher-discovery-differs-between-sandbox-and-host-contexts";
    for (const suffix of ["-0", "-1", "-01", "-02"]) {
      const proposed = structuredClone(propagatedCase.terminal_receipt);
      proposed.proposed_artifact.content =
        proposed.proposed_artifact.content.replace(
          `id: ${baseId}`,
          `id: ${baseId}${suffix}`,
        );
      assert.throws(
        () => validateTerminalReceipt(proposed),
        /content must be a complete filled sanitized incident artifact/,
      );
    }

    const collision = structuredClone(propagatedCase.terminal_receipt);
    collision.proposed_artifact.content =
      collision.proposed_artifact.content.replace(
        `id: ${baseId}`,
        `id: ${baseId}-2`,
      );
    assert.doesNotThrow(() => validateTerminalReceipt(collision));

    const child = structuredClone(propagatedCase.terminal_receipt);
    child.proposed_artifact.content = child.proposed_artifact.content.replace(
      `id: ${baseId}`,
      `id: ${baseId}-01`,
    );
    const parent = structuredClone(propagatedCase.parent_receipt);
    parent.proposed_artifact = structuredClone(child.proposed_artifact);
    parent.forwarded_receipt = structuredClone(child);
    parent.child_payload_sha256 = receiptPayloadDigest(child);
    assert.throws(
      () => validateParentReceipt(parent, child),
      /content must be a complete filled sanitized incident artifact/,
    );
  });

  it("accepts a complete filled multiline recovery artifact", () => {
    const proposed = recoveryProposalReceipt();
    assert.ok(recoveryTemplate.includes("## Recovery"));
    assert.doesNotThrow(() => validateTerminalReceipt(proposed));
  });

  it("rejects schema-invalid incident artifacts despite present keys and headings", () => {
    const base = propagatedCase.terminal_receipt.proposed_artifact.content;
    const invalidBodies = [
      incidentTemplate,
      base.replace("schema: 1", "schema: 2"),
      base.replace("status: detected", "status: closed"),
      base.replace("requires: [repository_write]", "requires:"),
      base.replace("requires: [repository_write]", "requires: repository_write"),
      base.replace("consulted: []", "consulted:"),
      base.replace("owner: Incident Coordinator", "owner:"),
      base.replace("opened: 2026-07-26", "opened: 2026-02-30"),
      base.replace(
        "## Repair\n\nMake launcher discovery and authentication preflight host-aware.",
        "## Repair\n",
      ),
    ];

    for (const content of invalidBodies) {
      const receipt = structuredClone(propagatedCase.terminal_receipt);
      receipt.proposed_artifact.content = content;
      assert.throws(
        () => validateTerminalReceipt(receipt),
        /content must be a complete filled sanitized incident artifact/,
      );
    }
  });

  it("rejects invalid recovery lifecycle, nested scope, dates, and empty sections", () => {
    const invalidBodies = [
      recoveryTemplate,
      filledRecoveryArtifact.replace("status: candidate", "status: unknown"),
      filledRecoveryArtifact.replace("  tool: validator", "  tool:"),
      filledRecoveryArtifact.replace("  versions: managed\n", ""),
      filledRecoveryArtifact.replace(
        "  tool: validator",
        "  os: duplicate\n  tool: validator",
      ),
      filledRecoveryArtifact.replace("last_verified: null", "last_verified:"),
      filledRecoveryArtifact.replace("supersedes: null", "supersedes:"),
      filledRecoveryArtifact.replace("first_seen: 2026-07-26", "first_seen: 2026-02-30"),
      filledRecoveryArtifact.replace("last_verified: null", "last_verified: 2026-02-30"),
      filledRecoveryArtifact.replace("expires_after_days: 30", "expires_after_days: 0"),
      filledRecoveryArtifact.replace("expires_after_days: 30", "expires_after_days: 01"),
      filledRecoveryArtifact.replace("expires_after_days: 30", "expires_after_days: 1e2"),
      filledRecoveryArtifact.replace(
        "expires_after_days: 30",
        "expires_after_days: 9007199254740992",
      ),
      filledRecoveryArtifact.replace("expires_after_days: 30", "expires_after_days: 1.5"),
      filledRecoveryArtifact.replace(
        "## Verification\n\nRun from clean preconditions and observe successful validation.",
        "## Verification\n",
      ),
    ];

    for (const content of invalidBodies) {
      const receipt = recoveryProposalReceipt();
      receipt.proposed_artifact.content = content;
      assert.throws(
        () => validateTerminalReceipt(receipt),
        /content must be a complete filled sanitized recovery artifact/,
      );
    }
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

  it("catches home paths across every prose surface without echoing the value", () => {
    const privatePath = "file:///Users/PrivateUser/private-project";
    const terminalMutations = [
      (receipt) => {
        receipt.evidence = [`Observed (${privatePath}), then the command failed.`];
      },
      (receipt) => {
        receipt.containment.summary = `Temporarily read [${privatePath}].`;
      },
      (receipt) => {
        receipt.containment.verification_gate =
          "Retry after removing (/home/PrivateUser/private-project).";
      },
      (receipt) => {
        receipt.escalation.requires = [`read ${privatePath}`];
      },
      (receipt) => {
        receipt.escalation.target = `/Users/PrivateUser/private-project`;
      },
      (receipt) => {
        receipt.escalation.action =
          "Inspect C:\\Users\\PrivateUser\\private-project before repair.";
      },
    ];

    for (const mutate of terminalMutations) {
      const receipt = structuredClone(persisted);
      mutate(receipt);
      const error = captureError(() => validateTerminalReceipt(receipt));
      assert.match(error.message, /high-confidence sensitive value/);
      assert.equal(error.message.includes("PrivateUser"), false);
    }

    const proposed = structuredClone(propagatedCase.terminal_receipt);
    proposed.proposed_artifact.content =
      proposed.proposed_artifact.content.replace(
        "Make launcher discovery and authentication preflight host-aware.",
        `Inspect ${privatePath} before repair.`,
      );
    const proposedError = captureError(() => validateTerminalReceipt(proposed));
    assert.match(proposedError.message, /high-confidence sensitive value/);
    assert.equal(proposedError.message.includes("PrivateUser"), false);

    const parent = structuredClone(parentNoArtifactCase.parent_receipt);
    parent.no_artifact_reason =
      "The current edit directly references file:///home/PrivateUser/private-project.";
    const parentError = captureError(() =>
      validateParentReceipt(parent, parentNoArtifactCase.terminal_receipt),
    );
    assert.match(parentError.message, /high-confidence sensitive value/);
    assert.equal(parentError.message.includes("PrivateUser"), false);
  });

  it("allows functional roots and ordinary non-home paths as safe controls", () => {
    const terminal = structuredClone(persisted);
    terminal.evidence = [
      "The command fails under <user-home>/project.",
      "The same failure reproduces under /workspace/project and /opt/tool.",
    ];
    terminal.containment.summary =
      "Use <project-root>/managed-runtime for this task.";
    terminal.containment.verification_gate =
      "Retry from <user-home>/clean-project after repair.";
    terminal.escalation.target = "Incident Coordinator";
    assert.doesNotThrow(() => validateTerminalReceipt(terminal));

    const parent = structuredClone(parentNoArtifactCase.parent_receipt);
    parent.no_artifact_reason =
      "The mismatch exists only under <project-root>/current-edit.";
    assert.doesNotThrow(() =>
      validateParentReceipt(parent, parentNoArtifactCase.terminal_receipt),
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
