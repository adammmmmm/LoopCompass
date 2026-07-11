/**
 * Deterministic signature normalization and artifact slug derivation.
 * Must match skills/loop-compass/SKILL.md ("Create a recovery" / design.md).
 */

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LONG_HEX_RE = /\b[0-9a-f]{24,}\b/gi;
const ISO_TS_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
const UNIX_TS_RE = /\b1[5-9]\d{8,11}\b/g;
const WIN_PATH_RE = /\b[A-Za-z]:\\(?:[^\s"'`]+)/g;
const UNIX_PATH_RE =
  /(?:^|[\s"'`(=])(\/(?:home|Users|tmp|var|private|opt|usr|etc|mnt|Users)\/[^\s"'`]+)/g;
const SECRET_RE =
  /\b(?:sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{10,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PID_RE = /\bpid[=:\s]+\d+\b/gi;

/**
 * Normalize a failure signature by stripping volatile paths, IDs, timestamps,
 * and secret-bearing values. Collapses whitespace.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeSignature(raw) {
  let s = String(raw ?? "");
  s = s.replace(SECRET_RE, "<secret>");
  s = s.replace(UUID_RE, "<id>");
  s = s.replace(LONG_HEX_RE, "<hex>");
  s = s.replace(ISO_TS_RE, "<ts>");
  s = s.replace(UNIX_TS_RE, "<ts>");
  s = s.replace(WIN_PATH_RE, "<path>");
  s = s.replace(UNIX_PATH_RE, (match, pathPart) =>
    match.replace(pathPart, "<path>"),
  );
  s = s.replace(EMAIL_RE, "<email>");
  s = s.replace(PID_RE, "pid=<id>");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Derive a mechanical artifact slug from an already-normalized signature.
 * @param {string} normalized
 * @returns {string}
 */
export function slugFromSignature(normalized) {
  let slug = String(normalized ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > 96) {
    slug = slug.slice(0, 96).replace(/-+$/g, "");
  }
  return slug || "failure";
}

/**
 * Normalize then slug in one step.
 * @param {string} raw
 * @returns {{ normalized: string, slug: string }}
 */
export function signatureIdentity(raw) {
  const normalized = normalizeSignature(raw);
  return { normalized, slug: slugFromSignature(normalized) };
}

/**
 * Choose the next free path when slug.md exists with a different signature.
 * @param {string} slug
 * @param {(candidate: string) => boolean} exists - true if path is taken by different signature
 * @returns {string} final slug including optional -2, -3, ...
 */
export function resolveSlugCollision(slug, exists) {
  if (!exists(slug)) return slug;
  let n = 2;
  while (exists(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}
