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
    `**${finding.prefix} (${review.seat}):** ${finding.summary}`,
    `- Impact: ${finding.impact}`,
    `- Required fix: ${finding.required_fix}`,
    `- Verification: ${finding.verification}`,
    `- Disposition: ${finding.disposition?.status} — ${finding.disposition?.rationale}; ${finding.disposition?.evidence}`,
  ].join("\n");
}

export function renderVisibleReview(metadata) {
  if (!isRecord(metadata)) return "";
  const overall =
    metadata.overall_verdict === "approved" ? "Approved" : "Changes requested";
  const reviews = Array.isArray(metadata.reviews) ? metadata.reviews : [];
  const verdictLines = reviews.map((review) => {
    const verdict = review.verdict === "approved" ? "Approved" : "Changes requested";
    return `- ${review.seat} — ${review.model} — ${verdict}`;
  });
  const findings = reviews.flatMap((review) =>
    Array.isArray(review.findings)
      ? review.findings.map((finding) => findingLines(review, finding))
      : [],
  );
  return [
    "### Independent model reviews — 3/3 complete",
    "",
    `**Target:** \`${metadata.head_sha}\``,
    "",
    `**Verdict:** \`${overall}\``,
    "",
    ...verdictLines,
    "",
    findings.length > 0 ? findings.join("\n\n") : "No blocking findings identified.",
  ].join("\n");
}

export function parseReviewComment(body) {
  if (!nonEmpty(body) || !body.includes(REVIEW_MARKER)) return null;
  const start = body.indexOf(REVIEW_OPEN);
  if (start < 0 || body.indexOf(REVIEW_OPEN, start + REVIEW_OPEN.length) >= 0) {
    return { error: "review comment must contain exactly one canonical metadata marker" };
  }
  const end = body.indexOf(REVIEW_CLOSE, start + REVIEW_OPEN.length);
  if (end < 0) return { error: "review metadata marker is not closed" };
  if (body.slice(end + REVIEW_CLOSE.length).trim().length > 0) {
    return { error: "review comment contains text after the metadata marker" };
  }
  try {
    return {
      metadata: JSON.parse(body.slice(start + REVIEW_OPEN.length, end)),
      visible: body.slice(0, start).trimEnd(),
    };
  } catch {
    return { error: "review metadata is not valid JSON" };
  }
}

export function renderHumanAuthorization(headSha) {
  const metadata = { schema: 1, head_sha: headSha, verdict: "approved" };
  return [
    "### Operator authorization",
    "",
    `**Target:** \`${headSha}\``,
    "",
    "**Verdict:** `Approved`",
    "",
    `<!-- ${AUTHORIZATION_MARKER}`,
    JSON.stringify(metadata),
    "-->",
  ].join("\n");
}

