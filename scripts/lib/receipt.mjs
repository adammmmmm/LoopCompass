import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseIsoDate, validateCapsuleText } from "./capsule.mjs";
import { parseFrontmatter, parseInlineListValue } from "./frontmatter.mjs";
import {
  isMechanicalSlugOrCollision,
  normalizeSignature,
  slugFromSignature,
} from "./signature.mjs";

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
const safeIdentifier = /^[a-z0-9][a-z0-9._:-]*$/;
const safeDedupeKey = /^[a-z0-9][a-z0-9._:|-]*$/;
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
const structuralTemplatePlaceholders = new Set([
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
const proseTemplatePlaceholders = new Set([
  "Repair the broken mechanism",
  "The intended operation that failed.",
  "Sanitized expected behavior, observed behavior, and minimal reproduction; no raw logs.",
  "The mechanism and source of authority that must change.",
  'Temporary containment, the actor responsible for operating or expiring it, and expiry, or "None". The incident coordinator remains the frontmatter owner.',
  "How to remove containment and exercise the exact original normal path from clean preconditions.",
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
const maximumIdentifierLength = 128;
const maximumDedupeKeyLength = 256;
const maximumSignatureLength = 512;
const maximumProposedContentBytes = 32768;
const maximumTemplateCandidateLength = 512;
const lineBreakPattern = /[\r\n\u0085\u2028\u2029]/u;
const defaultIgnorablePattern = /\p{Default_Ignorable_Code_Point}/gu;
const formatCharacterPattern = /\p{Cf}/u;
const unsafeSeparatorPattern = /[\p{Zl}\p{Zp}]/u;
const controlCharacterPattern = /\p{Cc}/u;

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

function hasUnsafeTextControl(value, { allowLf = false } = {}) {
  for (const character of value) {
    if (allowLf && character === "\n") {
      continue;
    }
    if (
      controlCharacterPattern.test(character)
      || formatCharacterPattern.test(character)
      || unsafeSeparatorPattern.test(character)
      || /\p{Default_Ignorable_Code_Point}/u.test(character)
    ) {
      return true;
    }
  }
  return false;
}

export function validateSanitizedProse(
  value,
  label = "prose",
  options = {},
) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(label, " must be a non-empty string");
  }
  if (
    typeof value.isWellFormed === "function"
      ? !value.isWellFormed()
      : /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  ) {
    fail(label, " contains an unpaired Unicode surrogate; sanitize it before use");
  }
  if (hasUnsafeTextControl(value, options)) {
    fail(
      label,
      " contains an unsafe Unicode or control character; sanitize it before use",
    );
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
  if (
    result.length > maximumSignatureLength
    || normalizeSignature(result) !== result
    || lineBreakPattern.test(result)
  ) {
    fail(
      label,
      `.${field} must be a normalized one-line signature of at most ${maximumSignatureLength} characters`,
    );
  }
  return result;
}

function requireSafeIdentifier(value, field, label) {
  const result = requireSanitizedString(value, field, label);
  if (result.length > maximumIdentifierLength || !safeIdentifier.test(result)) {
    fail(
      label,
      `.${field} must be a lowercase host-neutral identifier of at most ${maximumIdentifierLength} characters`,
    );
  }
  return result;
}

function requireDedupeKey(value, field, label) {
  const result = requireSanitizedString(value, field, label);
  if (
    result.length > maximumDedupeKeyLength
    || !safeDedupeKey.test(result)
  ) {
    fail(
      label,
      `.${field} must be a lowercase host-neutral dedupe key of at most ${maximumDedupeKeyLength} characters`,
    );
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
  if (result !== null) {
    validateSanitizedProse(result, `${label}.${field}`);
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
  if (
    result !== null
    && (result.length > maximumIdentifierLength || !safeIdentifier.test(result))
  ) {
    fail(
      label,
      `.${field} must be null or a lowercase host-neutral identifier of at most ${maximumIdentifierLength} characters`,
    );
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
  for (const item of result) {
    validateSanitizedProse(item, `${label}.${field}`);
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
  const end = content.indexOf("\n---\n", 4);
  return end === -1 ? "" : content.slice(4, end);
}

function scalarLooksUnresolved(raw) {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  const values = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1).split(",").map((item) => item.trim())
    : [value];
  return values.some((item) => {
    let candidate = item;
    if (
      (candidate.startsWith('"') && candidate.endsWith('"'))
      || (candidate.startsWith("'") && candidate.endsWith("'"))
    ) {
      candidate = candidate.slice(1, -1).trim();
    }
    return /^<+[^<>]+>+$/u.test(candidate);
  });
}

function parseStrictQuotedString(raw) {
  if (!raw.startsWith('"') || !raw.endsWith('"')) {
    return null;
  }
  try {
    const value = JSON.parse(raw);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function strictPlainScalar(raw) {
  const value = raw.trim();
  if (
    value.length === 0
    || /[\[\]{}"'\\`]/u.test(value)
    || /^(?:[&*!|>@]|---$)/u.test(value)
    || /(?:^|\s)[&*!][^\s]*/u.test(value)
    || /:(?:\s|$)|(?:^|\s)#/u.test(value)
  ) {
    return null;
  }
  return value;
}

function decodedScalarLooksTemplate(value) {
  const normalized = normalizeTemplateMarker(value);
  return scalarLooksUnresolved(value)
    || [...structuralTemplatePlaceholders].some((marker) =>
      normalized.includes(normalizeTemplateMarker(`<${marker}>`)),
    )
    || [...proseTemplatePlaceholders].some((marker) =>
      normalized.includes(normalizeTemplateMarker(marker)),
    );
}

function decodedArtifactScalarIsValid(value) {
  return !decodedScalarLooksTemplate(value);
}

function validateDecodedArtifactScalars(value, label) {
  if (typeof value === "string") {
    validateSanitizedProse(value, label);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateDecodedArtifactScalars(item, `${label}[${index}]`),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [field, nested] of Object.entries(value)) {
      validateDecodedArtifactScalars(nested, `${label}.${field}`);
    }
  }
}

function parseStrictInlineList(raw, { nonempty }) {
  const items = parseInlineListValue(raw);
  if (items === null || (nonempty && items.length === 0)) {
    return null;
  }
  for (const parsed of items) {
    if (strictPlainScalar(parsed) === null) {
      return null;
    }
    try {
      validateSanitizedProse(parsed, "frontmatter list item");
    } catch {
      return null;
    }
    if (
      decodedScalarLooksTemplate(parsed)
    ) {
      return null;
    }
  }
  return items;
}

function parseStrictArtifactScalar(kind, field, raw, { nested = false } = {}) {
  const value = raw.trim();
  if (field === "signature" && !nested) {
    const signature = parseStrictQuotedString(value);
    return signature !== null && decodedArtifactScalarIsValid(signature)
      ? signature
      : null;
  }
  if (kind === "incident" && !nested && field === "requires") {
    return parseStrictInlineList(value, { nonempty: true });
  }
  if (kind === "incident" && !nested && field === "consulted") {
    return parseStrictInlineList(value, { nonempty: false });
  }
  const decoded = value.startsWith('"')
    ? parseStrictQuotedString(value)
    : value;
  if (decoded === null || !decodedArtifactScalarIsValid(decoded)) {
    return null;
  }
  validateSanitizedProse(decoded, "decoded artifact scalar");
  return strictPlainScalar(decoded);
}

function parseStrictProposedFrontmatter(source, kind) {
  if (source.length === 0) {
    return null;
  }
  const allowedTopLevel = new Set(requiredArtifactFields[kind]);
  const topLevel = new Set();
  const nested = new Map();
  const fields = {};
  let activeMap = null;

  for (const line of source.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    if (/^\s/.test(line)) {
      const match = /^  ([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
      if (!match || activeMap !== "scope" || match[2].trim().length === 0) {
        return null;
      }
      const keys = nested.get(activeMap) ?? new Set();
      const parsed = parseStrictArtifactScalar(kind, match[1], match[2], {
        nested: true,
      });
      if (
        keys.has(match[1])
        || !recoveryScopeFields.has(match[1])
        || parsed === null
        || scalarLooksUnresolved(match[2])
      ) {
        return null;
      }
      keys.add(match[1]);
      nested.set(activeMap, keys);
      fields[activeMap][match[1]] = parsed;
      continue;
    }

    const match = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!match || topLevel.has(match[1]) || !allowedTopLevel.has(match[1])) {
      return null;
    }
    topLevel.add(match[1]);
    activeMap = match[2].trim().length === 0 ? match[1] : null;
    if (activeMap === null) {
      const parsed = parseStrictArtifactScalar(kind, match[1], match[2]);
      if (parsed === null || scalarLooksUnresolved(match[2])) {
        return null;
      }
      fields[match[1]] = parsed;
    } else if (kind !== "recovery" || match[1] !== "scope") {
      return null;
    } else {
      fields[match[1]] = {};
    }
  }

  if (
    topLevel.size !== allowedTopLevel.size
    || [...allowedTopLevel].some((field) => !topLevel.has(field))
  ) {
    return null;
  }
  if (kind === "incident") {
    return nested.size === 0 ? fields : null;
  }
  const scope = nested.get("scope");
  return nested.size === 1
    && scope?.size === recoveryScopeFields.size
    && [...recoveryScopeFields].every((field) => scope.has(field))
    ? fields
    : null;
}

function getSectionBody(body, section) {
  const heading = new RegExp(`^##\\s+${section}\\b[^\\n]*\\n`, "m");
  const match = heading.exec(body);
  if (!match) {
    return null;
  }
  const remainder = body.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^##\s+/m);
  return (nextHeading === -1 ? remainder : remainder.slice(0, nextHeading))
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

function sectionHasBody(body, section) {
  const sectionBody = getSectionBody(body, section);
  return sectionBody !== null && sectionBody.length > 0;
}

function hasNonemptyField(fields, field) {
  return hasField(fields, field)
    && typeof fields[field] === "string"
    && fields[field].trim().length > 0;
}

function normalizeTemplateMarker(value) {
  return value
    .replace(defaultIgnorablePattern, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function angleCandidatesFromEveryStart(value) {
  const candidates = [];
  for (
    let start = value.indexOf("<");
    start !== -1;
    start = value.indexOf("<", start + 1)
  ) {
    // Bound work per opening angle so nested-marker detection remains linear
    // even for a near-limit artifact containing many unmatched "<" bytes.
    const bounded = value.slice(
      start + 1,
      start + 2 + maximumTemplateCandidateLength,
    );
    const relativeEnd = bounded.indexOf(">");
    if (relativeEnd !== -1) {
      candidates.push(normalizeTemplateMarker(bounded.slice(0, relativeEnd)));
    }
  }
  return candidates;
}

function unwrapStructuralPlaceholder(value) {
  let candidate = normalizeTemplateMarker(value);
  if (
    (candidate.startsWith('"') && candidate.endsWith('"'))
    || (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1).trim();
  }
  if (candidate.startsWith("[") && candidate.endsWith("]")) {
    candidate = candidate.slice(1, -1).trim();
  }
  while (candidate.startsWith("<") && candidate.endsWith(">")) {
    candidate = candidate.slice(1, -1).trim();
  }
  return normalizeTemplateMarker(candidate);
}

function containsShippedTemplatePlaceholder(content, source, body, kind) {
  const normalizedRawContent = normalizeTemplateMarker(content);
  const renderEquivalentContent = normalizeTemplateMarker(
    content
      .replace(/<!--[\s\S]*?-->/gu, "")
      .replace(/<\/?[A-Za-z][^>]*>/gu, ""),
  );
  if (
    [...proseTemplatePlaceholders].some((marker) =>
      normalizedRawContent.includes(normalizeTemplateMarker(marker))
      || renderEquivalentContent.includes(normalizeTemplateMarker(marker)),
    )
    ||
    angleCandidatesFromEveryStart(content).some((candidate) =>
      proseTemplatePlaceholders.has(candidate),
    )
  ) {
    return true;
  }
  const frontmatterValues = source.split("\n").flatMap((line) => {
    const match = /^\s*[A-Za-z0-9_]+:\s*(.+)$/.exec(line);
    return match ? [match[1]] : [];
  });
  if (
    frontmatterValues.some((value) =>
      scalarLooksUnresolved(value)
      || structuralTemplatePlaceholders.has(unwrapStructuralPlaceholder(value)),
    )
  ) {
    return true;
  }
  return requiredArtifactSections[kind].some((section) =>
    scalarLooksUnresolved(getSectionBody(body, section) ?? "")
    || structuralTemplatePlaceholders.has(
      unwrapStructuralPlaceholder(getSectionBody(body, section) ?? ""),
    ),
  );
}

function validateIncidentArtifactSchema(fields, source) {
  const requiredPresent = requiredArtifactFields.incident.every((field) =>
    field === "requires"
      ? Array.isArray(fields[field]) && fields[field].length > 0
      : field === "consulted"
        ? Array.isArray(fields[field])
        : hasNonemptyField(fields, field),
  );
  const containmentExpiryValid =
    fields.containment_expires === "null"
    || parseIsoDate(fields.containment_expires) !== null;
  return requiredPresent
    && parseIsoDate(fields.opened) !== null
    && containmentExpiryValid
    && source.length > 0;
}

function validateRecoveryArtifactSchema(fields) {
  const requiredPresent = requiredArtifactFields.recovery.every((field) =>
    field === "scope" ? hasField(fields, field) : hasNonemptyField(fields, field),
  );
  const scope = fields.scope;
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
  const content = requireString(artifact, "content", label);
  if (Buffer.byteLength(content, "utf8") > maximumProposedContentBytes) {
    fail(label, `.content must be at most ${maximumProposedContentBytes} UTF-8 bytes`);
  }
  const normalizedContent = content.replace(/\r\n/g, "\n");
  validateSanitizedProse(
    normalizedContent,
    `${label}.content`,
    { allowLf: true },
  );
  const { body } = parseFrontmatter(normalizedContent);
  const source = frontmatterSource(normalizedContent);
  const fields = parseStrictProposedFrontmatter(source, kind);
  if (fields === null) {
    fail(label, `.content must be a complete filled sanitized ${kind} artifact`);
  }
  validateDecodedArtifactScalars(fields, `${label}.content.frontmatter`);
  const proposedSignature = requireNormalizedSignature(
    fields,
    "signature",
    `${label}.content.frontmatter`,
  );
  const schemaValid = kind === "incident"
    ? validateIncidentArtifactSchema(fields, source)
    : validateRecoveryArtifactSchema(fields);
  const completeSections = requiredArtifactSections[kind].every((section) =>
    sectionHasBody(body, section),
  );
  const filename = fields.id ? `${fields.id}.md` : "proposed-artifact.md";
  const mechanicalIdValid =
    typeof fields.id === "string"
    && isMechanicalSlugOrCollision(
      fields.id,
      slugFromSignature(proposedSignature),
    );
  const validation = validateCapsuleText(normalizedContent, {
    kind,
    filename,
    // Receipt validation must be deterministic; lifecycle expiry is checked
    // again when the authoritative actor persists the capsule.
    today: new Date("1970-01-01T00:00:00.000Z"),
  });
  if (
    !normalizedContent.includes("\n")
    || containsShippedTemplatePlaceholder(
      normalizedContent,
      source,
      body,
      kind,
    )
    || !mechanicalIdValid
    || !schemaValid
    || !completeSections
    || validation.errors.length > 0
  ) {
    fail(label, `.content must be a complete filled sanitized ${kind} artifact`);
  }
  return {
    id: fields.id,
    signature: proposedSignature,
    opened: kind === "incident" ? fields.opened : null,
    containmentExpires:
      kind === "incident" && fields.containment_expires !== "null"
        ? fields.containment_expires
        : null,
  };
}

function validateTerminalActionFields(receipt, label, outcome, childReceipt = null) {
  const artifactRef = requireNullableSafeIdentifier(receipt, "artifact_ref", label);
  const noArtifactReason = requireNullableCompactProse(
    receipt,
    "no_artifact_reason",
    label,
  );
  const proposedArtifact = requireNullableObject(receipt, "proposed_artifact", label);
  const proposedArtifactIdentity = validateProposedArtifact(
    proposedArtifact,
    `${label}.proposed_artifact`,
  );
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
  return proposedArtifactIdentity;
}

function artifactRefMatchesCanonicalId(artifactRef, canonicalId) {
  return isMechanicalSlugOrCollision(artifactRef, canonicalId);
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
  requireDedupeKey(receipt, "dedupe_key", label);
  const classification = requireEnum(receipt, "classification", label, classifications);
  validateEvidence(receipt, label);
  requireEnum(receipt, "task_outcome", label, taskOutcomes);
  requireEnum(receipt, "mechanism_health", label, mechanismHealthStates);
  const containmentUsed = validateContainment(
    requireField(receipt, "containment", label),
    `${label}.containment`,
  );
  const outcome = requireEnum(receipt, "terminal_outcome", label, terminalOutcomes);
  const proposedArtifactIdentity = validateTerminalActionFields(
    receipt,
    label,
    outcome,
  );
  if (
    proposedArtifactIdentity !== undefined
    && proposedArtifactIdentity.signature !== receipt.signature
  ) {
    fail(
      label,
      ".proposed_artifact signature must match terminal receipt signature",
    );
  }
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
    containmentUsed
    && outcome === "proposed_artifact"
    && (
      proposedArtifactIdentity?.containmentExpires === null
      || parseIsoDate(proposedArtifactIdentity?.containmentExpires) === null
      || parseIsoDate(proposedArtifactIdentity?.opened) === null
      || proposedArtifactIdentity.containmentExpires <= proposedArtifactIdentity.opened
    )
  ) {
    fail(
      label,
      ".containment.used with a proposed incident requires containment_expires after opened",
    );
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

export function validateParentReceipt(
  parent,
  childReceipt,
  label = "parent_receipt",
  { today = new Date() } = {},
) {
  requireObject(parent, label);
  validateTerminalReceipt(childReceipt, `${label}.child_receipt`);
  if (childReceipt.terminal_outcome !== "proposed_artifact") {
    fail(label, ".child_receipt must have terminal_outcome proposed_artifact");
  }
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
  if (outcome === "persisted_artifact" && childReceipt.containment.used) {
    const childArtifact = validateProposedArtifact(
      childReceipt.proposed_artifact,
      `${label}.child_receipt.proposed_artifact`,
    );
    const expiry = parseIsoDate(childArtifact?.containmentExpires);
    const persistenceDate = new Date(today);
    const persistenceDay = Number.isNaN(persistenceDate.getTime())
      ? null
      : persistenceDate.toISOString().slice(0, 10);
    if (expiry === null || persistenceDay === null || childArtifact.containmentExpires < persistenceDay) {
      fail(label, ".terminal_action persisted_artifact requires unexpired containment");
    }
  }
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
  if (
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
