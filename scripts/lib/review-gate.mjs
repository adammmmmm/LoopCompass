const REVIEW_MARKER = "loopcompass-review:v1";
const REVIEW_OPEN = `<!-- ${REVIEW_MARKER}\n`;
const REVIEW_CLOSE = "\n-->";
const AUTHORIZATION_MARKER = "loopcompass-human-authorization:v1";

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
const exactSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validTimestamp = (value) =>
  nonEmpty(value) && Number.isFinite(new Date(value).getTime());
const normalizeLineEndings = (value) =>
  typeof value === "string" ? value.replace(/\r\n/g, "\n") : value;
const canonicalJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
};
const sameJson = (left, right) =>
  JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));

function parseUniqueJson(source) {
  let offset = 0;
  const whitespace = () => {
    while (/\s/.test(source[offset] ?? "")) offset += 1;
  };
  const string = () => {
    const start = offset;
    if (source[offset] !== '"') throw new Error("expected JSON string");
    offset += 1;
    while (offset < source.length) {
      if (source[offset] === "\\") {
        offset += 2;
      } else if (source[offset] === '"') {
        offset += 1;
        return JSON.parse(source.slice(start, offset));
      } else {
        offset += 1;
      }
    }
    throw new Error("unterminated JSON string");
  };
  const value = () => {
    whitespace();
    if (source[offset] === "{") {
      offset += 1;
      whitespace();
      const keys = new Set();
      if (source[offset] === "}") {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        const key = string();
        if (keys.has(key)) throw new Error("duplicate JSON object key");
        keys.add(key);
        whitespace();
        if (source[offset] !== ":") throw new Error("expected JSON colon");
        offset += 1;
        value();
        whitespace();
        if (source[offset] === "}") {
          offset += 1;
          return;
        }
        if (source[offset] !== ",") throw new Error("expected JSON object separator");
        offset += 1;
        whitespace();
      }
      throw new Error("unterminated JSON object");
    }
    if (source[offset] === "[") {
      offset += 1;
      whitespace();
      if (source[offset] === "]") {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        value();
        whitespace();
        if (source[offset] === "]") {
          offset += 1;
          return;
        }
        if (source[offset] !== ",") throw new Error("expected JSON array separator");
        offset += 1;
      }
      throw new Error("unterminated JSON array");
    }
    if (source[offset] === '"') {
      string();
      return;
    }
    const start = offset;
    while (offset < source.length && !/[\s,\]}]/.test(source[offset])) offset += 1;
    JSON.parse(source.slice(start, offset));
  };
  value();
  whitespace();
  if (offset !== source.length) throw new Error("unexpected JSON suffix");
  return JSON.parse(source);
}

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
  return new RegExp(`${source}$`, "i");
}

export function matchesSensitivePath(file, patterns) {
  return patterns.some((pattern) => globRegex(pattern).test(file));
}

export function classifyDelivery({ author, changedFiles, filesComplete = true, config }) {
  const trusted = config.trusted_contributors.map(normalize).includes(normalize(author));
  const sensitive =
    !filesComplete ||
    !Array.isArray(changedFiles) ||
    changedFiles.some((file) => matchesSensitivePath(file, config.sensitive_paths));
  return { trusted, sensitive, humanReviewRequired: !trusted || sensitive };
}

function findingLines(review, finding) {
  return [
    `**${finding.prefix} (${review.seat}):** ${escapeMarkdownScalar(finding.summary)}`,
    `- Impact: ${escapeMarkdownScalar(finding.impact)}`,
    `- Required fix: ${escapeMarkdownScalar(finding.required_fix)}`,
    `- Verification: ${escapeMarkdownScalar(finding.verification)}`,
    `- Disposition: ${finding.disposition?.status} — ${escapeMarkdownScalar(finding.disposition?.rationale)}; ${escapeMarkdownScalar(finding.disposition?.evidence)}`,
  ].join("\n");
}

export function renderVisibleReview(metadata) {
  if (!isRecord(metadata)) return "";
  const overall =
    metadata.overall_verdict === "approved" ? "Approved" : "Changes requested";
  const reviews = Array.isArray(metadata.reviews) ? metadata.reviews : [];
  const verdictLines = reviews.map((review) => {
    const verdict = review.verdict === "approved" ? "Approved" : "Changes requested";
    return `- ${review.seat} — ${escapeMarkdownScalar(review.model)} — ${verdict}`;
  });
  const findings = reviews.flatMap((review) =>
    Array.isArray(review.findings)
      ? review.findings.map((finding) => findingLines(review, finding))
      : [],
  );
  const humanApproval = isRecord(metadata.human_approval)
    ? [
        "",
        "**Human approval:** `Approved`",
        `- Reviewer: ${escapeMarkdownScalar(metadata.human_approval.reviewer)}`,
        `- Kind: ${escapeMarkdownScalar(metadata.human_approval.kind)}`,
        `- Authorization: ${escapeMarkdownScalar(metadata.human_approval.authorization_reference)}`,
      ]
    : [];
  return [
    "### Independent model reviews — 3/3 complete",
    "",
    `**Target:** \`${metadata.head_sha}\``,
    "",
    `**Generation:** \`${metadata.head_generation}\``,
    "",
    `**Verdict:** \`${overall}\``,
    "",
    ...verdictLines,
    "",
    findings.length > 0 ? findings.join("\n\n") : "No blocking findings identified.",
    ...humanApproval,
  ].join("\n");
}

export function buildBotReviewDecision(result, headSha, runUrl) {
  if (!exactSha(headSha)) throw new Error("bot review requires an exact HEAD SHA");
  const approved = result?.modelOk === true && result?.deliveryOk === true;
  const runId = actionsRunId(runUrl);
  const runEvidence = runId === null ? "" : ` Policy run ${runId}.`;
  return {
    commit_id: headSha,
    event: approved ? "APPROVE" : "REQUEST_CHANGES",
    body: approved
      ? `Delivery policy attestation for ${headSha}: approved.${runEvidence} Three independent model reviews and applicable delivery requirements are satisfied.`
      : `Delivery policy attestation for ${headSha}: changes requested.${runEvidence} Three independent model reviews or applicable delivery requirements are not satisfied.`,
  };
}

export function latestBotReviewMatches(reviews, decision) {
  const latest = (Array.isArray(reviews) ? reviews : [])
    .filter(isGitHubActionsReview)
    .sort(newestFirst)[0];
  const expectedState =
    decision?.event === "APPROVE" ? "APPROVED" : "CHANGES_REQUESTED";
  return (
    latest?.commit_id === decision?.commit_id &&
    latest?.state === expectedState &&
    latest?.body === decision?.body
  );
}

export function isGitHubActionsReview(review) {
  return (
    normalize(review?.user?.login) === "github-actions[bot]" ||
    normalize(review?.performed_via_github_app?.slug) === "github-actions"
  );
}

