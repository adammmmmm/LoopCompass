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
import {
  htmlNamedCharacterReferenceNames,
  legacyHtmlNoSemicolonNames,
} from "../scripts/lib/html-character-references.mjs";
import { slugFromSignature } from "../scripts/lib/signature.mjs";

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
const structuralTemplateMarkers = new Set([
  "slug-from-normalized-signature",
  "normalized symptom or error",
  "capability",
  "incident-coordinator",
  "YYYY-MM-DD",
  "any-or-specific",
  "tool-name",
  "version-range-or-unknown",
  "integer",
]);
const proseTemplateMarkers = allShippedTemplateMarkers.filter(
  (marker) => !structuralTemplateMarkers.has(marker),
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
  receipt.signature = "Documented validator launcher works with managed runtime.";
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

function padToUtf8Bytes(content, size, fill = "x") {
  const current = Buffer.byteLength(content, "utf8");
  assert.ok(current <= size);
  assert.equal(Buffer.byteLength(fill, "utf8"), 1);
  return `${content}${fill.repeat(size - current)}`;
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
      assert.match(
        error.message,
        /evidence must contain at most 8 one-line items|unsafe Unicode or control character/,
      );
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
        assert.match(
          error.message,
          /must be one line of at most 512 characters|unsafe Unicode or control character/,
        );
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
      assert.match(
        error.message,
        /must be one line of at most 512 characters|unsafe Unicode or control character/,
      );
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
      assert.match(
        error.message,
        /requires must contain at most 8 one-line items|unsafe Unicode or control character/,
      );
      assert.equal(error.message.includes("PrivatePayload"), false);

      const parent = structuredClone(propagatedCase.parent_receipt);
      parent.escalation.requires = requires;
      error = captureError(() =>
        validateParentReceipt(parent, propagatedCase.terminal_receipt),
      );
      assert.match(
        error.message,
        /requires must contain at most 8 one-line items|unsafe Unicode or control character/,
      );
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

  it("accepts parent closure only for a proposed-artifact child", () => {
    const parent = structuredClone(parentNoArtifactCase.parent_receipt);
    assert.throws(
      () => validateParentReceipt(parent, structuredClone(persisted)),
      /child_receipt must have terminal_outcome proposed_artifact/,
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

  it("binds authoritative persistence directly to the child signature slug", () => {
    const authoritativeCase = fixture.cases.find(
      (c) => c.id === "lc-eval-008-subagent-readonly-handoff",
    ).receipt;
    const baseId =
      "windows-path-normalization-fails-deterministically";
    assert.equal(authoritativeCase.parent_receipt.artifact_ref, baseId);

    const wrong = structuredClone(authoritativeCase.parent_receipt);
    wrong.artifact_ref = "different-mechanical-id";
    assert.throws(
      () => validateParentReceipt(wrong, authoritativeCase.terminal_receipt),
      /artifact_ref must equal the mechanical child signature slug/,
    );

    for (const artifactRef of [baseId, `${baseId}-2`, `${baseId}-10`]) {
      const accepted = structuredClone(authoritativeCase.parent_receipt);
      accepted.artifact_ref = artifactRef;
      assert.doesNotThrow(() =>
        validateParentReceipt(accepted, authoritativeCase.terminal_receipt),
      );
    }

    for (const artifactRef of [`${baseId}-02`, `${baseId}-2-2`]) {
      const rejected = structuredClone(authoritativeCase.parent_receipt);
      rejected.artifact_ref = artifactRef;
      assert.throws(
        () => validateParentReceipt(rejected, authoritativeCase.terminal_receipt),
        /artifact_ref must equal the mechanical child signature slug/,
      );
    }

    const collisionProposal = structuredClone(authoritativeCase.terminal_receipt);
    collisionProposal.proposed_artifact.content =
      collisionProposal.proposed_artifact.content.replace(
        `id: ${baseId}`,
        `id: ${baseId}-2`,
      );
    const directParent = structuredClone(authoritativeCase.parent_receipt);
    directParent.child_payload_sha256 = receiptPayloadDigest(collisionProposal);
    directParent.artifact_ref = `${baseId}-10`;
    assert.doesNotThrow(() =>
      validateParentReceipt(directParent, collisionProposal),
    );
    directParent.artifact_ref = `${baseId}-2-2`;
    assert.throws(
      () => validateParentReceipt(directParent, collisionProposal),
      /artifact_ref must equal the mechanical child signature slug/,
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
    proposed.signature = "Launcher at <path> fails at <ts>.";
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
        "Evidence: <https://example.test/docs>, HTML <code>status</code>, type <T>, <integer>, and <capability> are safe technical prose.",
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
      proposed.proposed_artifact.content = structuralTemplateMarkers.has(marker)
        ? proposed.proposed_artifact.content.replace(
          "owner: Incident Coordinator",
          `owner: <<${marker}>>`,
        )
        : proposed.proposed_artifact.content.replace(
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

  it("rejects every long shipped prose marker bare or split across whitespace", () => {
    assert.ok(proseTemplateMarkers.length > 5);
    for (const marker of proseTemplateMarkers) {
      for (const injected of [
        marker,
        marker.replace(/\s+/gu, "\n  "),
      ]) {
        const proposed = structuredClone(propagatedCase.terminal_receipt);
        proposed.proposed_artifact.content =
          proposed.proposed_artifact.content.replace(
            "Normal path: resolve authenticated reviewer launchers from the host execution context.",
            `Normal path: ${injected}`,
          );
        assert.throws(
          () => validateTerminalReceipt(proposed),
          /content must be a complete filled sanitized incident artifact/,
          marker,
        );
      }
    }

    const safe = structuredClone(propagatedCase.terminal_receipt);
    safe.proposed_artifact.content = safe.proposed_artifact.content.replace(
      "Normal path: resolve authenticated reviewer launchers from the host execution context.",
      "Normal path: use <code>status</code>, <https://example.test/docs>, type <T>, and the ordinary words repair and verification.",
    );
    assert.doesNotThrow(() => validateTerminalReceipt(safe));
  });

  it("rejects every long shipped prose marker inside comments", () => {
    for (const marker of proseTemplateMarkers) {
      const proposed = structuredClone(propagatedCase.terminal_receipt);
      proposed.proposed_artifact.content =
        proposed.proposed_artifact.content.replace(
          "# Repair panel launcher discovery",
          `<!-- ${marker} -->\n# Repair panel launcher discovery`,
        );
      assert.throws(
        () => validateTerminalReceipt(proposed),
        /content must be a complete filled sanitized incident artifact/,
        marker,
      );
    }

    const safe = structuredClone(propagatedCase.terminal_receipt);
    safe.proposed_artifact.content = safe.proposed_artifact.content.replace(
      "# Repair panel launcher discovery",
      "<!-- Candidate remains subject to normal verification. -->\n# Repair panel launcher discovery",
    );
    assert.doesNotThrow(() => validateTerminalReceipt(safe));
  });

  it("rejects render-equivalent markers split by comments or paired tags", () => {
    for (const marker of proseTemplateMarkers) {
      const boundary = marker.indexOf(" ");
      assert.ok(boundary > 0, marker);
      const before = marker.slice(0, boundary);
      const after = marker.slice(boundary);
      for (const injected of [
        `${before}<!-- harmless boundary -->${after}`,
        `${before}<em>${after}</em>`,
      ]) {
        const proposed = structuredClone(propagatedCase.terminal_receipt);
        proposed.proposed_artifact.content =
          proposed.proposed_artifact.content.replace(
            "Normal path: resolve authenticated reviewer launchers from the host execution context.",
            `Normal path: ${injected}`,
          );
        assert.throws(
          () => validateTerminalReceipt(proposed),
          /content must be a complete filled sanitized incident artifact/,
          marker,
        );
      }
    }

    const safe = structuredClone(propagatedCase.terminal_receipt);
    safe.proposed_artifact.content = safe.proposed_artifact.content.replace(
      "Normal path: resolve authenticated reviewer launchers from the host execution context.",
      "Normal path: use <code>status</code> with <!-- harmless detail --> ordinary verification prose.",
    );
    assert.doesNotThrow(() => validateTerminalReceipt(safe));
  });

  it("rejects nested, default-ignorable, and whitespace-obscured template markers", () => {
    const mutations = [
      (content) => content.replace(
        "owner: Incident Coordinator",
        "owner: <<incident-coordinator>>",
      ),
      (content) => content.replace(
        "owner: Incident Coordinator",
        "owner: <incident\u200B-coordinator>",
      ),
      (content) => content.replace(
        "owner: Incident Coordinator",
        "owner: <incident\u034F-coordinator>",
      ),
      (content) => content.replace(
        "Normal path: resolve authenticated reviewer launchers from the host execution context.",
        "Normal path: <Repair\u2060 the broken mechanism>",
      ),
      (content) => content.replace(
        "Normal path: resolve authenticated reviewer launchers from the host execution context.",
        "Normal path: <Repair\uFE0F the broken mechanism>",
      ),
      (content) => content.replace(
        "Normal path: resolve authenticated reviewer launchers from the host execution context.",
        "Normal path: <Repair\n  the broken mechanism>",
      ),
    ];
    for (const mutate of mutations) {
      const proposed = structuredClone(propagatedCase.terminal_receipt);
      proposed.proposed_artifact.content = mutate(proposed.proposed_artifact.content);
      assert.throws(
        () => validateTerminalReceipt(proposed),
        /unsafe Unicode or control character|complete filled sanitized incident artifact/,
      );
    }
  });

  it("normalizes CRLF proposed artifacts before structural validation", () => {
    const proposed = structuredClone(propagatedCase.terminal_receipt);
    proposed.proposed_artifact.content =
      proposed.proposed_artifact.content.replace(/\n/g, "\r\n");
    assert.doesNotThrow(() => validateTerminalReceipt(proposed));
  });

  it("requires a normalized proposed signature bound to the terminal signature", () => {
    for (const rawSignature of [
      "Panel launcher failed on 2026-07-26.",
      "Panel launcher failed under /tmp/build.",
      "Panel launcher failed\u2028in the host context.",
    ]) {
      const proposed = structuredClone(propagatedCase.terminal_receipt);
      proposed.proposed_artifact.content =
        proposed.proposed_artifact.content.replace(
          'signature: "Panel launcher discovery differs between sandbox and host contexts."',
          `signature: "${rawSignature}"`,
        );
      assert.throws(
        () => validateTerminalReceipt(proposed),
        /signature (?:is required|must be a normalized one-line signature)|unsafe Unicode or control character/,
      );
    }

    const mismatch = structuredClone(propagatedCase.terminal_receipt);
    mismatch.proposed_artifact.content = mismatch.proposed_artifact.content
      .replace(
        "id: panel-launcher-discovery-differs-between-sandbox-and-host-contexts",
        "id: panel-launcher-is-missing-from-the-host-context",
      )
      .replace(
        'signature: "Panel launcher discovery differs between sandbox and host contexts."',
        'signature: "Panel launcher is missing from the host context."',
      );
    assert.throws(
      () => validateTerminalReceipt(mismatch),
      /proposed_artifact signature must match terminal receipt signature/,
    );
  });

  it("bounds proposed artifact content by UTF-8 bytes", () => {
    const exact = structuredClone(propagatedCase.terminal_receipt);
    exact.proposed_artifact.content =
      padToUtf8Bytes(exact.proposed_artifact.content, 32768);
    assert.doesNotThrow(() => validateTerminalReceipt(exact));

    const oversized = structuredClone(exact);
    oversized.proposed_artifact.content += "x";
    assert.throws(
      () => validateTerminalReceipt(oversized),
      /content must be at most 32768 UTF-8 bytes/,
    );
  });

  it("handles a near-limit proposal with adversarial many-angle input", () => {
    const proposed = structuredClone(propagatedCase.terminal_receipt);
    proposed.proposed_artifact.content =
      padToUtf8Bytes(proposed.proposed_artifact.content, 32000, "<");
    assert.doesNotThrow(() => validateTerminalReceipt(proposed));
  });

  it("bounds receipt identifiers, dedupe keys, and normalized signatures", () => {
    const exactId = structuredClone(persisted);
    exactId.receipt_id = "x".repeat(128);
    assert.doesNotThrow(() => validateTerminalReceipt(exactId));
    exactId.receipt_id += "x";
    assert.throws(
      () => validateTerminalReceipt(exactId),
      /receipt_id must be a lowercase host-neutral identifier of at most 128 characters/,
    );

    const exactDedupe = structuredClone(persisted);
    exactDedupe.dedupe_key = "x".repeat(256);
    assert.doesNotThrow(() => validateTerminalReceipt(exactDedupe));
    exactDedupe.dedupe_key += "x";
    assert.throws(
      () => validateTerminalReceipt(exactDedupe),
      /dedupe_key must be a lowercase host-neutral dedupe key of at most 256 characters/,
    );

    const tableCellId = structuredClone(persisted);
    tableCellId.receipt_id = "worker|injected";
    assert.throws(
      () => validateTerminalReceipt(tableCellId),
      /receipt_id must be a lowercase host-neutral identifier/,
    );

    const exactSignature = structuredClone(persisted);
    exactSignature.signature = "x".repeat(512);
    exactSignature.artifact_ref = "x".repeat(96);
    assert.doesNotThrow(() => validateTerminalReceipt(exactSignature));
    exactSignature.signature += "x";
    assert.throws(
      () => validateTerminalReceipt(exactSignature),
      /signature must be a normalized one-line signature of at most 512 characters/,
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

  it("accepts JSON-compatible quoted scalar fields after decoding", () => {
    const receipt = recoveryProposalReceipt();
    receipt.proposed_artifact.content = receipt.proposed_artifact.content
      .replace(
        "  versions: managed",
        '  versions: "22.15.0; Codex managed sandbox"',
      )
      .replace("status: candidate", 'status: "candidate"')
      .replace("expires_after_days: 30", 'expires_after_days: "30"');
    assert.doesNotThrow(() => validateTerminalReceipt(receipt));

    for (const malformed of [
      '  versions: "22.15.0; Codex managed sandbox',
      '  versions: "22.15.0; \\q"',
    ]) {
      const invalid = recoveryProposalReceipt();
      invalid.proposed_artifact.content =
        invalid.proposed_artifact.content.replace(
          "  versions: managed",
          malformed,
        );
      assert.throws(
        () => validateTerminalReceipt(invalid),
        /content must be a complete filled sanitized recovery artifact/,
      );
    }
  });

  it("rejects Unicode-escaped placeholders in every decoded scalar surface", () => {
    const incidentMutations = [
      (content) => content.replace(
        "owner: Incident Coordinator",
        'owner: "\\u003cincident-coordinator\\u003e"',
      ),
      (content) => content.replace(
        'signature: "Panel launcher discovery differs between sandbox and host contexts."',
        'signature: "\\u0052epair the broken mechanism"',
      ),
      (content) => content.replace(
        "status: detected",
        'status: "\\u003ccapability\\u003e"',
      ),
      (content) => content.replace(
        "owner: Incident Coordinator",
        'owner: "Alice \\u003cincident-coordinator\\u003e"',
      ),
      (content) => content.replace(
        "owner: Incident Coordinator",
        'owner: "Incident\\u0000Coordinator"',
      ),
      (content) => content.replace(
        "owner: Incident Coordinator",
        'owner: "\\tIncident Coordinator"',
      ),
      (content) => content.replace(
        "owner: Incident Coordinator",
        'owner: "Incident Coordinator\\n"',
      ),
    ];
    for (const mutate of incidentMutations) {
      const invalid = structuredClone(propagatedCase.terminal_receipt);
      invalid.proposed_artifact.content = mutate(invalid.proposed_artifact.content);
      assert.throws(
        () => validateTerminalReceipt(invalid),
        /content must be a complete filled sanitized incident artifact|unsafe Unicode or control character/,
      );
    }

    const nested = recoveryProposalReceipt();
    nested.proposed_artifact.content = nested.proposed_artifact.content.replace(
      "  versions: managed",
      '  versions: "managed \\u003cversion-range-or-unknown\\u003e"',
    );
    assert.throws(
      () => validateTerminalReceipt(nested),
      /content must be a complete filled sanitized recovery artifact/,
    );

    const nestedControl = recoveryProposalReceipt();
    nestedControl.proposed_artifact.content =
      nestedControl.proposed_artifact.content.replace(
        "  versions: managed",
        '  versions: "managed\\u0000runtime"',
      );
    assert.throws(
      () => validateTerminalReceipt(nestedControl),
      /unsafe Unicode or control character/,
    );

    const signatureControl = structuredClone(propagatedCase.terminal_receipt);
    signatureControl.proposed_artifact.content =
      signatureControl.proposed_artifact.content.replace(
        'signature: "Panel launcher discovery differs between sandbox and host contexts."',
        'signature: "Panel launcher\\u0000 discovery differs between contexts."',
      );
    assert.throws(
      () => validateTerminalReceipt(signatureControl),
      /unsafe Unicode or control character/,
    );

    for (const [field, replacement] of [
      ["  os: any", '  os: "\\tany"'],
      ["first_seen: 2026-07-26", 'first_seen: "2026-07-26\\n"'],
      ["expires_after_days: 30", 'expires_after_days: "\\t30"'],
    ]) {
      const boundaryControl = recoveryProposalReceipt();
      boundaryControl.proposed_artifact.content =
        boundaryControl.proposed_artifact.content.replace(field, replacement);
      assert.throws(
        () => validateTerminalReceipt(boundaryControl),
        /unsafe Unicode or control character/,
      );
    }

    for (const mutate of [
      (content) => content.replace(
        "owner: Incident Coordinator",
        'owner: "Incident \\ud800 Coordinator"',
      ),
      (content) => content.replace(
        'signature: "Panel launcher discovery differs between sandbox and host contexts."',
        'signature: "Panel launcher \\udc00 discovery differs between contexts."',
      ),
    ]) {
      const surrogate = structuredClone(propagatedCase.terminal_receipt);
      surrogate.proposed_artifact.content = mutate(
        surrogate.proposed_artifact.content,
      );
      assert.throws(
        () => validateTerminalReceipt(surrogate),
        /unpaired Unicode surrogate/,
      );
    }

    for (const [field, replacement] of [
      ["  versions: managed", '  versions: "managed \\ud800"'],
      ["first_seen: 2026-07-26", 'first_seen: "2026-07-26\\udc00"'],
    ]) {
      const surrogate = recoveryProposalReceipt();
      surrogate.proposed_artifact.content =
        surrogate.proposed_artifact.content.replace(field, replacement);
      assert.throws(
        () => validateTerminalReceipt(surrogate),
        /unpaired Unicode surrogate/,
      );
    }

    const benign = recoveryProposalReceipt();
    benign.proposed_artifact.content = benign.proposed_artifact.content.replace(
      "  versions: managed",
      '  versions: "22.15.0; Codex\\u0020managed sandbox \\ud83d\\ude80"',
    );
    assert.doesNotThrow(() => validateTerminalReceipt(benign));
  });

  it("requires bounded proposed containment and rejects expired persistence", () => {
    const proposed = structuredClone(propagatedCase.terminal_receipt);
    assert.equal(proposed.containment.used, true);
    assert.doesNotThrow(() => validateTerminalReceipt(proposed));

    for (const expiry of ["null", "2026-07-26"]) {
      const invalid = structuredClone(proposed);
      invalid.proposed_artifact.content =
        invalid.proposed_artifact.content.replace(
          "containment_expires: 2026-08-02",
          `containment_expires: ${expiry}`,
        );
      assert.throws(
        () => validateTerminalReceipt(invalid),
        /containment\.used with a proposed incident requires containment_expires after opened/,
      );
    }

    const parent = structuredClone(parentNoArtifactCase.parent_receipt);
    parent.receipt_id = "authoritative-containment-parent";
    parent.child_receipt_id = proposed.receipt_id;
    parent.child_payload_sha256 = receiptPayloadDigest(proposed);
    parent.terminal_action = "persisted_artifact";
    parent.artifact_ref =
      "panel-launcher-discovery-differs-between-sandbox-and-host-contexts";
    parent.no_artifact_reason = null;
    parent.proposed_artifact = null;
    parent.escalation = structuredClone(proposed.escalation);
    parent.forwarded_receipt = null;
    assert.doesNotThrow(() =>
      validateParentReceipt(parent, proposed, "parent_receipt", {
        today: new Date("2026-08-02T00:00:00.000Z"),
      }),
    );
    assert.throws(
      () =>
        validateParentReceipt(parent, proposed, "parent_receipt", {
          today: new Date("2026-08-03T00:00:00.000Z"),
        }),
      /persisted_artifact requires unexpired containment/,
    );

    const unused = structuredClone(proposed);
    unused.containment = {
      used: false,
      summary: null,
      verification_gate: null,
    };
    unused.proposed_artifact.content =
      unused.proposed_artifact.content.replace(
        "containment_expires: 2026-08-02",
        "containment_expires: null",
      );
    assert.doesNotThrow(() => validateTerminalReceipt(unused));
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

  it("requires exact, closed, fully parsed proposal frontmatter", () => {
    const base = propagatedCase.terminal_receipt.proposed_artifact.content;
    const canonicalQuoted = structuredClone(propagatedCase.terminal_receipt);
    canonicalQuoted.signature =
      'Panel launcher "discovery" differs between sandbox and host contexts.';
    canonicalQuoted.proposed_artifact.content = base
      .replace(
        'signature: "Panel launcher discovery differs between sandbox and host contexts."',
        'signature: "Panel launcher \\"discovery\\" differs between sandbox and host contexts."',
      )
      .replace(
        "requires: [repository_write]",
        'requires: ["repository_write"]',
      );
    assert.doesNotThrow(() => validateTerminalReceipt(canonicalQuoted));

    const invalidBodies = [
      base.replace(/^---\n/, "----\n"),
      base.replace("\n---\n# Repair panel launcher discovery", "\n--- \n# Repair panel launcher discovery"),
      base.replace("schema: 1", "schema: 1\nthis is not frontmatter"),
      base.replace("status: detected", "status: detected\nstatus: repairing"),
      base.replace("status: detected", "status: detected\nunexpected: value"),
      base.replace("owner: Incident Coordinator", 'owner: "Incident Coordinator'),
      base.replace(
        "requires: [repository_write]",
        'requires: ["repository_write]',
      ),
      base.replace(
        'signature: "Panel launcher discovery differs between sandbox and host contexts."',
        'signature: "Panel launcher "discovery" differs between sandbox and host contexts."',
      ),
      base.replace("owner: Incident Coordinator", "owner: &owner Incident Coordinator"),
      base.replace("owner: Incident Coordinator", "owner: *owner"),
      base.replace("owner: Incident Coordinator", "owner: !!str Incident Coordinator"),
      base.replace("owner: Incident Coordinator", "owner: !role Incident Coordinator"),
      base.replace("owner: Incident Coordinator", "owner: <unresolved-owner>"),
      base.replace(
        "requires: [repository_write]",
        "requires: [repository_write, <capability>]",
      ),
      base.replace(
        "Make launcher discovery and authentication preflight host-aware.",
        "<unresolved-repair>",
      ),
    ];

    for (const content of invalidBodies) {
      const proposed = structuredClone(propagatedCase.terminal_receipt);
      proposed.proposed_artifact.content = content;
      assert.throws(
        () => validateTerminalReceipt(proposed),
        /content must be a complete filled sanitized incident artifact/,
      );
    }
  });

  it("uses one decoded inline-list representation for schema validation", () => {
    const quotedComma = structuredClone(propagatedCase.terminal_receipt);
    quotedComma.proposed_artifact.content =
      quotedComma.proposed_artifact.content.replace(
        "requires: [repository_write]",
        'requires: ["repository_write,review"]',
      );
    const parsed = parseFrontmatter(quotedComma.proposed_artifact.content);
    assert.deepEqual(parsed.fields.requires, ["repository_write,review"]);
    assert.doesNotThrow(() => validateTerminalReceipt(quotedComma));

    for (const encoded of [
      'requires: ["repository_write\\u0000"]',
      'requires: ["\\u003ccapability\\u003e"]',
    ]) {
      const invalid = structuredClone(propagatedCase.terminal_receipt);
      invalid.proposed_artifact.content =
        invalid.proposed_artifact.content.replace(
          "requires: [repository_write]",
          encoded,
        );
      assert.throws(
        () => validateTerminalReceipt(invalid),
        /content must be a complete filled sanitized incident artifact/,
      );
    }
  });

  it("shares one decoded representation for valid quoted signature escapes", () => {
    const signatures = [
      [
        '"Panel launcher \\"discovery\\" differs between sandbox and host contexts."',
        'Panel launcher "discovery" differs between sandbox and host contexts.',
      ],
      [
        '"Panel launcher \\\\ discovery differs between sandbox and host contexts."',
        "Panel launcher \\ discovery differs between sandbox and host contexts.",
      ],
      [
        '"Panel launcher \\/ discovery differs between sandbox and host contexts."',
        "Panel launcher / discovery differs between sandbox and host contexts.",
      ],
      [
        '"Panel launcher \\u0041 discovery differs between sandbox and host contexts."',
        "Panel launcher A discovery differs between sandbox and host contexts.",
      ],
    ];
    for (const [encoded, signature] of signatures) {
      const shared = parseFrontmatter(`---\nsignature: ${encoded}\n---\n`);
      assert.equal(shared.fields.signature, signature);
      assert.equal(
        slugFromSignature(shared.fields.signature),
        slugFromSignature(signature),
      );
      const proposed = structuredClone(propagatedCase.terminal_receipt);
      proposed.signature = signature;
      proposed.proposed_artifact.content = proposed.proposed_artifact.content
        .replace(
          "id: panel-launcher-discovery-differs-between-sandbox-and-host-contexts",
          `id: ${slugFromSignature(signature)}`,
        )
        .replace(
          'signature: "Panel launcher discovery differs between sandbox and host contexts."',
          `signature: ${encoded}`,
        );
      assert.doesNotThrow(() => validateTerminalReceipt(proposed), signature);
    }

    const decodedControl = structuredClone(propagatedCase.terminal_receipt);
    decodedControl.proposed_artifact.content =
      decodedControl.proposed_artifact.content.replace(
        'signature: "Panel launcher discovery differs between sandbox and host contexts."',
        'signature: "Panel launcher \\u0000 discovery differs between sandbox and host contexts."',
      );
    assert.throws(
      () => validateTerminalReceipt(decodedControl),
      /unsafe Unicode or control character/,
    );
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

  it("rejects unsafe Unicode and controls without echoing them", () => {
    for (const character of ["\u202E", "\0", "\v", "\f"]) {
      const signature = structuredClone(persisted);
      signature.signature = `Validator ${character} fails deterministically.`;
      let error = captureError(() => validateTerminalReceipt(signature));
      assert.match(error.message, /unsafe Unicode or control character/);
      assert.equal(error.message.includes(character), false);

      const compact = structuredClone(persisted);
      compact.containment.summary =
        `Use bounded containment ${character} for this task.`;
      error = captureError(() => validateTerminalReceipt(compact));
      assert.match(error.message, /unsafe Unicode or control character/);
      assert.equal(error.message.includes(character), false);

      const proposed = structuredClone(propagatedCase.terminal_receipt);
      proposed.proposed_artifact.content =
        proposed.proposed_artifact.content.replace(
          "Make launcher discovery and authentication preflight host-aware.",
          `Make launcher discovery ${character} host-aware.`,
        );
      error = captureError(() => validateTerminalReceipt(proposed));
      assert.match(error.message, /unsafe Unicode or control character/);
      assert.equal(error.message.includes(character), false);
    }
  });

  it("rejects encoded character references before receipt persistence", () => {
    const mutations = [
      (receipt) => {
        receipt.evidence = ["Contact private&#64;example.com for access."];
      },
      (receipt) => {
        receipt.containment.summary = "Use bounded &colon; containment.";
      },
      (receipt) => {
        receipt.proposed_artifact.content =
          receipt.proposed_artifact.content.replace(
            "Make launcher discovery and authentication preflight host-aware.",
            "&#x54;he intended repair remains pending.",
          );
      },
      (receipt) => {
        receipt.evidence = ["Contact private&#64example.com for access."];
      },
      (receipt) => {
        receipt.containment.summary = "Use bounded &lt containment.";
      },
      (receipt) => {
        receipt.proposed_artifact.content =
          receipt.proposed_artifact.content.replace(
            "Make launcher discovery and authentication preflight host-aware.",
            "&#x40g encoded proposal content.",
          );
      },
      (receipt) => {
        receipt.evidence = ["Copyright marker &copy"];
      },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const receipt = index === 2 || index === 5
        ? structuredClone(propagatedCase.terminal_receipt)
        : structuredClone(persisted);
      mutate(receipt);
      const before = JSON.stringify(receipt);
      assert.throws(
        () => validateTerminalReceipt(receipt),
        /contains character-reference syntax/,
      );
      assert.equal(JSON.stringify(receipt), before);
    }

    const literalAmpersand = structuredClone(persisted);
    literalAmpersand.evidence = ["AT&T-compatible launcher behavior verified."];
    assert.doesNotThrow(() => validateTerminalReceipt(literalAmpersand));
  });

  it("rejects the complete legacy HTML no-semicolon name set", () => {
    assert.equal(legacyHtmlNoSemicolonNames.size, 106);
    for (const name of legacyHtmlNoSemicolonNames) {
      const receipt = structuredClone(persisted);
      receipt.evidence = [`Encoded marker &${name} remains unsafe.`];
      assert.throws(
        () => validateTerminalReceipt(receipt),
        /contains character-reference syntax/,
        name,
      );
    }

    for (const literal of ["AT&T behavior verified.", "R&D validation passed."]) {
      const receipt = structuredClone(persisted);
      receipt.evidence = [literal];
      assert.doesNotThrow(() => validateTerminalReceipt(receipt), literal);
    }
  });

  it("rejects only actual case-sensitive terminated HTML names", () => {
    assert.equal(htmlNamedCharacterReferenceNames.size, 2125);
    for (const name of [
      "CounterClockwiseContourIntegral",
      "NotEqualTilde",
      "colon",
      "AElig",
    ]) {
      assert.equal(htmlNamedCharacterReferenceNames.has(name), true, name);
      const receipt = structuredClone(persisted);
      receipt.evidence = [`Known reference &${name}; is unsafe.`];
      assert.throws(
        () => validateTerminalReceipt(receipt),
        /contains character-reference syntax/,
      );
    }

    for (const literal of ["R&D2;", "A&Bogus;"]) {
      const receipt = structuredClone(persisted);
      receipt.evidence = [`Literal ${literal} remains unchanged.`];
      assert.doesNotThrow(() => validateTerminalReceipt(receipt), literal);

      const proposed = structuredClone(propagatedCase.terminal_receipt);
      proposed.proposed_artifact.content =
        proposed.proposed_artifact.content.replace(
          "Make launcher discovery and authentication preflight host-aware.",
          `Keep literal ${literal} in the repair explanation.`,
        );
      assert.doesNotThrow(() => validateTerminalReceipt(proposed), literal);
    }
  });

  it("requires NFC-normalized receipt signatures", () => {
    const composed = structuredClone(persisted);
    composed.signature = "Caf\u00e9 validator fails.";
    composed.artifact_ref = "caf-validator-fails";
    assert.doesNotThrow(() => validateTerminalReceipt(composed));

    const decomposed = structuredClone(composed);
    decomposed.signature = "Cafe\u0301 validator fails.";
    assert.throws(
      () => validateTerminalReceipt(decomposed),
      /signature must be a normalized one-line signature/,
    );
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
