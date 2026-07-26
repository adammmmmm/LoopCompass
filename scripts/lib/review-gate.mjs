const REVIEW_MARKER = "loopcompass-review:v1";

export const ALLOWED_FINDING_PREFIXES = new Set([
  "Bug identified",
  "Risk identified",
  "Verification gap",
  "Plan mismatch",
  "Edge case identified",
  "Required fix",
]);

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const normalize = (value) => String(value ?? "").trim().toLowerCase();

function globRegex(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (
      character === "*" &&
      pattern[index + 1] === "*" &&
      pattern[index + 2] === "/"
    ) {
      source += "(?:.*/)?";
      index += 2;
    } else if (character === "*" && pattern[index + 1] === "*") {
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
  return new RegExp(`${source}$`);
}

export function matchesSensitivePath(file, patterns) {
  return patterns.some((pattern) => globRegex(pattern).test(file));
}

export function classifyDelivery({ author, changedFiles, config }) {
  const trusted = config.trusted_contributors.map(normalize).includes(normalize(author));
  const sensitive = changedFiles.some((file) =>
    matchesSensitivePath(file, config.sensitive_paths),
  );
  return {
    trusted,
    sensitive,
    humanReviewRequired: !trusted || sensitive,
  };
}

export function parseReviewComment(body) {
  if (!nonEmpty(body)) return null;
  const escaped = REVIEW_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`<!--\\s*${escaped}\\s*\\n([\\s\\S]*?)\\n-->`));
  if (!match) return null;
  try {
    return { metadata: JSON.parse(match[1]), visible: body.slice(0, match.index).trim() };
  } catch {
    return { error: "review metadata is not valid JSON" };
  }
}

function validateVisibleContract(visible, metadata) {
  const errors = [];
  if (!visible.startsWith("### Independent model reviews — 3/3 complete")) {
    errors.push("visible review summary must use the canonical 3/3 heading");
  }
  if (!visible.includes(`**Target:** \`${metadata.head_sha}\``)) {
    errors.push("visible review summary must identify the target current SHA");
  }
  const visibleVerdict =
    metadata.overall_verdict === "approved" ? "Approved" : "Changes requested";
  if (!visible.includes(`**Verdict:** \`${visibleVerdict}\``)) {
    errors.push("visible review summary must state the structured verdict");
  }
  const privateName = ["pa", "nel"].join("");
  const privatePhrase = ["private", "orchestration"].join("[\\s-]+");
  if (
    /\b(?:I|we|our|ours|my|mine)\b/i.test(visible) ||
    /\bthe agent\b/i.test(visible) ||
    new RegExp(`\\b${privateName}\\b`, "i").test(visible) ||
    new RegExp(`\\b${privatePhrase}\\b`, "i").test(visible)
  ) {
    errors.push("visible review summary must use attribution-neutral, declarative language");
  }
  for (const review of metadata.reviews ?? []) {
    const verdict = review.verdict === "approved" ? "Approved" : "Changes requested";
    if (!visible.includes(`- ${review.seat} — ${review.model} — ${verdict}`)) {
      errors.push(`visible review summary is missing the ${review.seat} verdict`);
    }
    for (const finding of review.findings ?? []) {
      if (!visible.includes(`**${finding.prefix} (${review.seat}):** ${finding.summary}`)) {
        errors.push(`visible review summary is missing finding ${finding.id}`);
      }
    }
  }
  const findingCount = (metadata.reviews ?? []).reduce(
    (total, review) => total + (review.findings?.length ?? 0),
    0,
  );
  if (findingCount === 0 && !visible.includes("No blocking findings identified.")) {
    errors.push("a finding-free review summary must use the canonical no-blocker statement");
  }
  return errors;
}