export function parseReviewComment(body) {
  const source = normalizeLineEndings(body);
  if (!nonEmpty(source) || !source.includes(REVIEW_MARKER)) return null;
  const start = source.indexOf(REVIEW_OPEN);
  if (start < 0 || source.indexOf(REVIEW_OPEN, start + REVIEW_OPEN.length) >= 0) {
    return { error: "review comment must contain exactly one canonical metadata marker" };
  }
  const end = source.indexOf(REVIEW_CLOSE, start + REVIEW_OPEN.length);
  if (end < 0) return { error: "review metadata marker is not closed" };
  if (!["", "\n"].includes(source.slice(end + REVIEW_CLOSE.length))) {
    return { error: "review comment contains text after the metadata marker" };
  }
  try {
    const metadataSource = source.slice(start + REVIEW_OPEN.length, end);
    return {
      metadata: parseUniqueJson(metadataSource),
      visible: source.slice(0, start).trimEnd(),
      body: source,
    };
  } catch (error) {
    if (error.message === "duplicate JSON object key") {
      return { error: "review metadata contains duplicate JSON object keys" };
    }
    return { error: "review metadata is not valid JSON" };
  }
}

function containsCanonicalReviewOpen(body) {
  const source = normalizeLineEndings(body);
  if (!nonEmpty(source)) return false;
  let fence = null;
  for (const line of source.split("\n")) {
    if (fence !== null) {
      const close = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (
        close &&
        close[1][0] === fence.marker &&
        close[1].length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (open) {
      if (open[1][0] === "`" && open[2].includes("`")) continue;
      fence = { marker: open[1][0], length: open[1].length };
      continue;
    }
    if (
      /^(?: {4}|\t)/.test(line) ||
      /^ {0,3}>/.test(line)
    ) {
      continue;
    }
    if (line === REVIEW_OPEN.trimEnd()) return true;
  }
  return false;
}

function safeMarkdownScalar(value) {
  return nonEmpty(value) && !/[\u0000-\u001f\u007f]/.test(value);
}

function escapeMarkdownScalar(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_[\]{}])/g, "\\$1");
}

export function renderHumanAuthorization(headSha, headGeneration = 1) {
  const metadata = {
    schema: 1,
    head_sha: headSha,
    head_generation: headGeneration,
    verdict: "approved",
  };
  return [
    "### Operator authorization",
    "",
    `**Target:** \`${headSha}\``,
    "",
    `**Generation:** \`${headGeneration}\``,
    "",
    "**Verdict:** `Approved`",
    "",
    `<!-- ${AUTHORIZATION_MARKER}`,
    JSON.stringify(metadata),
    "-->",
  ].join("\n");
}

export function parseHumanAuthorization(body) {
  const source = normalizeLineEndings(body);
  if (!nonEmpty(source) || !source.includes(AUTHORIZATION_MARKER)) return null;
  const open = `<!-- ${AUTHORIZATION_MARKER}\n`;
  const start = source.indexOf(open);
  if (start < 0 || source.indexOf(open, start + open.length) >= 0) {
    return {
      error: "operator authorization must contain exactly one canonical metadata marker",
    };
  }
  const end = source.indexOf(REVIEW_CLOSE, start + open.length);
  if (end < 0) {
    return { error: "operator authorization marker is malformed" };
  }
  try {
    const metadata = parseUniqueJson(source.slice(start + open.length, end));
    const canonical = renderHumanAuthorization(
      metadata?.head_sha,
      metadata?.head_generation,
    );
    const canonicalWithLineFeed = `${canonical}\n`;
    if (
      !isRecord(metadata) ||
      Object.keys(metadata).sort().join(",") !== "head_generation,head_sha,schema,verdict" ||
      metadata.schema !== 1 ||
      !exactSha(metadata.head_sha) ||
      !Number.isSafeInteger(metadata.head_generation) ||
      metadata.head_generation < 1 ||
      metadata.verdict !== "approved" ||
      ![canonical, canonicalWithLineFeed].includes(source)
    ) {
      return { error: "operator authorization record is invalid" };
    }
    return { metadata };
  } catch (error) {
    if (error.message === "duplicate JSON object key") {
      return { error: "operator authorization metadata contains duplicate JSON object keys" };
    }
    return { error: "operator authorization metadata is not valid JSON" };
  }
}

