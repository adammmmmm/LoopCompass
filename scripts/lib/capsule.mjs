/**
 * Validate LoopCompass recovery/incident capsules on disk.
 * Mechanical rules only; does not judge classification quality.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";
import { slugFromSignature } from "./signature.mjs";

export const RECOVERY_STATUSES = new Set([
  "candidate",
  "verified",
  "stale",
  "superseded",
]);

export const INCIDENT_STATUSES = new Set([
  "detected",
  "escalated",
  "repairing",
  "blocked",
  "verified",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string} raw
 * @returns {Date | null}
 */
export function parseIsoDate(raw) {
  if (!raw || !DATE_RE.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {string} text
 * @param {{ kind: "recovery" | "incident", filename: string, today?: Date }} opts
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateCapsuleText(text, opts) {
  const errors = [];
  const warnings = [];
  const { kind, filename } = opts;
  const today = opts.today ?? new Date();
  const { fields, body } = parseFrontmatter(text);

  if (!Object.keys(fields).length) {
    errors.push(`${filename}: missing YAML frontmatter`);
    return { errors, warnings };
  }

  for (const key of ["id", "schema", "signature", "status"]) {
    if (!fields[key]) errors.push(`${filename}: missing field ${key}`);
  }

  if (fields.schema && fields.schema !== "1") {
    errors.push(`${filename}: schema must be 1, got ${fields.schema}`);
  }

  const statuses = kind === "recovery" ? RECOVERY_STATUSES : INCIDENT_STATUSES;
  if (fields.status && !statuses.has(fields.status)) {
    errors.push(`${filename}: invalid ${kind} status ${fields.status}`);
  }

  if (fields.id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.id)) {
    errors.push(`${filename}: id is not a mechanical slug: ${fields.id}`);
  }

  if (fields.signature && fields.id) {
    const expected = slugFromSignature(fields.signature);
    // Allow collision suffixes -2, -3 on id when signature slug is the prefix.
    const id = fields.id;
    const ok =
      id === expected ||
      (id.startsWith(`${expected}-`) && /^[0-9]+$/.test(id.slice(expected.length + 1)));
    if (!ok) {
      errors.push(
        `${filename}: id must be mechanical slug of signature (expected ${expected} or ${expected}-N, got ${id})`,
      );
    }
  }

  if (filename && fields.id && filename !== `${fields.id}.md`) {
    errors.push(
      `${filename}: filename must equal id.md (id=${fields.id})`,
    );
  }

  if (!/^##\s+Verification\b/m.test(body)) {
    errors.push(`${filename}: body must include a ## Verification section`);
  }

  if (kind === "incident") {
    for (const key of ["owner", "opened"]) {
      if (!fields[key]) errors.push(`${filename}: incident missing field ${key}`);
    }
    if (fields.opened && !parseIsoDate(fields.opened)) {
      errors.push(`${filename}: opened must be YYYY-MM-DD`);
    }
    if (
      fields.containment_expires &&
      fields.containment_expires !== "null" &&
      fields.containment_expires !== ""
    ) {
      const exp = parseIsoDate(fields.containment_expires);
      if (!exp) {
        errors.push(`${filename}: containment_expires must be YYYY-MM-DD or null`);
      } else {
        const startOfToday = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
        );
        if (exp < startOfToday && fields.status !== "verified") {
          errors.push(
            `${filename}: containment_expires ${fields.containment_expires} is past; renew, clear containment, or close the incident`,
          );
        }
      }
    }
    if (!/^##\s+Failure\b/m.test(body)) {
      warnings.push(`${filename}: incident body should include ## Failure`);
    }
  }

  if (kind === "recovery") {
    if (fields.status === "verified" && /Pending/i.test(body) && /##\s+Verification/.test(body)) {
      const ver = body.split(/##\s+Verification/)[1] || "";
      if (/^\s*Pending\b/im.test(ver.trim())) {
        warnings.push(
          `${filename}: status is verified but Verification section still says Pending`,
        );
      }
    }
  }

  return { errors, warnings };
}

/**
 * @param {string} dir absolute path to recoveries or incidents
 * @param {"recovery" | "incident"} kind
 * @param {{ today?: Date }} [opts]
 */
export function validateCapsuleDir(dir, kind, opts = {}) {
  const errors = [];
  const warnings = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return {
      errors: [`${kind} store not found: ${dir}`],
      warnings,
      files: 0,
    };
  }

  let files = 0;
  for (const name of entries) {
    if (name === ".gitkeep" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (!statSync(full).isFile()) continue;
    if (!name.endsWith(".md")) {
      errors.push(`${name}: capsule must be a .md file`);
      continue;
    }
    files += 1;
    const text = readFileSync(full, "utf8");
    const result = validateCapsuleText(text, {
      kind,
      filename: name,
      today: opts.today,
    });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return { errors, warnings, files };
}

/**
 * Validate a project's .loopcompass state directory.
 * @param {string} loopcompassDir path to .loopcompass
 * @param {{ today?: Date }} [opts]
 */
export function validateStateDir(loopcompassDir, opts = {}) {
  const recoveries = validateCapsuleDir(
    path.join(loopcompassDir, "recoveries"),
    "recovery",
    opts,
  );
  const incidents = validateCapsuleDir(
    path.join(loopcompassDir, "incidents"),
    "incident",
    opts,
  );
  return {
    errors: [...recoveries.errors, ...incidents.errors],
    warnings: [...recoveries.warnings, ...incidents.warnings],
    recoveryFiles: recoveries.files,
    incidentFiles: incidents.files,
  };
}