export function validateReviewRecord({
  comment,
  headSha,
  author,
  changedFiles,
  config,
  nativeApprovals = [],
  priorFindingIds = [],
  expectedPreviousCommentId = null,
  historyErrors = [],
}) {
  const modelReasons = [];
  const deliveryReasons = [];
  const delivery = classifyDelivery({ author, changedFiles, config });
  const parsed = parseReviewComment(comment?.body);
  if (!parsed) {
    return {
      ok: false,
      modelOk: false,
      deliveryOk: false,
      modelReasons: ["missing structured review summary"],
      deliveryReasons: ["missing structured review summary"],
      reasons: ["missing structured review summary"],
      delivery,
    };
  }
  if (parsed.error) {
    return {
      ok: false,
      modelOk: false,
      deliveryOk: false,
      modelReasons: [parsed.error],
      deliveryReasons: [parsed.error],
      reasons: [parsed.error],
      delivery,
    };
  }
  const metadata = parsed.metadata;
  if (!/^[0-9a-f]{40}$/.test(headSha) || !/^[0-9a-f]{40}$/.test(metadata.head_sha ?? "")) {
    modelReasons.push("current HEAD and review target must be exact 40-hex SHAs");
  }
  if (metadata.schema !== 1) modelReasons.push("review metadata schema must be 1");
  if (metadata.head_sha !== headSha) {
    modelReasons.push("review evidence does not target the current HEAD");
  }
  if (!["approved", "changes_requested"].includes(metadata.overall_verdict)) {
    modelReasons.push("overall verdict must be approved or changes_requested");
  } else if (metadata.overall_verdict !== "approved") {
    modelReasons.push("overall verdict must be approved");
  }
  if ((metadata.previous_comment_id ?? null) !== expectedPreviousCommentId) {
    modelReasons.push("review history must link to the preceding immutable review comment");
  }
  if (
    nonEmpty(comment.created_at) &&
    nonEmpty(comment.updated_at) &&
    comment.created_at !== comment.updated_at
  ) {
    modelReasons.push("review evidence comments are immutable; post a new reconciled comment");
  }
  modelReasons.push(...historyErrors);

  const reviews = Array.isArray(metadata.reviews) ? metadata.reviews : [];
  if (reviews.length !== config.required_model_reviews) {
    modelReasons.push(`exactly ${config.required_model_reviews} model reviews are required`);
  }
  const seats = new Set();
  const models = new Set();
  const findingIds = new Set();
  for (const review of reviews) {
    if (!nonEmpty(review.seat)) modelReasons.push("every review requires a seat");
    if (!nonEmpty(review.model)) modelReasons.push("every review requires a model identity");
    if (seats.has(normalize(review.seat))) modelReasons.push("review seats must be unique");
    if (models.has(normalize(review.model))) {
      modelReasons.push("model identities must be independent");
    }
    seats.add(normalize(review.seat));
    models.add(normalize(review.model));
    if (!["approved", "changes_requested"].includes(review.verdict)) {
      modelReasons.push(`${review.seat || "review"} has an unsupported verdict`);
    } else if (review.verdict !== "approved") {
      modelReasons.push(`${review.seat || "review"} has not approved the current HEAD`);
    }
    if (!Array.isArray(review.findings)) {
      modelReasons.push(`${review.seat || "review"} findings must be an array`);
      continue;
    }
    for (const finding of review.findings) {
      if (!nonEmpty(finding.id) || findingIds.has(finding.id)) {
        modelReasons.push("finding identifiers must be present and unique");
      }
      findingIds.add(finding.id);
      if (!ALLOWED_FINDING_PREFIXES.has(finding.prefix)) {
        modelReasons.push(`${finding.id || "finding"} uses an unsupported finding prefix`);
      }
      for (const field of ["summary", "impact", "required_fix", "verification"]) {
        if (!nonEmpty(finding[field])) {
          modelReasons.push(`${finding.id || "finding"} needs ${field}`);
        }
      }
      const disposition = finding.disposition;
      if (
        !disposition ||
        !["fixed", "accepted", "not_applicable"].includes(disposition.status) ||
        !nonEmpty(disposition.rationale) ||
        !nonEmpty(disposition.evidence)
      ) {
        modelReasons.push(`${finding.id || "finding"} needs an evidence-backed disposition`);
      }
    }
  }
  for (const priorId of priorFindingIds) {
    if (!findingIds.has(priorId)) {
      modelReasons.push(`prior material finding ${priorId} is missing from the current disposition`);
    }
  }

  const allowedCommenters = config.human_maintainers.map(normalize);
  if (!allowedCommenters.includes(normalize(comment.author))) {
    deliveryReasons.push("review summary must be recorded by a configured maintainer");
  }

  if (delivery.humanReviewRequired) {
    const latestReviews = new Map();
    for (const review of nativeApprovals) {
      const login = normalize(review.user?.login);
      if (!allowedCommenters.includes(login)) continue;
      const timestamp = new Date(review.submitted_at ?? 0).getTime();
      const previous = latestReviews.get(login);
      if (!previous || timestamp >= previous.timestamp) {
        latestReviews.set(login, { review, timestamp });
      }
    }
    const nativeCurrentApproval = [...latestReviews.values()].some(
      ({ review }) => review.state === "APPROVED" && review.commit_id === headSha,
    );
    const attestation = metadata.human_approval;
    const currentAttestation =
      attestation?.verdict === "approved" &&
      attestation?.head_sha === headSha &&
      allowedCommenters.includes(normalize(attestation?.reviewer)) &&
      normalize(attestation?.reviewer) === normalize(comment.author);
    if (!nativeCurrentApproval && !currentAttestation) {
      deliveryReasons.push("current human maintainer review is required");
    }
  }

  modelReasons.push(...validateVisibleContract(parsed.visible, metadata));
  const uniqueModelReasons = [...new Set(modelReasons)];
  const uniqueDeliveryReasons = [...new Set(deliveryReasons)];
  const modelOk = uniqueModelReasons.length === 0;
  const deliveryOk = uniqueDeliveryReasons.length === 0;
  return {
    ok: modelOk && deliveryOk,
    modelOk,
    deliveryOk,
    modelReasons: uniqueModelReasons,
    deliveryReasons: uniqueDeliveryReasons,
    reasons: [...uniqueModelReasons, ...uniqueDeliveryReasons],
    delivery,
  };
}

