import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseIsoDate, validateCapsuleText } from "./capsule.mjs";
import { parseFrontmatter } from "./frontmatter.mjs";
import { normalizeSignature, slugFromSignature } from "./signature.mjs";

const classifications = new Set(["recovery", "incident", "external", "none"]);
const terminalOutcomes = new Set([
  "persisted_artifact",
  "no_artifact",
  "proposed_artifact",
]);
const taskOutcomes = new Set(["completed", "incomplete", "blocked", "unknown"]);
const mechanismHealthStates = new Set(["healthy", "broken", "external", "unknown"]);
const terminalReceiptFields = new Set([
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
]);
const parentReceiptFields = new Set([
  "receipt_schema",
  "receipt_id",
  "child_receipt_id",
  "child_payload_sha256",
  "ingested",
  "terminal_action",
  "artifact_ref",
  "no_artifact_reason",
  "proposed_artifact",
  "escalation",
  "forwarded_receipt",
]);
const containmentFields = new Set(["used", "summary", "verification_gate"]);
const proposedArtifactFields = new Set(["kind", "content"]);
const escalationFields = new Set(["requires", "target", "action"]);
const safeIdentifier = /^[a-z0-9][a-z0-9._:|-]*$/;
const highConfidenceSensitivePatterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:file:\/\/)?\/(?:Users|home)\/[^/\s"'`<>()\[\]{},;]+(?:\/[^\s"'`<>()\[\]{},;]*)?/i,
  /file:\/\/\/[A-Za-z]:\/Users\/[^/\s"'`<>()\[\]{},;]+(?:\/[^\s"'`<>()\[\]{},;]*)?/i,
  /\b[A-Za-z]:\\Users\\[^\\\s"'`]+(?:\\[^\s"'`]*)?/,
  /\b(?:sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{10,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/i,
];
const requiredArtifactFields = Object.freeze({
  incident: [
    "id",
    "schema",
    "signature",
    "status",
    "requires",
    "owner",
    "opened",
    "containment_expires",
    "consulted",
  ],
  recovery: [
    "id",
    "schema",
    "signature",
    "scope",
    "status",
    "first_seen",
    "last_verified",
    "expires_after_days",
    "supersedes",
  ],
});
const requiredArtifactSections = Object.freeze({
  incident: ["Failure", "Repair", "Containment", "Verification"],
  recovery: ["Symptom", "Recovery", "Verification", "Limits"],
});
const recoveryScopeFields = new Set(["os", "shell", "tool", "versions"]);
const shippedTemplatePlaceholders = new Set([
  "slug-from-normalized-signature",
  "normalized symptom or error",
  "capability",
  "incident-coordinator",
  "YYYY-MM-DD",
  "Repair the broken mechanism",
  "The intended operation that failed.",
  "Sanitized expected behavior, observed behavior, and minimal reproduction; no raw logs.",
  "The mechanism and source of authority that must change.",
  'Temporary containment, the actor responsible for operating or expiring it, and expiry, or "None". The incident coordinator remains the frontmatter owner.',
  "How to remove containment and exercise the exact original normal path from clean preconditions.",
  "any-or-specific",
  "tool-name",
  "version-range-or-unknown",
  "integer",
  "Correct path in one line",
  "What the agent observes.",
  "The shortest correct operating path.",
  'Sanitized evidence that the recovery caused the intended outcome, or "Pending" while candidate.',
  "Where this recovery does not apply or remains uncertain.",
]);
const maximumEvidenceItems = 8;
const maximumEvidenceItemLength = 512;
const maximumCompactProseLength = 512;
const maximumRequiresItems = 8;
const maximumRequiresItemLength = 128;
const lineBreakPattern = /[\r\n\u0085\u2028\u2029]/u;

function hasField(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function fail(label, message) {
  throw new Error(`${label}${message}`);
}

function requireExactFields(value, label, allowed) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      fail(label, `.${field} is not allowed`);
    }
  }
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

function hasHighConfidenceSensitiveValue(value) {
  return highConfidenceSensitivePatterns.some((pattern) => pattern.test(value));
}

export function validateSanitizedProse(value, label = "prose") {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(label, " must be a non-empty string");
  }
  if (hasHighConfidenceSensitiveValue(value)) {
    fail(
      label,
      " contains a high-confidence sensitive value; sanitize it before receipt construction",
    );
  }
  return value;
}

function requireSanitizedString(value, field, label) {
  const result = requireString(value, field, label);
  return validateSanitizedProse(result, `${label}.${field}`);
}

function requireNormalizedSignature(value, field, label) {
  const result = requireSanitizedString(value, field, label);
  if (normalizeSignature(result) !== result || lineBreakPattern.test(result)) {
    fail(label, `.${field} must be a normalized one-line signature`);
  }
  return result;
}

function requireSafeIdentifier(value, field, label) {
  const result = requireSanitizedString(value, field, label);
  if (!safeIdentifier.test(result)) {
    fail(label, `.${field} must be a lowercase host-neutral identifier`);
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

function requireNullableSanitizedString(value, field, label) {
  const result = requireNullableString(value, field, label);
  if (result !== null && hasHighConfidenceSensitiveValue(result)) {
    fail(
      label,
      `.${field} contains a high-confidence sensitive value; sanitize it before receipt construction`,
    );
  }
  return result;
}

function validateCompactProse(value, label) {
  validateSanitizedProse(value, label);
  if (value.length > maximumCompactProseLength || lineBreakPattern.test(value)) {
    fail(
      label,
      ` must be one line of at most ${maximumCompactProseLength} characters`,
    );
  }
  return value;
}

function requireCompactProse(value, field, label) {
  const result = requireString(value, field, label);
  return validateCompactProse(result, `${label}.${field}`);
}

function requireNullableCompactProse(value, field, label) {
  const result = requireNullableString(value, field, label);
  return result === null
    ? null
    : validateCompactProse(result, `${label}.${field}`);
}

function requireNullableSafeIdentifier(value, field, label) {
  const result = requireNullableSanitizedString(value, field, label);
  if (result !== null && !safeIdentifier.test(result)) {
    fail(label, `.${field} must be null or a lowercase host-neutral identifier`);
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

function requireSanitizedStringArray(value, field, label) {
  const result = requireStringArray(value, field, label);
  if (result.some(hasHighConfidenceSensitiveValue)) {
    fail(
      label,
      `.${field} contains a high-confidence sensitive value; sanitize it before receipt construction`,
    );
  }
  return result;
}

function validateEvidence(value, label) {
  const evidence = requireSanitizedStringArray(value, "evidence", label);
  if (
    evidence.length > maximumEvidenceItems
    || evidence.some(
      (item) =>
        item.length > maximumEvidenceItemLength
        || lineBreakPattern.test(item),
    )
  ) {
    fail(
      label,
      `.evidence must contain at most ${maximumEvidenceItems} one-line items of at most ${maximumEvidenceItemLength} characters`,
    );
  }
  return evidence;
}

function validateRequires(value, label) {
  const requires = requireSanitizedStringArray(value, "requires", label);
  if (
    requires.length > maximumRequiresItems
    || requires.some(
      (item) =>
        item.length > maximumRequiresItemLength
        || lineBreakPattern.test(item),
    )
  ) {
    fail(
      label,
      `.requires must contain at most ${maximumRequiresItems} one-line items of at most ${maximumRequiresItemLength} characters`,
    );
  }
  return requires;
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
  requireExactFields(escalation, label, escalationFields);
  validateRequires(escalation, label);
  requireCompactProse(escalation, "target", label);
  requireCompactProse(escalation, "action", label);
}

function validateContainment(containment, label) {
  requireObject(containment, label);
  requireExactFields(containment, label, containmentFields);
  const used = requireBoolean(containment, "used", label);
  const summary = requireNullableCompactProse(containment, "summary", label);
  const verificationGate = requireNullableCompactProse(
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
  return used;
}

function frontmatterSource(content) {
  if (!content.startsWith("---\n")) {
    return "";
  }
  const end = content.indexOf("\n---", 4);
  return end === -1 ? "" : content.slice(4, end);
}

function parseInlineList(raw, { nonempty }) {
  const match = /^\[(.*)\]$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  if (match[1].trim() === "") {
    return nonempty ? null : [];
  }
  const items = match[1].split(",").map((item) =>
    item.trim().replace(/^(["'])(.*)\1$/, "$2"),
  );
  return items.some((item) => item.length === 0) ? null : items;
}

function parseNestedMap(source, key) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*$`).test(line));
  if (start === -1) {
    return null;
  }
  const result = {};
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line)) {
      break;
    }
    if (!line.trim()) {
      continue;
    }
    const match = /^\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!match || match[2].trim().length === 0) {
      return null;
    }
    if (hasField(result, match[1])) {
      return null;
    }
    result[match[1]] = match[2].trim();
  }
  return result;
}

function sectionHasBody(body, section) {
  const heading = new RegExp(`^##\\s+${section}\\b[^\\n]*\\n`, "m");
  const match = heading.exec(body);
  if (!match) {
    return false;
  }
  const remainder = body.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^##\s+/m);
  const sectionBody = (nextHeading === -1 ? remainder : remainder.slice(0, nextHeading))
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return sectionBody.length > 0;
}

function hasNonemptyField(fields, field) {
  return hasField(fields, field)
    && typeof fields[field] === "string"
    && fields[field].trim().length > 0;
}

function containsShippedTemplatePlaceholder(content) {
  const prose = content.replace(/<!--[\s\S]*?-->/g, "");
  const placeholders = [...prose.matchAll(/<([\s\S]*?)>/g)].map((match) =>
    match[1].replace(/\s+/gu, " ").trim(),
  );
  return placeholders.some((placeholder) =>
    shippedTemplatePlaceholders.has(placeholder),
  );
}

function validateIncidentArtifactSchema(fields, source) {
  const requiredPresent = requiredArtifactFields.incident.every((field) =>
    hasNonemptyField(fields, field),
  );
  const requires = hasField(fields, "requires")
    ? parseInlineList(fields.requires, { nonempty: true })
    : null;
  const consulted = hasField(fields, "consulted")
    ? parseInlineList(fields.consulted, { nonempty: false })
    : null;
  const containmentExpiryValid =
    fields.containment_expires === "null"
    || parseIsoDate(fields.containment_expires) !== null;
  return requiredPresent
    && requires !== null
    && consulted !== null
    && parseIsoDate(fields.opened) !== null
    && containmentExpiryValid
    && source.length > 0;
}

function validateRecoveryArtifactSchema(fields, source) {
  const requiredPresent = requiredArtifactFields.recovery.every((field) =>
    field === "scope" ? hasField(fields, field) : hasNonemptyField(fields, field),
  );
  const scope = parseNestedMap(source, "scope");
  const scopeValid =
    scope !== null
    && Object.keys(scope).length === recoveryScopeFields.size
    && [...recoveryScopeFields].every((field) => hasNonemptyField(scope, field));
  const lastVerifiedValid =
    fields.last_verified === "null"
    || parseIsoDate(fields.last_verified) !== null;
  const expiresValid =
    /^[1-9][0-9]*$/.test(fields.expires_after_days)
    && Number.isSafeInteger(Number(fields.expires_after_days));
  const supersedesValid =
    fields.supersedes === "null"
    || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.supersedes);
  return requiredPresent
    && scopeValid
    && parseIsoDate(fields.first_seen) !== null
    && lastVerifiedValid
    && expiresValid
    && supersedesValid;
}

function validateProposedArtifact(artifact, label) {
  if (artifact === null) {
    return;
  }
  requireExactFields(artifact, label, proposedArtifactFields);
  const kind = requireEnum(artifact, "kind", label, new Set(["recovery", "incident"]));
  const content = requireSanitizedString(artifact, "content", label);
  const { fields, body } = parseFrontmatter(content);
  const source = frontmatterSource(content);
  const schemaValid = kind === "incident"
    ? validateIncidentArtifactSchema(fields, source)
    : validateRecoveryArtifactSchema(fields, source);
  const completeSections = requiredArtifactSections[kind].every((section) =>
    sectionHasBody(body, section),
  );
  const filename = fields.id ? `${fields.id}.md` : "proposed-artifact.md";
  const mechanicalIdValid =
    typeof fields.id === "string"
    && typeof fields.signature === "string"
    && artifactRefMatchesCanonicalId(
      fields.id,
      slugFromSignature(fields.signature),
    );
  const validation = validateCapsuleText(content, {
    kind,
    filename,
    // Receipt validation must be deterministic; lifecycle expiry is checked
    // again when the authoritative actor persists the capsule.
    today: new Date("1970-01-01T00:00:00.000Z"),
  });
  if (
    !content.includes("\n")
    || containsShippedTemplatePlaceholder(content)
    || !mechanicalIdValid
    || !schemaValid
    || !completeSections
    || validation.errors.length > 0
  ) {
    fail(label, `.content must be a complete filled sanitized ${kind} artifact`);
  }
}

function validateTerminalActionFields(receipt, label, outcome, childReceipt = null) {
  const artifactRef = requireNullableSafeIdentifier(receipt, "artifact_ref", label);
  const noArtifactReason = requireNullableCompactProse(
    receipt,
    "no_artifact_reason",
    label,
  );
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
    if (escalation !== null) {
      fail(label, " no_artifact requires escalation null");
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

function artifactRefMatchesCanonicalId(artifactRef, canonicalId) {
  if (artifactRef === canonicalId) {
    return true;
  }
  if (!artifactRef.startsWith(`${canonicalId}-`)) {
    return false;
  }
  const collisionSuffix = artifactRef.slice(canonicalId.length + 1);
  const collisionNumber = Number(collisionSuffix);
  return /^[1-9][0-9]*$/.test(collisionSuffix)
    && Number.isSafeInteger(collisionNumber)
    && collisionNumber >= 2;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function receiptPayloadDigest(receipt) {
  return createHash("sha256").update(canonicalJson(receipt)).digest("hex");
}

export function validateTerminalReceipt(receipt, label = "terminal_receipt") {
  requireObject(receipt, label);
  requireExactFields(receipt, label, terminalReceiptFields);
  if (requireField(receipt, "receipt_schema", label) !== 1) {
    fail(label, ".receipt_schema must be 1");
  }
  requireSafeIdentifier(receipt, "receipt_id", label);
  requireNormalizedSignature(receipt, "signature", label);
  requireSafeIdentifier(receipt, "dedupe_key", label);
  const classification = requireEnum(receipt, "classification", label, classifications);
  validateEvidence(receipt, label);
  requireEnum(receipt, "task_outcome", label, taskOutcomes);
  requireEnum(receipt, "mechanism_health", label, mechanismHealthStates);
  const containmentUsed = validateContainment(
    requireField(receipt, "containment", label),
    `${label}.containment`,
  );
  const outcome = requireEnum(receipt, "terminal_outcome", label, terminalOutcomes);
  validateTerminalActionFields(receipt, label, outcome);
  if (classification === "none" && outcome !== "no_artifact") {
    fail(label, ".classification none requires terminal_outcome no_artifact");
  }
  if (outcome === "no_artifact" && classification !== "none") {
    fail(label, ".terminal_outcome no_artifact requires classification none");
  }
  if (
    containmentUsed
    && classification !== "incident"
    && classification !== "external"
  ) {
    fail(label, ".containment.used may be true only for incident or external classification");
  }
  if (
    outcome === "persisted_artifact"
    && !artifactRefMatchesCanonicalId(
      receipt.artifact_ref,
      slugFromSignature(receipt.signature),
    )
  ) {
    fail(
      label,
      ".artifact_ref must equal the mechanical slug of signature or its documented -N collision id",
    );
  }
  if (
    (classification === "incident" || classification === "external")
    && receipt.escalation === null
  ) {
    fail(label, `.escalation is required for ${classification} classification`);
  }
  if (receipt.proposed_artifact !== null) {
    const expectedKind = classification === "recovery" ? "recovery" : "incident";
    if (receipt.proposed_artifact.kind !== expectedKind) {
      fail(label, `.proposed_artifact.kind must be ${expectedKind} for ${classification}`);
    }
  }
  return receipt;
}

export function validateParentReceipt(parent, childReceipt, label = "parent_receipt") {
  requireObject(parent, label);
  validateTerminalReceipt(childReceipt, `${label}.child_receipt`);
  requireExactFields(parent, label, parentReceiptFields);
  if (requireField(parent, "receipt_schema", label) !== 1) {
    fail(label, ".receipt_schema must be 1");
  }
  const parentReceiptId = requireSafeIdentifier(parent, "receipt_id", label);
  const childReceiptId = requireSafeIdentifier(parent, "child_receipt_id", label);
  if (childReceiptId !== childReceipt.receipt_id) {
    fail(label, ".child_receipt_id must match terminal_receipt.receipt_id");
  }
  if (parentReceiptId === childReceiptId) {
    fail(label, ".receipt_id must differ from child_receipt_id");
  }
  const childPayloadDigest = requireString(parent, "child_payload_sha256", label);
  if (!/^[0-9a-f]{64}$/.test(childPayloadDigest)) {
    fail(label, ".child_payload_sha256 must be a lowercase SHA-256 digest");
  }
  if (childPayloadDigest !== receiptPayloadDigest(childReceipt)) {
    fail(label, ".child_payload_sha256 must bind the complete child receipt");
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
  if (
    outcome === "proposed_artifact"
    && !isDeepStrictEqual(parent.proposed_artifact, childReceipt.proposed_artifact)
  ) {
    fail(label, ".proposed_artifact must preserve the complete child proposed artifact");
  }
  if (outcome === "persisted_artifact" && childReceipt.proposed_artifact !== null) {
    const proposedId = parseFrontmatter(childReceipt.proposed_artifact.content).fields.id;
    if (!artifactRefMatchesCanonicalId(parent.artifact_ref, proposedId)) {
      fail(
        label,
        ".artifact_ref must equal the proposed artifact id or its documented -N collision id",
      );
    }
  } else if (
    outcome === "persisted_artifact"
    && !artifactRefMatchesCanonicalId(
      parent.artifact_ref,
      slugFromSignature(childReceipt.signature),
    )
  ) {
    fail(
      label,
      ".artifact_ref must equal the mechanical child signature slug or its documented -N collision id",
    );
  }
  if (
    outcome === "persisted_artifact"
    && (childReceipt.classification === "incident" || childReceipt.classification === "external")
    && parent.escalation === null
  ) {
    fail(label, ".escalation is required when persisting an incident or external incident");
  }
  return parent;
}