function validateKeys(value, allowed, required, label, reasons) {
  if (!isRecord(value)) {
    reasons.push(`${label} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) reasons.push(`${label} has unknown field ${key}`);
  }
  for (const key of required) {
    if (!(key in value)) reasons.push(`${label} is missing field ${key}`);
  }
  return true;
}

function validateVisibleContract(visible, metadata, rawBody) {
  const errors = [];
  let expected = "";
  try {
    expected = renderVisibleReview(metadata);
  } catch {
    errors.push("structured review record cannot be rendered");
  }
  if (visible !== expected) {
    errors.push("visible review summary must exactly match the structured review record");
  }
  const privateName = ["pa", "nel"].join("");
  const privatePhrase = ["private", "orchestration"].join("[\\s-]+");
  if (
    /\b(?:I|we|our|ours|my|mine)\b/i.test(rawBody) ||
    /\bthe agent\b/i.test(rawBody) ||
    new RegExp(`\\b${privateName}\\b`, "i").test(rawBody) ||
    new RegExp(`\\b${privatePhrase}\\b`, "i").test(rawBody)
  ) {
    errors.push("review evidence must use attribution-neutral, declarative language");
  }
  return errors;
}

function latestEffectiveHumanApproval(
  nativeApprovals,
  maintainers,
  headSha,
  author,
  generationCreatedAt,
) {
  const allowed = new Set(maintainers.map(normalize));
  const byMaintainer = new Map();
  const ordered = (Array.isArray(nativeApprovals) ? [...nativeApprovals] : []).sort((left, right) => {
    const time = new Date(left.submitted_at ?? 0) - new Date(right.submitted_at ?? 0);
    return time || Number(left.id ?? 0) - Number(right.id ?? 0);
  });
  for (const review of ordered) {
    const login = normalize(review.user?.login);
    if (
      !allowed.has(login) ||
      login === normalize(author) ||
      normalize(review.user?.type) === "bot" ||
      review.performed_via_github_app
    ) {
      continue;
    }
    if (review.state === "APPROVED") {
      byMaintainer.set(login, {
        approved:
          review.commit_id === headSha &&
          (!validTimestamp(generationCreatedAt) ||
            new Date(review.submitted_at) >= new Date(generationCreatedAt)),
        commit: review.commit_id,
      });
    } else if (["CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) {
      byMaintainer.set(login, { approved: false, commit: review.commit_id });
    }
  }
  return [...byMaintainer.values()].some((review) => review.approved);
}

function validateHumanApprovalStructure(
  attestation,
  { repository, pullNumber },
  reasons,
) {
  const validObject = validateKeys(
    attestation,
    ["reviewer", "head_sha", "head_generation", "verdict", "kind", "authorization_reference"],
    ["reviewer", "head_sha", "head_generation", "verdict", "kind", "authorization_reference"],
    "human_approval",
    reasons,
  );
  if (!validObject) return false;
  if (!nonEmpty(attestation.reviewer)) reasons.push("human_approval reviewer is required");
  if (!exactSha(attestation.head_sha)) reasons.push("human_approval head_sha must be exact");
  if (!Number.isSafeInteger(attestation.head_generation) || attestation.head_generation < 1) {
    reasons.push("human_approval head_generation must be a positive integer");
  }
  if (attestation.verdict !== "approved") {
    reasons.push("human_approval verdict must be approved");
  }
  if (!["operator_authorization", "maintainer_review"].includes(attestation.kind)) {
    reasons.push("human_approval kind is unsupported");
  }
  if (!nonEmpty(attestation.authorization_reference)) {
    reasons.push("human_approval authorization_reference is required");
  }
  const prefix =
    nonEmpty(repository) && Number.isInteger(pullNumber)
      ? `https://github.com/${repository}/pull/${pullNumber}`
      : "";
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const referencePattern =
    attestation.kind === "operator_authorization"
      ? new RegExp(`^${escapedPrefix}#issuecomment-\\d+$`, "i")
      : new RegExp(`^${escapedPrefix}(?:#issuecomment-\\d+)?$`, "i");
  if (!prefix || !referencePattern.test(attestation.authorization_reference)) {
    reasons.push("human_approval authorization_reference must target the current pull request");
  }
  return reasons.length === 0;
}

function validHumanAttestation({
  metadata,
  comment,
  author,
  headSha,
  headGeneration,
  maintainers,
  repository,
  pullNumber,
  authorizationComments,
}) {
  const attestation = metadata?.human_approval;
  if (!attestation) return false;
  const reasons = [];
  if (
    !validateHumanApprovalStructure(
      attestation,
      { repository, pullNumber },
      reasons,
    )
  ) {
    return false;
  }
  const commenterIsHuman =
    normalize(comment?.author_type) === "user" && !comment?.performed_via_github_app;
  const commenterIsMaintainer = maintainers.map(normalize).includes(normalize(comment?.author));
  const selfAuthored = normalize(comment?.author) === normalize(author);
  const expectedKind = selfAuthored ? "operator_authorization" : "maintainer_review";
  const baseValid =
    reasons.length === 0 &&
    commenterIsHuman &&
    commenterIsMaintainer &&
    validTimestamp(comment?.created_at) &&
    validTimestamp(comment?.updated_at) &&
    comment.created_at === comment.updated_at &&
    normalize(attestation.reviewer) === normalize(comment.author) &&
    attestation.head_sha === headSha &&
    attestation.head_generation === headGeneration &&
    attestation.verdict === "approved" &&
    attestation.kind === expectedKind;
  if (!baseValid) return false;
  if (attestation.kind === "maintainer_review") return true;

  const reference = attestation.authorization_reference.match(
    /#issuecomment-(\d+)$/,
  );
  if (!reference) return false;
  const referencedId = Number(reference[1]);
  const authorization = (Array.isArray(authorizationComments)
    ? authorizationComments
    : []
  ).find((item) => item?.id === referencedId);
  if (
    !authorization ||
    normalize(authorization.author) !== normalize(attestation.reviewer) ||
    !maintainers.map(normalize).includes(normalize(authorization.author)) ||
    normalize(authorization.author_type) !== "user" ||
    authorization.performed_via_github_app ||
    !validTimestamp(authorization.created_at) ||
    !validTimestamp(comment.created_at) ||
    authorization.created_at !== authorization.updated_at ||
    new Date(authorization.created_at) > new Date(comment.created_at) ||
    (authorization.created_at === comment.created_at &&
      (!Number.isSafeInteger(Number(authorization.id)) ||
        !Number.isSafeInteger(Number(comment.id)) ||
        Number(authorization.id) >= Number(comment.id)))
  ) {
    return false;
  }
  const parsedAuthorization = parseHumanAuthorization(authorization.body);
  return (
    !parsedAuthorization?.error &&
    parsedAuthorization?.metadata?.head_sha === headSha &&
    parsedAuthorization?.metadata?.head_generation === headGeneration
  );
}

function deliveryEvaluation({
  parsed,
  comment,
  author,
  headSha,
  headGeneration,
  generationCreatedAt,
  delivery,
  config,
  nativeApprovals,
  repository,
  pullNumber,
  authorizationComments,
}) {
  if (!delivery.humanReviewRequired) return [];
  const nativeApproval = latestEffectiveHumanApproval(
    nativeApprovals,
    config.human_maintainers,
    headSha,
    author,
    generationCreatedAt,
  );
  const attestation = validHumanAttestation({
    metadata: parsed?.metadata,
    comment,
    author,
    headSha,
    headGeneration,
    maintainers: config.human_maintainers,
    repository,
    pullNumber,
    authorizationComments,
  });
  return nativeApproval || attestation ? [] : ["current human maintainer review is required"];
}

export function validateReviewRecord({
  comment,
  headSha,
  headGeneration = 1,
  generationCreatedAt,
  author,
  changedFiles,
  filesComplete = true,
  config,
  repository,
  pullNumber,
  authorizationComments = [],
  nativeApprovals = [],
  priorFindingIds = [],
  priorFindings = [],
  priorExecutionIds = [],
  priorEvidenceDigests = [],
  expectedPreviousCommentId = null,
  historyErrors = [],
  allowChangesRequested = false,
}) {
  priorFindingIds = Array.isArray(priorFindingIds) ? priorFindingIds : [];
  priorFindings = Array.isArray(priorFindings) ? priorFindings : [];
  priorExecutionIds = Array.isArray(priorExecutionIds) ? priorExecutionIds : [];
  priorEvidenceDigests = Array.isArray(priorEvidenceDigests)
    ? priorEvidenceDigests
    : [];
  historyErrors = Array.isArray(historyErrors) ? historyErrors : ["review history is malformed"];
  const delivery = classifyDelivery({ author, changedFiles, filesComplete, config });
  const parsed = parseReviewComment(comment?.body);
  const deliveryReasons = deliveryEvaluation({
    parsed,
    comment,
    author,
    headSha,
    headGeneration,
    generationCreatedAt,
    delivery,
    config,
    nativeApprovals,
    repository,
    pullNumber,
    authorizationComments,
  });
  const modelReasons = [];
  if (!parsed) {
    modelReasons.push("missing structured review summary");
  } else if (parsed.error) {
    modelReasons.push(parsed.error);
  } else {
    const metadata = parsed.metadata;
    const metadataValid = validateKeys(
      metadata,
      [
        "schema",
        "head_sha",
        "head_generation",
        "overall_verdict",
        "previous_comment_id",
        "reviews",
        "human_approval",
      ],
      [
        "schema",
        "head_sha",
        "head_generation",
        "overall_verdict",
        "previous_comment_id",
        "reviews",
      ],
      "review metadata",
      modelReasons,
    );
    if (metadataValid) {
      if (!exactSha(headSha) || !exactSha(metadata.head_sha)) {
        modelReasons.push("current HEAD and review target must be exact 40-hex SHAs");
      }
      if (metadata.schema !== 1) modelReasons.push("review metadata schema must be 1");
      if (metadata.head_sha !== headSha) {
        modelReasons.push("review evidence does not target the current HEAD");
      }
      if (
        !Number.isSafeInteger(headGeneration) ||
        headGeneration < 1 ||
        metadata.head_generation !== headGeneration
      ) {
        modelReasons.push("review evidence does not target the current head generation");
      }
      if (
        validTimestamp(generationCreatedAt) &&
        (!validTimestamp(comment?.created_at) ||
          new Date(comment.created_at) < new Date(generationCreatedAt))
      ) {
        modelReasons.push("review evidence predates the current head generation");
      }
      if (!["approved", "changes_requested"].includes(metadata.overall_verdict)) {
        modelReasons.push("overall verdict must be approved or changes_requested");
      }
      if ("human_approval" in metadata) {
        validateHumanApprovalStructure(
          metadata.human_approval,
          { repository, pullNumber },
          modelReasons,
        );
      }
      if ((metadata.previous_comment_id ?? null) !== expectedPreviousCommentId) {
        modelReasons.push("review history must link to the preceding immutable review comment");
      }
      if (!validTimestamp(comment?.created_at) || !validTimestamp(comment?.updated_at)) {
        modelReasons.push(
          "review evidence requires created_at and updated_at timestamps with valid dates",
        );
      } else if (comment.created_at !== comment.updated_at) {
        modelReasons.push("review evidence comments are immutable; post a new reconciled comment");
      }
      const allowedCommenters = config.human_maintainers.map(normalize);
      if (
        !allowedCommenters.includes(normalize(comment.author)) ||
        normalize(comment.author_type) !== "user" ||
        comment.performed_via_github_app
      ) {
        modelReasons.push("review summary must be recorded by a configured human maintainer");
      }

      const reviews = Array.isArray(metadata.reviews) ? metadata.reviews : [];
      if (config.required_model_reviews !== 3) {
        modelReasons.push("delivery policy must require exactly three model reviews");
      }
      if (reviews.length !== 3) {
        modelReasons.push("exactly 3 model reviews are required");
      }
      const seats = new Set();
      const models = new Set();
      const executionIds = new Set();
      const evidenceDigests = new Set();
      const findingIds = new Set();
      const priorFindingById = new Map(
        priorFindings
          .filter((finding) => isRecord(finding) && nonEmpty(finding.id))
          .map((finding) => [finding.id, finding]),
      );
      for (const review of reviews) {
        const reviewValid = validateKeys(
        review,
        ["seat", "model", "execution_id", "evidence_digest", "verdict", "findings"],
        ["seat", "model", "execution_id", "evidence_digest", "verdict", "findings"],
        "review",
        modelReasons,
      );
        if (!reviewValid) continue;
        if (!/^R[1-9]\d*$/.test(review.seat ?? "")) {
          modelReasons.push("every review seat must use the public R<n> form");
        }
        if (!safeMarkdownScalar(review.model)) {
          modelReasons.push("every review requires a single-line model identity");
        }
        if (!nonEmpty(review.execution_id)) modelReasons.push("every review requires an execution ID");
        if (!/^[0-9a-f]{64}$/.test(review.evidence_digest ?? "")) {
          modelReasons.push("every review requires a 64-hex evidence digest");
        }
        if (priorExecutionIds.map(normalize).includes(normalize(review.execution_id))) {
          modelReasons.push("review execution IDs must not be reused from prior evidence");
        }
        if (
          priorEvidenceDigests
            .map(normalize)
            .includes(normalize(review.evidence_digest))
        ) {
          modelReasons.push("review evidence digests must not be reused from prior evidence");
        }
        for (const [value, set, message] of [
        [normalize(review.seat), seats, "review seats must be unique"],
        [normalize(review.model), models, "model identities must be independent"],
        [normalize(review.execution_id), executionIds, "review execution IDs must be unique"],
        [normalize(review.evidence_digest), evidenceDigests, "review evidence digests must be unique"],
        ]) {
          if (set.has(value)) modelReasons.push(message);
          set.add(value);
        }
        if (!["approved", "changes_requested"].includes(review.verdict)) {
          modelReasons.push(`${review.seat || "review"} has an unsupported verdict`);
        }
        if (!Array.isArray(review.findings)) {
          modelReasons.push(`${review.seat || "review"} findings must be an array`);
          continue;
        }
        for (const finding of review.findings) {
          const findingValid = validateKeys(
          finding,
          [
            "id",
            "prefix",
            "summary",
            "impact",
            "required_fix",
            "verification",
            "disposition",
          ],
          [
            "id",
            "prefix",
            "summary",
            "impact",
            "required_fix",
            "verification",
            "disposition",
          ],
          "finding",
          modelReasons,
        );
          if (!findingValid) continue;
          if (!nonEmpty(finding.id) || findingIds.has(finding.id)) {
            modelReasons.push("finding identifiers must be present and unique");
          }
          findingIds.add(finding.id);
          const priorFinding = priorFindingById.get(finding.id);
          const identityFields = [
            "id",
            "prefix",
            "summary",
            "impact",
            "required_fix",
            "verification",
          ];
          if (
            priorFinding &&
            !sameJson(
              Object.fromEntries(identityFields.map((field) => [field, finding[field]])),
              Object.fromEntries(identityFields.map((field) => [field, priorFinding[field]])),
            )
          ) {
            modelReasons.push(
              `prior material finding ${finding.id} changed immutable identity fields`,
            );
          }
          if (!ALLOWED_FINDING_PREFIXES.has(finding.prefix)) {
            modelReasons.push(`${finding.id || "finding"} uses an unsupported finding prefix`);
          }
          for (const field of ["summary", "impact", "required_fix", "verification"]) {
            if (!safeMarkdownScalar(finding[field])) {
              modelReasons.push(
                `${finding.id || "finding"} needs single-line ${field}`,
              );
            }
          }
          validateKeys(
            finding.disposition,
            ["status", "rationale", "evidence"],
            ["status", "rationale", "evidence"],
            "finding disposition",
            modelReasons,
          );
          if (
            !["fixed", "accepted", "not_applicable"].includes(finding.disposition?.status) ||
            !safeMarkdownScalar(finding.disposition?.rationale) ||
            !safeMarkdownScalar(finding.disposition?.evidence)
          ) {
            modelReasons.push(`${finding.id || "finding"} needs an evidence-backed disposition`);
          }
        }
      }
      const anyChangesRequested = reviews.some(
        (review) => review?.verdict === "changes_requested",
      );
      if (
        (anyChangesRequested && metadata.overall_verdict !== "changes_requested") ||
        (!anyChangesRequested && metadata.overall_verdict !== "approved")
      ) {
        modelReasons.push("overall verdict must truthfully summarize the per-seat verdicts");
      }
      if (!allowChangesRequested && metadata.overall_verdict !== "approved") {
        modelReasons.push("overall verdict must be approved");
      }
      for (const priorId of priorFindingIds) {
        if (!findingIds.has(priorId)) {
          modelReasons.push(
            `prior material finding ${priorId} is missing from the current disposition`,
          );
        }
      }
      modelReasons.push(
        ...validateVisibleContract(parsed.visible, metadata, parsed.body),
      );
    }
  }
  modelReasons.push(...historyErrors);

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

export function selectReviewComment(comments, maintainers = []) {
  const allowed = new Set(maintainers.map(normalize));
  return (Array.isArray(comments) ? comments : [])
    .filter(
      (comment) =>
        isRecord(comment) &&
        allowed.has(normalize(comment.author)) &&
        containsCanonicalReviewOpen(comment.body),
    )
    .sort((left, right) => {
      const time = new Date(right.created_at) - new Date(left.created_at);
      return time || Number(right.id ?? 0) - Number(left.id ?? 0);
    })[0] ?? null;
}

export function analyzeReviewHistory(
  comments,
  currentComment,
  config,
  repository,
  pullNumber,
) {
  const identifiers = new Set();
  const findingsById = new Map();
  const executionIds = new Set();
  const evidenceDigests = new Set();
  const allowed = new Set(config.human_maintainers.map(normalize));
  const prior = [];
  const errors = [];
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (comment === currentComment) continue;
    if (!isRecord(comment)) {
      errors.push("review history contains a malformed comment record");
      continue;
    }
    if (
      !allowed.has(normalize(comment.author)) ||
      !containsCanonicalReviewOpen(comment.body)
    ) {
      continue;
    }
    const parsed = parseReviewComment(comment.body);
    prior.push({ comment, parsed });
  }
  prior.sort(
    (left, right) => {
      const time =
        new Date(left.comment.created_at) - new Date(right.comment.created_at);
      return time || Number(left.comment.id ?? 0) - Number(right.comment.id ?? 0);
    },
  );
  let precedingId = null;
  for (const entry of prior) {
    const historicalTarget = isRecord(entry.parsed?.metadata)
      ? entry.parsed.metadata.head_sha
      : "";
    const historicalGeneration = isRecord(entry.parsed?.metadata)
      ? entry.parsed.metadata.head_generation
      : null;
    const validation = validateReviewRecord({
      comment: entry.comment,
      headSha: historicalTarget,
      headGeneration: historicalGeneration,
      author: entry.comment.author,
      changedFiles: [],
      filesComplete: true,
      config,
      repository,
      pullNumber,
      authorizationComments: comments,
      priorFindingIds: [...identifiers],
      priorFindings: [...findingsById.values()],
      priorExecutionIds: [...executionIds],
      priorEvidenceDigests: [...evidenceDigests],
      expectedPreviousCommentId: precedingId,
      allowChangesRequested: true,
    });
    for (const reason of validation.modelReasons) {
      errors.push(`review history comment ${entry.comment.id}: ${reason}`);
    }
    if (isRecord(entry.parsed?.metadata) && Array.isArray(entry.parsed.metadata.reviews)) {
      for (const review of entry.parsed.metadata.reviews) {
        if (!isRecord(review)) continue;
        if (nonEmpty(review.execution_id)) {
          executionIds.add(normalize(review.execution_id));
        }
        if (/^[0-9a-f]{64}$/.test(review.evidence_digest ?? "")) {
          evidenceDigests.add(normalize(review.evidence_digest));
        }
        if (Array.isArray(review.findings)) {
          for (const finding of review.findings) {
            if (isRecord(finding) && nonEmpty(finding.id)) {
              identifiers.add(finding.id);
              if (!findingsById.has(finding.id)) {
                findingsById.set(finding.id, structuredClone(finding));
              }
            }
          }
        }
      }
    }
    precedingId = entry.comment.id;
  }
  return {
    priorFindingIds: [...identifiers].sort(),
    priorFindings: [...findingsById.values()].sort((left, right) =>
      left.id.localeCompare(right.id)),
    priorExecutionIds: [...executionIds].sort(),
    priorEvidenceDigests: [...evidenceDigests].sort(),
    expectedPreviousCommentId: precedingId,
    historyErrors: errors,
  };
}

export function resolvePullRequestNumber(event) {
  const candidate =
    event.pull_request?.number ??
    (event.issue?.pull_request ? event.issue.number : null) ??
    event.review?.pull_request_url?.split("/").at(-1) ??
    event.inputs?.pull_request_number;
  const number = Number(candidate);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("event does not identify a pull request");
  }
  return number;
}

export function selectWorkflowHeadGeneration(runs, pullNumber) {
  const title = new RegExp(
    `^delivery-policy-(?:opened|synchronize)-pr-${pullNumber}-head-([0-9a-f]{40})$`,
    "i",
  );
  const valid = (Array.isArray(runs) ? runs : [])
    .map((run) => {
      const match = title.exec(run?.display_title ?? "");
      return { run, encodedHead: match?.[1]?.toLowerCase() ?? null };
    })
    .filter(
      ({ run, encodedHead }) =>
        Number.isSafeInteger(Number(run?.id)) &&
        Number(run.id) > 0 &&
        exactSha(encodedHead) &&
        validTimestamp(run.run_started_at ?? run.created_at),
    )
    .sort((left, right) => {
      const id = Number(right.run.id) - Number(left.run.id);
      return id || Number(right.run.run_attempt ?? 1) - Number(left.run.run_attempt ?? 1);
    });
  const byRunId = new Map();
  for (const item of valid) {
    if (!byRunId.has(Number(item.run.id))) {
      byRunId.set(Number(item.run.id), item);
    }
  }
  const selected = [...byRunId.values()][0];
  if (
    selected &&
    Array.isArray(selected.run.pull_requests) &&
    selected.run.pull_requests.length > 0 &&
    !selected.run.pull_requests.some(
      (pull) => Number(pull?.number) === pullNumber,
    )
  ) {
    return null;
  }
  return [...byRunId.values()]
    .map(({ run, encodedHead }) => ({
      id: Number(run.id),
      pullNumber,
      headSha: encodedHead,
      createdAt: run.run_started_at ?? run.created_at,
    }))[0] ?? null;
}

export async function resolveWorkflowHeadGenerationHistory({
  pullNumber,
  loadPage,
  currentCandidate = null,
}) {
  if (
    !Number.isInteger(pullNumber) ||
    pullNumber < 1 ||
    typeof loadPage !== "function"
  ) {
    throw new Error("workflow generation history requires a pull request and pager");
  }
  const candidates = [];
  for (let page = 1; ; page += 1) {
    const runs = await loadPage(page);
    if (!Array.isArray(runs)) {
      throw new Error("workflow generation history page must be an array");
    }
    candidates.push(...runs);
    if (runs.length < 100) break;
  }
  if (currentCandidate) candidates.push(currentCandidate);
  return selectWorkflowHeadGeneration(candidates, pullNumber);
}

export function currentWorkflowHeadGenerationCandidate(run, event, pullNumber) {
  const headSha = event?.pull_request?.head?.sha;
  if (
    !isRecord(run) ||
    !Number.isInteger(pullNumber) ||
    pullNumber < 1 ||
    !["opened", "synchronize"].includes(event?.action) ||
    !exactSha(headSha)
  ) {
    return null;
  }
  return {
    ...run,
    display_title:
      `delivery-policy-${event.action}-pr-${pullNumber}-head-${headSha}`,
    pull_requests: [{ number: pullNumber }],
  };
}

export function normalizeGitHubSnapshot({ pull, files, comments, reviews, generation }) {
  if (!isRecord(pull) || !isRecord(pull.head) || !exactSha(pull.head.sha)) {
    throw new Error("pull request payload is missing an exact HEAD SHA");
  }
  const fileList = Array.isArray(files) ? files : [];
  const changedFiles = [
    ...new Set(
      fileList.flatMap((file) =>
        isRecord(file)
          ? [file.filename, file.previous_filename].filter(nonEmpty)
          : [],
      ),
    ),
  ];
  const normalizedComments = (Array.isArray(comments) ? comments : [])
    .filter(isRecord)
    .map((item) => ({
      id: item.id,
      body: item.body,
      author: item.user?.login,
      author_type: item.user?.type,
      performed_via_github_app: item.performed_via_github_app,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
  const validGeneration =
    isRecord(generation) &&
    Number.isSafeInteger(generation.id) &&
    generation.id > 0 &&
    generation.pullNumber === pull.number &&
    generation.headSha === pull.head.sha &&
    validTimestamp(generation.createdAt);
  return {
    pullNumber: pull.number,
    headSha: pull.head.sha,
    author: pull.user?.login,
    changedFiles,
    filesComplete:
      Number.isInteger(pull.changed_files) && fileList.length >= pull.changed_files,
    headGeneration: validGeneration ? generation.id : null,
    generationCreatedAt: validGeneration ? generation.createdAt : null,
    comments: normalizedComments,
    reviews: (Array.isArray(reviews) ? reviews : []).filter(isRecord).map((item) => ({
      id: item.id,
      state: item.state,
      commit_id: item.commit_id,
      submitted_at: item.submitted_at,
      user: { login: item.user?.login, type: item.user?.type },
      performed_via_github_app: item.performed_via_github_app,
    })),
  };
}

export function evaluateSnapshot(snapshot, config, repository) {
  const comment = selectReviewComment(snapshot.comments, config.human_maintainers);
  const history = analyzeReviewHistory(
    snapshot.comments,
    comment,
    config,
    repository,
    snapshot.pullNumber,
  );
  return validateReviewRecord({
    comment,
    headSha: snapshot.headSha,
    headGeneration: snapshot.headGeneration,
    generationCreatedAt: snapshot.generationCreatedAt,
    author: snapshot.author,
    changedFiles: snapshot.changedFiles,
    filesComplete: snapshot.filesComplete,
    config,
    repository,
    pullNumber: snapshot.pullNumber,
    authorizationComments: snapshot.comments,
    nativeApprovals: snapshot.reviews,
    ...history,
  });
}

export function currentRunOwnsStatuses(statuses, runUrl) {
  const list = Array.isArray(statuses) ? statuses : [];
  const currentRunId = actionsRunId(runUrl);
  if (currentRunId === null) return false;
  if (statusHistoryTrustError(list, runUrl)) return false;
  if (newestHigherRun(list, runUrl)) return false;
  const current = latestRunStatuses(list, runUrl, currentRunId);
  return STATUS_CONTEXTS.every(
    (context) => current.find((status) => status.context === context)?.state === "pending",
  );
}

export function actionsRunId(targetUrl) {
  const match = String(targetUrl ?? "").match(
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/(\d+)(?:\/.*)?$/,
  );
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

const STATUS_CONTEXTS = ["model-review-gate", "delivery-policy"];

function sameRunRepository(left, right) {
  const repository = (value) =>
    String(value ?? "").match(
      /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/actions\/runs\/\d+(?:\/.*)?$/,
    )?.[1]?.toLowerCase() ?? null;
  const leftRepository = repository(left);
  return leftRepository !== null && leftRepository === repository(right);
}

function newestFirst(left, right) {
  const leftTime = new Date(left?.submitted_at ?? left?.created_at ?? "").getTime();
  const rightTime = new Date(right?.submitted_at ?? right?.created_at ?? "").getTime();
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  const leftId = Number(left?.id);
  const rightId = Number(right?.id);
  if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
    return rightId - leftId;
  }
  return 0;
}

function latestRunStatuses(statuses, runUrl, runId = actionsRunId(runUrl)) {
  if (runId === null) return [];
  const candidates = (Array.isArray(statuses) ? statuses : [])
    .filter((status) => STATUS_CONTEXTS.includes(status?.context))
    .filter((status) => sameRunRepository(status?.target_url, runUrl))
    .filter((status) => actionsRunId(status?.target_url) === runId)
    .sort(newestFirst);
  return STATUS_CONTEXTS.flatMap((context) => {
    const latest = candidates.find((status) => status.context === context);
    return latest ? [latest] : [];
  });
}

function latestPolicyStatuses(statuses) {
  const candidates = (Array.isArray(statuses) ? statuses : [])
    .filter((status) => STATUS_CONTEXTS.includes(status?.context))
    .sort(newestFirst);
  return STATUS_CONTEXTS.flatMap((context) => {
    const latest = candidates.find((status) => status.context === context);
    return latest ? [latest] : [];
  });
}

export function statusHistoryTrustError(statuses, runUrl) {
  if (actionsRunId(runUrl) === null) return "current Actions run URL is invalid";
  for (const status of Array.isArray(statuses) ? statuses : []) {
    if (!STATUS_CONTEXTS.includes(status?.context)) continue;
    if (
      actionsRunId(status?.target_url) === null ||
      !sameRunRepository(status?.target_url, runUrl)
    ) {
      return `${status.context} has a foreign or unparseable run URL`;
    }
  }
  return null;
}

export function lowerRunOverwriteStatuses(statuses, runUrl) {
  const currentRunId = actionsRunId(runUrl);
  if (
    currentRunId === null ||
    statusHistoryTrustError(statuses, runUrl) ||
    newestHigherRun(statuses, runUrl)
  ) {
    return [];
  }
  const currentStatuses = latestRunStatuses(statuses, runUrl, currentRunId);
  const latestByContext = latestPolicyStatuses(statuses);
  return currentStatuses.filter((current) => {
    const latest = latestByContext.find(
      (status) => status.context === current.context,
    );
    const latestRunId = actionsRunId(latest?.target_url);
    return latestRunId !== null && latestRunId < currentRunId;
  });
}

export function newestHigherRun(statuses, runUrl) {
  const current = actionsRunId(runUrl);
  if (current === null) return null;
  const candidates = (Array.isArray(statuses) ? statuses : [])
    .filter((status) => STATUS_CONTEXTS.includes(status?.context))
    .filter((status) => sameRunRepository(status?.target_url, runUrl))
    .map((status) => ({ status, runId: actionsRunId(status.target_url) }))
    .filter((item) => item.runId !== null && item.runId > current);
  if (candidates.length === 0) return null;
  const runId = Math.max(...candidates.map((item) => item.runId));
  const runStatuses = latestRunStatuses(statuses, runUrl, runId);
  return {
    runId,
    statuses: runStatuses,
  };
}

export function buildObservedStatusPayloads(statuses) {
  const latest = STATUS_CONTEXTS.flatMap((context) => {
    const match = (Array.isArray(statuses) ? statuses : [])
      .filter((status) => status?.context === context)
      .sort(newestFirst)[0];
    return match ? [match] : [];
  });
  return latest.map((status) => {
    if (!["error", "failure", "pending", "success"].includes(status.state)) {
      throw new Error(`cannot reassert unsupported ${status.context} state`);
    }
    const payload = {
      state: status.state,
      context: status.context,
      target_url: status.target_url,
    };
    if (nonEmpty(status.description)) {
      payload.description = status.description.slice(0, 140);
    }
    return payload;
  });
}

export async function loadStatusHistory({ repository, sha, pages }) {
  if (!nonEmpty(repository) || !exactSha(sha) || typeof pages !== "function") {
    throw new Error("status history loader requires repository, exact SHA, and pager");
  }
  const statuses = await pages(`/repos/${repository}/commits/${sha}/statuses`);
  if (!Array.isArray(statuses)) {
    throw new Error("commit status history response must be an array");
  }
  return statuses;
}

export function exclusivePullAssociationError({
  pullRequests,
  pullNumber,
  headSha,
}) {
  if (!Number.isInteger(pullNumber) || !exactSha(headSha)) {
    return "current pull request identity is invalid";
  }
  if (!Array.isArray(pullRequests)) {
    return "pull request association is unverifiable";
  }
  const openForHead = pullRequests.filter(
    (pull) =>
      normalize(pull?.state) === "open" &&
      pull?.head?.sha === headSha,
  );
  if (
    openForHead.length !== 1 ||
    Number(openForHead[0]?.number) !== pullNumber
  ) {
    return "commit must belong to exactly one open current pull request";
  }
  return null;
}

export async function runPolicyEvaluation({
  loadHead,
  loadSnapshot,
  loadAssociatedPullRequests,
  publish,
  publishReview,
  dismissReview,
  listStatuses,
  config,
  repository,
  pullNumber,
  runUrl,
}) {
  let originalHead = null;
  const policyFailure = (reason) => ({
    ok: false,
    modelOk: false,
    deliveryOk: false,
    modelReasons: [reason],
    deliveryReasons: [reason],
  });
  const recordReview = async (result) => {
    if (typeof publishReview !== "function") {
      throw new Error("pull request review publisher is required");
    }
    return publishReview(originalHead, result);
  };
  const dismissStaleReview = async (receipt, higherRun) => {
    if (!receipt?.id || typeof dismissReview !== "function") return;
    await dismissReview(receipt, higherRun);
  };
  const finishReviewSafely = async (result) => {
    const receipt = await recordReview(result);
    const afterReview = await listStatuses(originalHead);
    const higherAfterReview = newestHigherRun(afterReview, runUrl);
    if (higherAfterReview) {
      await dismissStaleReview(receipt, higherAfterReview);
      await publish(originalHead, "reassert", higherAfterReview.statuses);
      return "superseded_after_review";
    }
    const overwritten = lowerRunOverwriteStatuses(afterReview, runUrl);
    if (overwritten.length > 0) {
      await publish(originalHead, "reassert", overwritten);
    }
    return "reviewed";
  };
  const publishTerminalSafely = async (result) => {
    const before = await listStatuses(originalHead);
    const higherBefore = newestHigherRun(before, runUrl);
    if (higherBefore) {
      await publish(originalHead, "reassert", higherBefore.statuses);
      return "superseded";
    }
    await publish(originalHead, "terminal", result, runUrl);
    const after = await listStatuses(originalHead);
    const higherAfter = newestHigherRun(after, runUrl);
    if (higherAfter) {
      await publish(originalHead, "reassert", higherAfter.statuses);
      return "superseded_after_terminal";
    }
    const overwritten = lowerRunOverwriteStatuses(after, runUrl);
    if (overwritten.length > 0) {
      await publish(originalHead, "reassert", overwritten);
    }
    const reviewOutcome = await finishReviewSafely(result);
    if (reviewOutcome !== "reviewed") return reviewOutcome;
    return "terminal";
  };
  const failPolicy = async (reason) => {
    const result = policyFailure(reason);
    const outcome = await publishTerminalSafely(result);
    if (outcome !== "terminal") {
      return { outcome, headSha: originalHead };
    }
    return { outcome: "fail", headSha: originalHead, result };
  };
  const failUntrustedHistory = async (statuses) => {
    const reason = statusHistoryTrustError(statuses, runUrl);
    if (!reason) return null;
    return failPolicy(reason);
  };
  const failUntrustedAssociation = async () => {
    let reason;
    try {
      reason = exclusivePullAssociationError({
        pullRequests: await loadAssociatedPullRequests(originalHead),
        pullNumber,
        headSha: originalHead,
      });
    } catch {
      reason = "pull request association is unverifiable";
    }
    if (!reason) return null;
    return failPolicy(reason);
  };
  try {
    originalHead = await loadHead();
    if (!exactSha(originalHead)) {
      throw new Error("initial pull request HEAD is not an exact SHA");
    }
    // Fence stale green states before any association or status-history read.
    // A later check may reassert a newer run, but no preflight API latency may
    // leave an old terminal state visible after this run has validated HEAD.
    await publish(originalHead, "pending", undefined, runUrl);
    const initialAssociationFailure = await failUntrustedAssociation();
    if (initialAssociationFailure) return initialAssociationFailure;
    const preflightStatuses = await listStatuses(originalHead);
    const higherBeforePreflight = newestHigherRun(preflightStatuses, runUrl);
    if (higherBeforePreflight) {
      await publish(originalHead, "reassert", higherBeforePreflight.statuses);
      return { outcome: "superseded", headSha: originalHead };
    }
    const preflightFailure = await failUntrustedHistory(preflightStatuses);
    if (preflightFailure) return preflightFailure;
    const postPendingAssociationFailure = await failUntrustedAssociation();
    if (postPendingAssociationFailure) return postPendingAssociationFailure;
    const postPendingStatuses = await listStatuses(originalHead);
    const higherAfterPending = newestHigherRun(postPendingStatuses, runUrl);
    if (higherAfterPending) {
      await publish(originalHead, "reassert", higherAfterPending.statuses);
      return { outcome: "superseded_after_pending", headSha: originalHead };
    }
    const postPendingFailure = await failUntrustedHistory(postPendingStatuses);
    if (postPendingFailure) return postPendingFailure;
    if (!currentRunOwnsStatuses(postPendingStatuses, runUrl)) {
      return failPolicy("current run did not acquire both policy status contexts");
    }
    const overwrittenPending = lowerRunOverwriteStatuses(
      postPendingStatuses,
      runUrl,
    );
    if (overwrittenPending.length > 0) {
      await publish(originalHead, "reassert", overwrittenPending);
    }

    const finalSnapshot = normalizeGitHubSnapshot(await loadSnapshot());
    if (finalSnapshot.headSha !== originalHead) {
      return { outcome: "head_drift", headSha: originalHead };
    }
    if (finalSnapshot.pullNumber !== pullNumber) {
      return failPolicy("pull request snapshot identity changed");
    }
    const result = evaluateSnapshot(finalSnapshot, config, repository);
    const preTerminalAssociationFailure = await failUntrustedAssociation();
    if (preTerminalAssociationFailure) return preTerminalAssociationFailure;
    const statuses = await listStatuses(originalHead);
    const higherBeforeTerminal = newestHigherRun(statuses, runUrl);
    if (higherBeforeTerminal) {
      await publish(originalHead, "reassert", higherBeforeTerminal.statuses);
      return { outcome: "superseded", headSha: originalHead };
    }
    const preTerminalFailure = await failUntrustedHistory(statuses);
    if (preTerminalFailure) return preTerminalFailure;
    if (!currentRunOwnsStatuses(statuses, runUrl)) {
      return failPolicy("current run lost ownership of both policy status contexts");
    }
    let successReview = null;
    if (result.ok) {
      const immediatelyBeforeReview = await listStatuses(originalHead);
      const higherBeforeReview = newestHigherRun(
        immediatelyBeforeReview,
        runUrl,
      );
      if (higherBeforeReview) {
        await publish(originalHead, "reassert", higherBeforeReview.statuses);
        return { outcome: "superseded_before_review", headSha: originalHead };
      }
      if (!currentRunOwnsStatuses(immediatelyBeforeReview, runUrl)) {
        return failPolicy("current run lost ownership before review publication");
      }
      successReview = await recordReview(result);
      const afterReviewStatuses = await listStatuses(originalHead);
      const higherAfterReview = newestHigherRun(afterReviewStatuses, runUrl);
      if (higherAfterReview) {
        await dismissStaleReview(successReview, higherAfterReview);
        await publish(originalHead, "reassert", higherAfterReview.statuses);
        return { outcome: "superseded_after_review", headSha: originalHead };
      }
      if (!currentRunOwnsStatuses(afterReviewStatuses, runUrl)) {
        await dismissStaleReview(successReview, null);
        return failPolicy("current run lost ownership before terminal success");
      }
    }
    await publish(originalHead, "terminal", result, runUrl);
    const postTerminalAssociationFailure = await failUntrustedAssociation();
    if (postTerminalAssociationFailure) return postTerminalAssociationFailure;
    const postTerminalStatuses = await listStatuses(originalHead);
    const higherRun = newestHigherRun(postTerminalStatuses, runUrl);
    if (higherRun) {
      await dismissStaleReview(successReview, higherRun);
      await publish(originalHead, "reassert", higherRun.statuses);
      return { outcome: "superseded_after_terminal", headSha: originalHead };
    }
    const postTerminalFailure = await failUntrustedHistory(postTerminalStatuses);
    if (postTerminalFailure) return postTerminalFailure;
    const overwrittenTerminal = lowerRunOverwriteStatuses(
      postTerminalStatuses,
      runUrl,
    );
    if (overwrittenTerminal.length > 0) {
      await publish(originalHead, "reassert", overwrittenTerminal);
    }
    if (!result.ok) {
      const reviewOutcome = await finishReviewSafely(result);
      if (reviewOutcome !== "reviewed") {
        return { outcome: reviewOutcome, headSha: originalHead };
      }
    }
    return { outcome: result.ok ? "pass" : "fail", headSha: originalHead, result };
  } catch (error) {
    if (originalHead) {
      const result = policyFailure("Policy evaluation did not complete");
      try {
        await publishTerminalSafely(result);
      } catch {}
    }
    throw error;
  }
}

export function buildStatusPayloads({ state, result, targetUrl }) {
  const definitions = [
    {
      context: "model-review-gate",
      ok: result?.modelOk,
      reasons: result?.modelReasons ?? [],
      success: "Three independent model reviews satisfied",
      pending: "Evaluating independent model review evidence",
    },
    {
      context: "delivery-policy",
      ok: result?.deliveryOk,
      reasons: result?.deliveryReasons ?? [],
      success: "Conditional delivery policy satisfied",
      pending: "Evaluating conditional delivery policy",
    },
  ];
  return definitions.map((definition) => {
    const statusState = state === "pending" ? "pending" : definition.ok ? "success" : "failure";
    const description =
      state === "pending"
        ? definition.pending
        : definition.ok
          ? definition.success
          : definition.reasons.join("; ") || "Policy evaluation failed";
    return {
      state: statusState,
      context: definition.context,
      description: description.slice(0, 140),
      target_url: targetUrl,
    };
  });
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
          isRecord(pull) &&
          isRecord(pull.head) &&
          normalize(pull.head.repo?.full_name) === normalize(repository) &&
          nonEmpty(pull.head.ref),
      )
      .map((pull) => pull.head.ref),
  );
  const exempt = Array.isArray(exemptions) ? exemptions : [];
  return (Array.isArray(branches) ? branches : [])
    .filter((branch) => isRecord(branch) && nonEmpty(branch.name))
    .filter((branch) => branch.name !== defaultBranch)
    .filter((branch) => !matchesSensitivePath(branch.name, exempt))
    .filter((branch) => !covered.has(branch.name))
    .map((branch) => branch.name);
}

export function evaluateRepositoryPolicy({
  ruleset,
  settings,
  workflowPermissions,
  desired,
}) {
  const drifts = [];
  const pullRule = ruleset?.rules?.find((rule) => rule.type === "pull_request");
  const checksRule = ruleset?.rules?.find((rule) => rule.type === "required_status_checks");
  const pull = pullRule?.parameters ?? {};
  const checks = checksRule?.parameters ?? {};
  const requiredPullKeys = [
    "allowed_merge_methods",
    "dismiss_stale_reviews_on_push",
    "require_code_owner_review",
    "require_last_push_approval",
    "required_approving_review_count",
    "required_review_thread_resolution",
    "required_reviewers",
  ];
  const expectedCheckKeys = [
    "do_not_enforce_on_create",
    "required_status_checks",
    "strict_required_status_checks_policy",
  ];
  const missingPullKeys = requiredPullKeys.filter((key) => !(key in pull));
  if (missingPullKeys.length > 0) {
    drifts.push(
      `pull request rule is missing required parameters: ${missingPullKeys.sort().join(", ")}`,
    );
  }
  const missingCheckKeys = expectedCheckKeys.filter((key) => !(key in checks));
  if (missingCheckKeys.length > 0) {
    drifts.push(
      `status-check rule is missing required parameters: ${missingCheckKeys.sort().join(", ")}`,
    );
  }
  for (const key of ["name", "source_type", "source", "target"]) {
    if (ruleset?.[key] !== desired[key]) drifts.push(`ruleset ${key} differs`);
  }
  const normalizeRefName = (value) => {
    if (
      !isRecord(value) ||
      !Array.isArray(value.include) ||
      !Array.isArray(value.exclude) ||
      ![...value.include, ...value.exclude].every(nonEmpty)
    ) {
      return null;
    }
    return {
      exclude: [...value.exclude].sort(),
      include: [...value.include].sort(),
    };
  };
  const actualRefName = normalizeRefName(ruleset?.conditions?.ref_name);
  const desiredRefName = normalizeRefName(desired.conditions.ref_name);
  if (
    actualRefName === null ||
    desiredRefName === null ||
    JSON.stringify(actualRefName) !== JSON.stringify(desiredRefName)
  ) {
    drifts.push("ruleset branch target conditions differ");
  }
  if (ruleset?.enforcement !== "active") drifts.push("ruleset enforcement is not active");
  if (!Array.isArray(ruleset?.bypass_actors)) {
    drifts.push("ruleset bypass actors are unverifiable");
  } else if (ruleset.bypass_actors.length !== 0) {
    drifts.push("ruleset bypass actors differ");
  }
  if (checks.strict_required_status_checks_policy !== desired.strict_required_status_checks) {
    drifts.push("strict required status checks differ");
  }
  if (checks.do_not_enforce_on_create !== desired.do_not_enforce_on_create) {
    drifts.push("status-check create enforcement differs");
  }
  const actualChecks = (checks.required_status_checks ?? [])
    .map((item) => `${item.context}:${item.integration_id ?? ""}`)
    .sort();
  const desiredChecks = desired.required_status_checks
    .map((item) => `${item.context}:${item.integration_id}`)
    .sort();
  if (JSON.stringify(actualChecks) !== JSON.stringify(desiredChecks)) {
    drifts.push("required status checks or source IDs differ");
  }
  if (
    JSON.stringify([...(pull.allowed_merge_methods ?? [])].sort()) !==
    JSON.stringify([...desired.allowed_merge_methods].sort())
  ) {
    drifts.push("allowed merge methods differ");
  }
  for (const key of [
    "dismiss_stale_reviews_on_push",
    "require_code_owner_review",
    "require_last_push_approval",
    "required_approving_review_count",
    "required_review_thread_resolution",
  ]) {
    if (pull[key] !== desired[key]) {
      drifts.push(`pull request rule ${key} differs`);
    }
  }
  if (
    !sameJson(pull.required_reviewers, desired.required_reviewers)
  ) {
    drifts.push("required reviewers differ");
  }
  if (
    "dismissal_restriction" in pull &&
    !sameJson(pull.dismissal_restriction, desired.dismissal_restriction)
  ) {
    drifts.push("dismissal restrictions differ");
  }
  for (const [key, value] of Object.entries(desired.repository_settings)) {
    if (settings?.[key] !== value) drifts.push(`repository setting ${key} differs`);
  }
  const desiredWorkflowPermissions = isRecord(desired.actions_workflow_permissions)
    ? desired.actions_workflow_permissions
    : {};
  if (!isRecord(workflowPermissions)) {
    drifts.push("Actions workflow permissions are unverifiable");
  }
  for (const [key, value] of Object.entries(desiredWorkflowPermissions)) {
    if (workflowPermissions?.[key] !== value) {
      drifts.push(`Actions workflow permission ${key} differs`);
    }
  }
  return drifts;
}
