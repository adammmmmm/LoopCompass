const PANEL_MARKER = "loopcompass-owner-panel:v1";
const APPROVAL_MARKER = "loopcompass-owner-approval:v1";

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const normalize = (value) => String(value ?? "").trim().toLowerCase();
const exactSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) =>
  isRecord(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

function parseMarkedJson(body, marker) {
  if (typeof body !== "string" || !body.includes(marker)) return null;
  const normalized = body.replace(/\r\n/g, "\n");
  const open = `<!-- ${marker}\n`;
  const start = normalized.indexOf(open);
  if (start < 0 || normalized.indexOf(open, start + open.length) >= 0) {
    return { error: "evidence must contain exactly one canonical marker" };
  }
  const end = normalized.indexOf("\n-->", start + open.length);
  if (end < 0 || !["", "\n"].includes(normalized.slice(end + 4))) {
    return { error: "evidence marker is malformed" };
  }
  try {
    return {
      metadata: JSON.parse(normalized.slice(start + open.length, end)),
      body: normalized,
    };
  } catch {
    return { error: "evidence metadata is not valid JSON" };
  }
}

function validReview(review) {
  return (
    exactKeys(review, ["seat", "model", "verdict"]) &&
    /^R[1-3]$/.test(review.seat) &&
    nonEmpty(review.model) &&
    ["approved", "changes_requested"].includes(review.verdict)
  );
}

export function renderOwnerPanel(headSha, reviews) {
  const metadata = { schema: 1, head_sha: headSha, reviews };
  return [
    "### Repository-owner panel",
    "",
    `**Target:** \`${headSha}\``,
    "",
    ...reviews.map(
      (review) =>
        `- ${review.seat} — ${review.model} — ${
          review.verdict === "approved" ? "Approved" : "Changes requested"
        }`,
    ),
    "",
    `<!-- ${PANEL_MARKER}`,
    JSON.stringify(metadata),
    "-->",
  ].join("\n");
}

export function parseOwnerPanel(body) {
  const parsed = parseMarkedJson(body, PANEL_MARKER);
  if (parsed === null || parsed.error) return parsed;
  const metadata = parsed.metadata;
  if (
    !exactKeys(metadata, ["schema", "head_sha", "reviews"]) ||
    metadata.schema !== 1 ||
    !exactSha(metadata.head_sha) ||
    !Array.isArray(metadata.reviews) ||
    metadata.reviews.length !== 3 ||
    !metadata.reviews.every(validReview)
  ) {
    return { error: "owner panel metadata is invalid" };
  }
  const seats = new Set(metadata.reviews.map((review) => review.seat));
  const models = new Set(metadata.reviews.map((review) => normalize(review.model)));
  if (seats.size !== 3 || models.size !== 3) {
    return { error: "owner panel requires three distinct seats and models" };
  }
  const canonical = renderOwnerPanel(metadata.head_sha, metadata.reviews);
  if (![canonical, `${canonical}\n`].includes(parsed.body)) {
    return { error: "owner panel comment is not canonical" };
  }
  return { metadata };
}

export function renderOwnerApproval(headSha) {
  const metadata = { schema: 1, head_sha: headSha, verdict: "approved" };
  return [
    "### Repository-owner approval",
    "",
    `**Target:** \`${headSha}\``,
    "",
    "**Verdict:** `Approved`",
    "",
    `<!-- ${APPROVAL_MARKER}`,
    JSON.stringify(metadata),
    "-->",
  ].join("\n");
}

export function parseOwnerApproval(body) {
  const parsed = parseMarkedJson(body, APPROVAL_MARKER);
  if (parsed === null || parsed.error) return parsed;
  const metadata = parsed.metadata;
  if (
    !exactKeys(metadata, ["schema", "head_sha", "verdict"]) ||
    metadata.schema !== 1 ||
    !exactSha(metadata.head_sha) ||
    metadata.verdict !== "approved"
  ) {
    return { error: "owner approval metadata is invalid" };
  }
  const canonical = renderOwnerApproval(metadata.head_sha);
  if (![canonical, `${canonical}\n`].includes(parsed.body)) {
    return { error: "owner approval comment is not canonical" };
  }
  return { metadata };
}

function trustedOwnerComment(comment, owner) {
  return (
    normalize(comment?.user?.login) === normalize(owner) &&
    normalize(comment?.user?.type) === "user" &&
    !comment?.performed_via_github_app
  );
}

export function evaluateReviewPolicy({ headSha, comments, owner }) {
  if (!exactSha(headSha) || !nonEmpty(owner) || !Array.isArray(comments)) {
    return {
      ok: false,
      route: null,
      panelValid: false,
      humanValid: false,
      reasons: ["review policy input is invalid"],
    };
  }

  let panelValid = false;
  let humanValid = false;
  let sawPanel = false;
  let sawHuman = false;
  let malformed = false;
  let wrongAuthor = false;

  for (const comment of comments) {
    const panel = parseOwnerPanel(comment?.body);
    const human = parseOwnerApproval(comment?.body);
    if (panel !== null) {
      sawPanel = true;
      if (!trustedOwnerComment(comment, owner)) wrongAuthor = true;
      else if (panel.error) malformed = true;
      else if (
        panel.metadata.head_sha === headSha &&
        panel.metadata.reviews.every((review) => review.verdict === "approved")
      ) {
        panelValid = true;
      }
    }
    if (human !== null) {
      sawHuman = true;
      if (!trustedOwnerComment(comment, owner)) wrongAuthor = true;
      else if (human.error) malformed = true;
      else if (human.metadata.head_sha === headSha) humanValid = true;
    }
  }

  const ok = panelValid || humanValid;
  const reasons = [];
  if (!ok) {
    if (wrongAuthor) reasons.push("review evidence must be authored by the configured owner");
    if (malformed) reasons.push("owner review evidence is malformed");
    if ((sawPanel || sawHuman) && !malformed) {
      reasons.push("owner review evidence does not approve the current HEAD");
    }
    if (reasons.length === 0) {
      reasons.push("current-HEAD owner panel or owner approval is required");
    }
  }
  return {
    ok,
    route: panelValid ? "panel" : humanValid ? "owner" : null,
    panelValid,
    humanValid,
    reasons,
  };
}

export function resolvePullRequestNumber(event) {
  const number =
    event?.pull_request?.number ??
    (event?.issue?.pull_request ? event.issue.number : undefined) ??
    event?.inputs?.pull_request_number;
  const parsed = Number(number);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("pull request number is unavailable");
  }
  return parsed;
}