export function selectCurrentReviewComment(comments, headSha, maintainers = []) {
  const allowed = new Set(maintainers.map(normalize));
  const candidates = comments
    .filter((comment) => allowed.has(normalize(comment.author)))
    .map((comment) => ({ comment, parsed: parseReviewComment(comment.body) }))
    .filter(({ parsed }) => parsed?.metadata?.head_sha === headSha)
    .sort((left, right) => new Date(right.comment.updated_at) - new Date(left.comment.updated_at));
  return candidates[0]?.comment ?? null;
}

export function analyzeReviewHistory(comments, currentComment, maintainers = []) {
  const identifiers = new Set();
  const allowed = new Set(maintainers.map(normalize));
  const prior = [];
  const errors = [];
  for (const comment of comments) {
    if (comment === currentComment) continue;
    if (!allowed.has(normalize(comment.author))) continue;
    const parsed = parseReviewComment(comment.body);
    if (!parsed?.metadata) continue;
    if (
      nonEmpty(comment.created_at) &&
      nonEmpty(comment.updated_at) &&
      comment.created_at !== comment.updated_at
    ) {
      errors.push(`review history comment ${comment.id} was edited`);
    }
    prior.push({ comment, metadata: parsed.metadata });
    for (const review of parsed.metadata.reviews ?? []) {
      for (const finding of review.findings ?? []) {
        if (nonEmpty(finding.id)) identifiers.add(finding.id);
      }
    }
  }
  prior.sort(
    (left, right) => new Date(left.comment.created_at) - new Date(right.comment.created_at),
  );
  let precedingId = null;
  for (const entry of prior) {
    if ((entry.metadata.previous_comment_id ?? null) !== precedingId) {
      errors.push(`review history comment ${entry.comment.id} has a broken predecessor link`);
    }
    precedingId = entry.comment.id;
  }
  return {
    priorFindingIds: [...identifiers].sort(),
    expectedPreviousCommentId: precedingId,
    historyErrors: errors,
  };
}

export function auditBranches({
  branches,
  openPullRequests,
  now,
  graceMinutes,
  branchPatterns = ["codex/**", "feature/**", "fix/**"],
}) {
  const covered = new Set(openPullRequests.map((pull) => pull.head.ref));
  const cutoff = new Date(now).getTime() - graceMinutes * 60_000;
  return branches
    .filter((branch) => branch.name !== "main")
    .filter((branch) => matchesSensitivePath(branch.name, branchPatterns))
    .filter((branch) => new Date(branch.commit.committed_at).getTime() <= cutoff)
    .filter((branch) => !covered.has(branch.name))
    .map((branch) => branch.name);
}
