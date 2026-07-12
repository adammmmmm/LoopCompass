/**
 * Lightweight classification assists for unambiguous fixture cases.
 * Gray-area lanes stay human; this only fails hard contradictions.
 */

/**
 * @param {string} failure
 * @param {string} lane recovery | incident | external | none
 * @returns {string[]} contradiction errors (empty if ok)
 */
export function assertLaneNotContradicted(failure, lane) {
  const text = String(failure ?? "");
  const lower = text.toLowerCase();
  const errors = [];

  const isBypass =
    /\bchmod\s+777\b/i.test(text) ||
    /\bas workaround\b/i.test(lower) ||
    /\bbypass\b/i.test(lower);
  if (isBypass && lane === "recovery") {
    errors.push("bypass/workaround language cannot be lane=recovery");
  }

  const isExpectedNegative =
    /\bunit test asserts\b/i.test(lower) ||
    /\bas expected\b/i.test(lower) ||
    /\bexpected negative\b/i.test(lower);
  if (isExpectedNegative && lane !== "none") {
    errors.push("expected negative test outcomes must be lane=none");
  }

  const isCoincidence =
    /\bthen succeeded on third try\b/i.test(lower) ||
    (/\bno code or network change\b/i.test(lower) && /\bretry\b/i.test(lower));
  if (isCoincidence && (lane === "recovery" || lane === "incident")) {
    errors.push("unexplained retry success cannot be recovery or incident");
  }

  const isExternalRate =
    /\bhttp 429\b/i.test(lower) ||
    (/\bvendor documented limit\b/i.test(lower) && /\bno project-side fix\b/i.test(lower));
  if (isExternalRate && lane === "recovery") {
    errors.push("vendor rate limit without local fix should not be recovery");
  }

  return errors;
}

/**
 * Suggest a lane for hard cases only; returns null when judgment is required.
 * @param {string} failure
 * @returns {"recovery" | "incident" | "external" | "none" | null}
 */
export function assistClassify(failure) {
  const text = String(failure ?? "");
  const lower = text.toLowerCase();

  if (
    /\bchmod\s+777\b/i.test(text) ||
    /\bas workaround\b/i.test(lower) ||
    (/\bbypass\b/i.test(lower) && /\bworkaround\b/i.test(lower))
  ) {
    return "none";
  }
  if (
    /\bunit test asserts\b/i.test(lower) ||
    (/\breceived\b/i.test(lower) && /\bas expected\b/i.test(lower))
  ) {
    return "none";
  }
  if (
    /\bthen succeeded on third try\b/i.test(lower) &&
    /\bno code or network change\b/i.test(lower)
  ) {
    return "none";
  }
  if (
    /\bhttp 429\b/i.test(lower) &&
    /\bno project-side fix\b/i.test(lower)
  ) {
    return "external";
  }
  return null;
}