export function buildStatusPayload({ state, result, targetUrl }) {
  if (!["pending", "success", "failure"].includes(state)) {
    throw new Error("unsupported review-policy status");
  }
  const description =
    state === "pending"
      ? "Evaluating current-HEAD owner review evidence"
      : state === "success"
        ? result?.route === "panel"
          ? "Current-HEAD owner panel approved"
          : "Current-HEAD owner approval found"
        : result?.reasons?.join("; ") || "Review policy failed";
  return {
    state,
    context: "review-policy",
    description: description.slice(0, 140),
    target_url: targetUrl,
  };
}

function globRegex(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if ("\\^$+?.()|{}[]".includes(character)) {
      source += `\\${character}`;
    } else {
      source += character;
    }
  }
  return new RegExp(`${source}$`, "i");
}

export function auditBranches({
  branches,
  openPullRequests,
  repository,
  defaultBranch = "main",
  exemptions = [],
}) {
  const covered = new Set(
    (Array.isArray(openPullRequests) ? openPullRequests : [])
      .filter(
        (pull) =>
          isRecord(pull?.head) &&
          normalize(pull.head.repo?.full_name) === normalize(repository) &&
          nonEmpty(pull.head.ref),
      )
      .map((pull) => pull.head.ref),
  );
  const exempt = (name) =>
    (Array.isArray(exemptions) ? exemptions : []).some((pattern) =>
      globRegex(pattern).test(name),
    );
  return (Array.isArray(branches) ? branches : [])
    .filter((branch) => isRecord(branch) && nonEmpty(branch.name))
    .filter((branch) => branch.name !== defaultBranch)
    .filter((branch) => !exempt(branch.name))
    .filter((branch) => !covered.has(branch.name))
    .map((branch) => branch.name);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function evaluateRepositoryPolicy({ ruleset, settings, desired }) {
  const drifts = [];
  const pull = ruleset?.rules?.find((rule) => rule.type === "pull_request")?.parameters;
  const checks = ruleset?.rules?.find(
    (rule) => rule.type === "required_status_checks",
  )?.parameters;
  if (!isRecord(pull)) drifts.push("pull request rule is unverifiable");
  if (!isRecord(checks)) drifts.push("required status checks are unverifiable");
  for (const key of ["name", "source_type", "source", "target"]) {
    if (ruleset?.[key] !== desired[key]) drifts.push(`ruleset ${key} differs`);
  }
  if (!sameJson(ruleset?.conditions, desired.conditions)) {
    drifts.push("ruleset branch target conditions differ");
  }
  if (ruleset?.enforcement !== "active") drifts.push("ruleset enforcement is not active");
  if (!Array.isArray(ruleset?.bypass_actors) || ruleset.bypass_actors.length !== 0) {
    drifts.push("ruleset bypass actors differ or are unverifiable");
  }
  if (
    checks?.strict_required_status_checks_policy !==
    desired.strict_required_status_checks
  ) {
    drifts.push("strict required status checks differ");
  }
  if (checks?.do_not_enforce_on_create !== desired.do_not_enforce_on_create) {
    drifts.push("status-check create enforcement differs");
  }
  const actualChecks = (checks?.required_status_checks ?? [])
    .map((item) => `${item.context}:${item.integration_id ?? ""}`)
    .sort();
  const desiredChecks = desired.required_status_checks
    .map((item) => `${item.context}:${item.integration_id}`)
    .sort();
  if (!sameJson(actualChecks, desiredChecks)) {
    drifts.push("required status checks or source IDs differ");
  }
  for (const key of [
    "allowed_merge_methods",
    "dismiss_stale_reviews_on_push",
    "require_code_owner_review",
    "require_last_push_approval",
    "required_approving_review_count",
    "required_review_thread_resolution",
    "required_reviewers",
  ]) {
    if (!sameJson(pull?.[key], desired[key])) {
      drifts.push(`pull request rule ${key} differs`);
    }
  }
  for (const [key, value] of Object.entries(desired.repository_settings)) {
    if (settings?.[key] !== value) drifts.push(`repository setting ${key} differs`);
  }
  return drifts;
}