export function parseHumanAuthorization(body) {
  if (!nonEmpty(body) || !body.includes(AUTHORIZATION_MARKER)) return null;
  const open = `<!-- ${AUTHORIZATION_MARKER}\n`;
  const start = body.indexOf(open);
  const end = body.indexOf(REVIEW_CLOSE, start + open.length);
  if (start < 0 || end < 0 || body.slice(end + REVIEW_CLOSE.length).trim()) {
    return { error: "operator authorization marker is malformed" };
  }
  try {
    const metadata = JSON.parse(body.slice(start + open.length, end));
    if (
      !isRecord(metadata) ||
      Object.keys(metadata).sort().join(",") !== "head_sha,schema,verdict" ||
      metadata.schema !== 1 ||
      !exactSha(metadata.head_sha) ||
      metadata.verdict !== "approved" ||
      body !== renderHumanAuthorization(metadata.head_sha)
    ) {
      return { error: "operator authorization record is invalid" };
    }
    return { metadata };
  } catch {
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

function validateVisibleContract(visible, metadata) {
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
    /\b(?:I|we|our|ours|my|mine)\b/i.test(visible) ||
    /\bthe agent\b/i.test(visible) ||
    new RegExp(`\\b${privateName}\\b`, "i").test(visible) ||
    new RegExp(`\\b${privatePhrase}\\b`, "i").test(visible)
  ) {
    errors.push("visible review summary must use attribution-neutral, declarative language");
  }
  return errors;
}

function latestEffectiveHumanApproval(nativeApprovals, maintainers, headSha) {
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
      normalize(review.user?.type) === "bot" ||
      review.performed_via_github_app
    ) {
      continue;
    }
    if (review.state === "APPROVED") {
      byMaintainer.set(login, {
        approved: review.commit_id === headSha,
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
    ["reviewer", "head_sha", "verdict", "kind", "authorization_reference"],
    ["reviewer", "head_sha", "verdict", "kind", "authorization_reference"],
    "human_approval",
    reasons,
  );
  if (!validObject) return false;
  if (!nonEmpty(attestation.reviewer)) reasons.push("human_approval reviewer is required");
  if (!exactSha(attestation.head_sha)) reasons.push("human_approval head_sha must be exact");
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
    normalize(attestation.reviewer) === normalize(comment.author) &&
    attestation.head_sha === headSha &&
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
    new Date(authorization.created_at) > new Date(comment.created_at)
  ) {
    return false;
  }
  const parsedAuthorization = parseHumanAuthorization(authorization.body);
  return (
    !parsedAuthorization?.error &&
    parsedAuthorization?.metadata?.head_sha === headSha
  );
}

function deliveryEvaluation({
  parsed,
  comment,
  author,
  headSha,
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
  );
  const attestation = validHumanAttestation({
    metadata: parsed?.metadata,
    comment,
    author,
    headSha,
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
  author,
  changedFiles,
  filesComplete = true,
  config,
  repository,
  pullNumber,
  authorizationComments = [],
  nativeApprovals = [],
  priorFindingIds = [],
  expectedPreviousCommentId = null,
  historyErrors = [],
  allowChangesRequested = false,
}) {
  priorFindingIds = Array.isArray(priorFindingIds) ? priorFindingIds : [];
  historyErrors = Array.isArray(historyErrors) ? historyErrors : ["review history is malformed"];
  const delivery = classifyDelivery({ author, changedFiles, filesComplete, config });
  const parsed = parseReviewComment(comment?.body);
  const deliveryReasons = deliveryEvaluation({
    parsed,
    comment,
    author,
    headSha,
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
        "overall_verdict",
        "previous_comment_id",
        "reviews",
        "human_approval",
      ],
      ["schema", "head_sha", "overall_verdict", "previous_comment_id", "reviews"],
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
      if (reviews.length !== config.required_model_reviews) {
        modelReasons.push(`exactly ${config.required_model_reviews} model reviews are required`);
      }
      const seats = new Set();
      const models = new Set();
      const executionIds = new Set();
      const evidenceDigests = new Set();
      const findingIds = new Set();
      for (const review of reviews) {
        const reviewValid = validateKeys(
        review,
        ["seat", "model", "execution_id", "evidence_digest", "verdict", "findings"],
        ["seat", "model", "execution_id", "evidence_digest", "verdict", "findings"],
        "review",
        modelReasons,
      );
        if (!reviewValid) continue;
        if (!nonEmpty(review.seat)) modelReasons.push("every review requires a seat");
        if (!nonEmpty(review.model)) modelReasons.push("every review requires a model identity");
        if (!nonEmpty(review.execution_id)) modelReasons.push("every review requires an execution ID");
        if (!/^[0-9a-f]{64}$/.test(review.evidence_digest ?? "")) {
          modelReasons.push("every review requires a 64-hex evidence digest");
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
          if (!ALLOWED_FINDING_PREFIXES.has(finding.prefix)) {
            modelReasons.push(`${finding.id || "finding"} uses an unsupported finding prefix`);
          }
          for (const field of ["summary", "impact", "required_fix", "verification"]) {
            if (!nonEmpty(finding[field])) {
              modelReasons.push(`${finding.id || "finding"} needs ${field}`);
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
            !nonEmpty(finding.disposition?.rationale) ||
            !nonEmpty(finding.disposition?.evidence)
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
      modelReasons.push(...validateVisibleContract(parsed.visible, metadata));
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
        allowed.has(normalize(comment.author)) && comment.body?.includes(REVIEW_MARKER),
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
      !comment.body?.includes(REVIEW_MARKER)
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
    const validation = validateReviewRecord({
      comment: entry.comment,
      headSha: historicalTarget,
      author: entry.comment.author,
      changedFiles: [],
      filesComplete: true,
      config,
      repository,
      pullNumber,
      authorizationComments: comments,
      priorFindingIds: [...identifiers],
      expectedPreviousCommentId: precedingId,
      allowChangesRequested: true,
    });
    for (const reason of validation.modelReasons) {
      errors.push(`review history comment ${entry.comment.id}: ${reason}`);
    }
    if (isRecord(entry.parsed?.metadata) && Array.isArray(entry.parsed.metadata.reviews)) {
      for (const review of entry.parsed.metadata.reviews) {
        if (!isRecord(review) || !Array.isArray(review.findings)) continue;
        for (const finding of review.findings) {
          if (isRecord(finding) && nonEmpty(finding.id)) identifiers.add(finding.id);
        }
      }
    }
    precedingId = entry.comment.id;
  }
  return {
    priorFindingIds: [...identifiers].sort(),
    expectedPreviousCommentId: precedingId,
    historyErrors: errors,
  };
}

export function resolvePullRequestNumber(event) {
  const candidate =
    event.pull_request?.number ??
    (event.issue?.pull_request ? event.issue.number : null) ??
    event.review?.pull_request_url?.split("/").at(-1);
  const number = Number(candidate);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("event does not identify a pull request");
  }
  return number;
}

export function normalizeGitHubSnapshot({ pull, files, comments, reviews }) {
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
  return {
    pullNumber: pull.number,
    headSha: pull.head.sha,
    author: pull.user?.login,
    changedFiles,
    filesComplete:
      Number.isInteger(pull.changed_files) && fileList.length >= pull.changed_files,
    comments: (Array.isArray(comments) ? comments : []).filter(isRecord).map((item) => ({
      id: item.id,
      body: item.body,
      author: item.user?.login,
      author_type: item.user?.type,
      performed_via_github_app: item.performed_via_github_app,
      created_at: item.created_at,
      updated_at: item.updated_at,
    })),
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
  const contexts = ["model-review-gate", "delivery-policy"];
  const list = Array.isArray(statuses) ? statuses : [];
  const currentRunId = actionsRunId(runUrl);
  if (currentRunId === null) return false;
  const higherRun = list.some((status) => {
    if (!contexts.includes(status?.context)) return false;
    const id = actionsRunId(status?.target_url);
    return id !== null && id > currentRunId;
  });
  if (higherRun) return false;
  return contexts.every((context) => {
    const latest = list
      .filter((status) => status?.context === context)
      .sort((left, right) => {
        const time = new Date(right.created_at ?? 0) - new Date(left.created_at ?? 0);
        return time || Number(right.id ?? 0) - Number(left.id ?? 0);
      })[0];
    return (
      latest?.state === "pending" &&
      latest?.target_url === runUrl
    );
  });
}

export function actionsRunId(targetUrl) {
  const match = String(targetUrl ?? "").match(
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/(\d+)(?:\/.*)?$/,
  );
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

export function newestHigherRun(statuses, runUrl) {
  const current = actionsRunId(runUrl);
  if (current === null) return null;
  const candidates = (Array.isArray(statuses) ? statuses : [])
    .filter((status) =>
      ["model-review-gate", "delivery-policy"].includes(status?.context),
    )
    .map((status) => ({ status, runId: actionsRunId(status.target_url) }))
    .filter((item) => item.runId !== null && item.runId > current)
    .sort((left, right) => right.runId - left.runId);
  return candidates[0]?.status ?? null;
}

export async function runPolicyEvaluation({
  loadHead,
  loadSnapshot,
  publish,
  listStatuses,
  config,
  repository,
  runUrl,
}) {
  let originalHead = null;
  try {
    originalHead = await loadHead();
    if (!exactSha(originalHead)) {
      throw new Error("initial pull request HEAD is not an exact SHA");
    }
    const preflightStatuses = await listStatuses(originalHead);
    if (newestHigherRun(preflightStatuses, runUrl)) {
      return { outcome: "superseded", headSha: originalHead };
    }
    await publish(originalHead, "pending", undefined, runUrl);
    const postPendingStatuses = await listStatuses(originalHead);
    const higherAfterPending = newestHigherRun(postPendingStatuses, runUrl);
    if (higherAfterPending) {
      await publish(
        originalHead,
        "pending",
        undefined,
        higherAfterPending.target_url,
      );
      return { outcome: "superseded_after_pending", headSha: originalHead };
    }
    if (!currentRunOwnsStatuses(postPendingStatuses, runUrl)) {
      return { outcome: "superseded", headSha: originalHead };
    }

    const finalSnapshot = normalizeGitHubSnapshot(await loadSnapshot());
    if (finalSnapshot.headSha !== originalHead) {
      return { outcome: "head_drift", headSha: originalHead };
    }
    const result = evaluateSnapshot(finalSnapshot, config, repository);
    const statuses = await listStatuses(originalHead);
    if (!currentRunOwnsStatuses(statuses, runUrl)) {
      return { outcome: "superseded", headSha: originalHead };
    }
    await publish(originalHead, "terminal", result, runUrl);
    const postTerminalStatuses = await listStatuses(originalHead);
    const higherRun = newestHigherRun(postTerminalStatuses, runUrl);
    if (higherRun) {
      await publish(originalHead, "pending", undefined, higherRun.target_url);
      return { outcome: "superseded_after_terminal", headSha: originalHead };
    }
    return { outcome: result.ok ? "pass" : "fail", headSha: originalHead, result };
  } catch (error) {
    if (originalHead) {
      try {
        const statuses = await listStatuses(originalHead);
        if (currentRunOwnsStatuses(statuses, runUrl)) {
          await publish(originalHead, "terminal", {
            modelOk: false,
            deliveryOk: false,
            modelReasons: ["Policy evaluation did not complete"],
            deliveryReasons: ["Policy evaluation did not complete"],
          });
        }
      } catch {
        // The workflow failure remains visible when status publication is unavailable.
      }
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

export function auditBranches({ branches, openPullRequests, repository, branchPatterns }) {
  const covered = new Set(
    openPullRequests
      .filter((pull) => normalize(pull.head.repo?.full_name) === normalize(repository))
      .map((pull) => pull.head.ref),
  );
  return branches
    .filter((branch) => branch.name !== "main")
    .filter((branch) => matchesSensitivePath(branch.name, branchPatterns))
    .filter((branch) => !covered.has(branch.name))
    .map((branch) => branch.name);
}

export function evaluateRepositoryPolicy({ ruleset, settings, desired }) {
  const drifts = [];
  const pullRule = ruleset?.rules?.find((rule) => rule.type === "pull_request");
  const checksRule = ruleset?.rules?.find((rule) => rule.type === "required_status_checks");
  const pull = pullRule?.parameters ?? {};
  const checks = checksRule?.parameters ?? {};
  for (const key of ["name", "source_type", "source", "target"]) {
    if (ruleset?.[key] !== desired[key]) drifts.push(`ruleset ${key} differs`);
  }
  if (
    JSON.stringify(ruleset?.conditions?.ref_name ?? null) !==
    JSON.stringify(desired.conditions.ref_name)
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
  if (
    pull.required_review_thread_resolution !==
    desired.required_review_thread_resolution
  ) {
    drifts.push("review-thread resolution requirement differs");
  }
  for (const [key, value] of Object.entries(desired.repository_settings)) {
    if (settings?.[key] !== value) drifts.push(`repository setting ${key} differs`);
  }
  return drifts;
}
