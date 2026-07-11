/**
 * Minimal YAML-ish frontmatter parse/validate for LoopCompass artifacts.
 */

/**
 * @param {string} text
 * @returns {{ fields: Record<string, string>, body: string }}
 */
export function parseFrontmatter(text) {
  const src = String(text ?? "").replace(/\r\n/g, "\n");
  if (!src.startsWith("---\n")) {
    return { fields: {}, body: src };
  }
  const end = src.indexOf("\n---", 4);
  if (end === -1) {
    return { fields: {}, body: src };
  }
  const fields = {};
  for (const line of src.slice(4, end).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = value;
  }
  const body = src.slice(end + 4).replace(/^\n/, "");
  return { fields, body };
}

const RECOVERY_STATUSES = new Set(["candidate", "verified", "stale", "superseded"]);
const INCIDENT_STATUSES = new Set([
  "detected",
  "escalated",
  "repairing",
  "blocked",
  "verified",
]);

/**
 * @param {Record<string, string>} fields
 * @returns {string[]} errors
 */
export function validateRecoveryFields(fields) {
  const errors = [];
  for (const key of ["id", "schema", "signature", "status"]) {
    if (!fields[key]) errors.push(`recovery missing field: ${key}`);
  }
  if (fields.schema && fields.schema !== "1") {
    errors.push(`recovery schema must be 1, got ${fields.schema}`);
  }
  if (fields.status && !RECOVERY_STATUSES.has(fields.status)) {
    errors.push(`recovery status invalid: ${fields.status}`);
  }
  if (fields.id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.id)) {
    errors.push(`recovery id is not a mechanical slug: ${fields.id}`);
  }
  return errors;
}

/**
 * @param {Record<string, string>} fields
 * @returns {string[]} errors
 */
export function validateIncidentFields(fields) {
  const errors = [];
  for (const key of ["id", "schema", "signature", "status", "owner", "opened"]) {
    if (!fields[key]) errors.push(`incident missing field: ${key}`);
  }
  if (fields.schema && fields.schema !== "1") {
    errors.push(`incident schema must be 1, got ${fields.schema}`);
  }
  if (fields.status && !INCIDENT_STATUSES.has(fields.status)) {
    errors.push(`incident status invalid: ${fields.status}`);
  }
  if (fields.id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.id)) {
    errors.push(`incident id is not a mechanical slug: ${fields.id}`);
  }
  return errors;
}

/** Lanes allowed by classification.md */
export const LANES = new Set(["recovery", "incident", "external", "none"]);
