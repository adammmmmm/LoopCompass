import { isDeepStrictEqual } from "node:util";

const classifications = new Set(["recovery", "incident", "external", "none"]);
const terminalOutcomes = new Set([
  "persisted_artifact",
  "no_artifact",
  "proposed_artifact",
]);
const taskOutcomes = new Set(["completed", "incomplete", "blocked", "unknown"]);
const mechanismHealthStates = new Set(["healthy", "broken", "external", "unknown"]);

function hasField(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function fail(label, message) {
  throw new Error(`${label}${message}`);
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(label, " must be an object");
  }
  return value;
}

function requireField(value, field, label) {
  if (!hasField(value, field)) {
    fail(label, `.${field} is required`);
  }
  return value[field];
}

function requireString(value, field, label) {
  const result = requireField(value, field, label);
  if (typeof result !== "string" || result.trim().length === 0) {
    fail(label, `.${field} must be a non-empty string`);
  }
  return result;
}

function requireNullableString(value, field, label) {
  const result = requireField(value, field, label);
  if (result !== null && (typeof result !== "string" || result.trim().length === 0)) {
    fail(label, `.${field} must be null or a non-empty string`);
  }
  return result;
}

function requireBoolean(value, field, label) {
  const result = requireField(value, field, label);
  if (typeof result !== "boolean") {
    fail(label, `.${field} must be boolean`);
  }
  return result;
}

function requireEnum(value, field, label, allowed) {
  const result = requireField(value, field, label);
  if (!allowed.has(result)) {
    fail(label, `.${field} must be one of ${[...allowed].join(", ")}`);
  }
  return result;
}

function requireStringArray(value, field, label) {
  const result = requireField(value, field, label);
  if (
    !Array.isArray(result)
    || result.length === 0
    || result.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    fail(label, `.${field} must be a non-empty array of non-empty strings`);
  }
  return result;
}

function requireNullableObject(value, field, label) {
  const result = requireField(value, field, label);
  if (result === null) {
    return null;
  }
  return requireObject(result, `${label}.${field}`);
}

function validateEscalation(escalation, label) {
  if (escalation === null) {
    return;
  }
  requireStringArray(escalation, "requires", label);
  requireString(escalation, "target", label);
  requireString(escalation, "action", label);
}

function validateContainment(containment, label) {
  requireObject(containment, label);
  const used = requireBoolean(containment, "used", label);
  const summary = requireNullableString(containment, "summary", label);
  const verificationGate = requireNullableString(
    containment,
    "verification_gate",
    label,
  );
  if (used && (summary === null || verificationGate === null)) {
    fail(label, " requires summary and verification_gate when used is true");
  }
  if (!used && (summary !== null || verificationGate !== null)) {
    fail(label, " requires null summary and verification_gate when used is false");
  }
}

function validateProposedArtifact(artifact, label) {
  if (artifact === null) {
    return;
  }
  requireEnum(artifact, "kind", label, new Set(["recovery", "incident"]));
  requireString(artifact, "content", label);
}

function validateTerminalActionFields(receipt, label, outcome, childReceipt = null) {
  const artifactRef = requireNullableString(receipt, "artifact_ref", label);
  const noArtifactReason = requireNullableString(receipt, "no_artifact_reason", label);
  const proposedArtifact = requireNullableObject(receipt, "proposed_artifact", label);
  validateProposedArtifact(proposedArtifact, `${label}.proposed_artifact`);
  const escalation = requireNullableObject(receipt, "escalation", label);
  validateEscalation(escalation, `${label}.escalation`);

  if (outcome === "persisted_artifact") {
    if (artifactRef === null) {
      fail(label, ".artifact_ref is required for persisted_artifact");
    }
    if (noArtifactReason !== null || proposedArtifact !== null) {
      fail(label, " persisted_artifact cannot include no_artifact_reason or proposed_artifact");
    }
  } else if (outcome === "no_artifact") {
    if (noArtifactReason === null) {
      fail(label, ".no_artifact_reason is required for no_artifact");
    }
    if (artifactRef !== null || proposedArtifact !== null) {
      fail(label, " no_artifact cannot include artifact_ref or proposed_artifact");
    }
  } else {
    if (proposedArtifact === null || escalation === null) {
      fail(label, " proposed_artifact requires proposed_artifact and escalation");
    }
    if (artifactRef !== null || noArtifactReason !== null) {
      fail(label, " proposed_artifact cannot include artifact_ref or no_artifact_reason");
    }
  }

  if (childReceipt && outcome === "proposed_artifact") {
    const forwarded = requireNullableObject(receipt, "forwarded_receipt", label);
    if (forwarded === null) {
      fail(label, ".forwarded_receipt is required when a parent propagates proposed_artifact");
    }
    if (!isDeepStrictEqual(forwarded, childReceipt)) {
      fail(label, ".forwarded_receipt must preserve the complete child receipt unchanged");
    }
  }
}

export function validateTerminalReceipt(receipt, label = "terminal_receipt") {
  requireObject(receipt, label);
  if (requireField(receipt, "receipt_schema", label) !== 1) {
    fail(label, ".receipt_schema must be 1");
  }
  requireString(receipt, "receipt_id", label);
  requireString(receipt, "signature", label);
  requireString(receipt, "dedupe_key", label);
  const classification = requireEnum(receipt, "classification", label, classifications);
  requireStringArray(receipt, "evidence", label);
  requireEnum(receipt, "task_outcome", label, taskOutcomes);
  requireEnum(receipt, "mechanism_health", label, mechanismHealthStates);
  validateContainment(
    requireField(receipt, "containment", label),
    `${label}.containment`,
  );
  const outcome = requireEnum(receipt, "terminal_outcome", label, terminalOutcomes);
  validateTerminalActionFields(receipt, label, outcome);
  if (
    (classification === "incident" || classification === "external")
    && receipt.escalation === null
  ) {
    fail(label, `.escalation is required for ${classification} classification`);
  }
  return receipt;
}

export function validateParentReceipt(parent, childReceipt, label = "parent_receipt") {
  requireObject(parent, label);
  if (requireField(parent, "receipt_schema", label) !== 1) {
    fail(label, ".receipt_schema must be 1");
  }
  requireString(parent, "receipt_id", label);
  const childReceiptId = requireString(parent, "child_receipt_id", label);
  if (childReceiptId !== childReceipt.receipt_id) {
    fail(label, ".child_receipt_id must match terminal_receipt.receipt_id");
  }
  if (requireBoolean(parent, "ingested", label) !== true) {
    fail(label, ".ingested must be true");
  }
  const outcome = requireEnum(parent, "terminal_action", label, terminalOutcomes);
  if (outcome !== "proposed_artifact") {
    const forwarded = requireField(parent, "forwarded_receipt", label);
    if (forwarded !== null) {
      fail(label, ".forwarded_receipt must be null after an authoritative terminal action");
    }
  }
  validateTerminalActionFields(parent, label, outcome, childReceipt);
  return parent;
}

export const receiptEnums = Object.freeze({
  classifications,
  terminalOutcomes,
  taskOutcomes,
  mechanismHealthStates,
});
