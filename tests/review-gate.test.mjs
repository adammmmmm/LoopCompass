import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  analyzeReviewHistory,
  auditBranches,
  buildBotReviewDecision,
  buildObservedStatusPayloads,
  buildStatusPayloads,
  currentWorkflowHeadGenerationCandidate,
  classifyDelivery,
  evaluateRepositoryPolicy,
  evaluateSnapshot,
  matchesSensitivePath,
  loadStatusHistory,
  latestBotReviewMatches,
  normalizeGitHubSnapshot,
  parseHumanAuthorization,
  parseReviewComment,
  renderHumanAuthorization,
  renderVisibleReview,
  resolvePullRequestNumber,
  runPolicyEvaluation,
  selectWorkflowHeadGeneration,
  selectReviewComment,
  validateReviewRecord,
} from "../scripts/lib/review-gate.mjs";

const sha = "a".repeat(40);
const repository = "example/project";
const config = {
  trusted_contributors: ["maintainer"],
  human_maintainers: ["maintainer"],
  required_model_reviews: 3,
  sensitive_paths: [".github/workflows/**", "scripts/review-gate.mjs"],
};
const deliveryCases = JSON.parse(
  await readFile(new URL("../fixtures/review-gate/delivery-cases.json", import.meta.url), "utf8"),
);
const repositoryConfig = JSON.parse(
  await readFile(new URL("../.github/delivery-policy.json", import.meta.url), "utf8"),
);

function finding(overrides = {}) {
  return {
    id: "R1-F1",
    prefix: "Bug identified",
    summary: "A stale value could pass.",
    impact: "The gate could accept obsolete evidence.",
    required_fix: "Bind the record to the current SHA.",
    verification: "The stale-SHA fixture fails.",
    disposition: {
      status: "fixed",
      rationale: "The record now compares exact SHAs.",
      evidence: "tests/review-gate.test.mjs stale-SHA case",
    },
    ...overrides,
  };
}

function metadata(overrides = {}) {
  return {
    schema: 1,
    head_sha: sha,
    head_generation: 1,
    overall_verdict: "approved",
    previous_comment_id: null,
    reviews: [
      {
        seat: "R1",
        model: "provider-a/model-a",
        execution_id: "run-a",
        evidence_digest: "1".repeat(64),
        verdict: "approved",
        findings: [],
      },
      {
        seat: "R2",
        model: "provider-b/model-b",
        execution_id: "run-b",
        evidence_digest: "2".repeat(64),
        verdict: "approved",
        findings: [],
      },
      {
        seat: "R3",
        model: "provider-c/model-c",
        execution_id: "run-c",
        evidence_digest: "3".repeat(64),
        verdict: "approved",
        findings: [],
      },
    ],
    ...overrides,
  };
}

function freshReviewProvenance(data, offset) {
  data.reviews.forEach((review, index) => {
    const value = offset + index;
    review.execution_id = `run-${value}`;
    review.evidence_digest = (value % 16).toString(16).repeat(64);
  });
  return data;
}

function comment(data = metadata(), author = "maintainer") {
  return {
    id: 100,
    author,
    author_type: "User",
    performed_via_github_app: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    body: `${renderVisibleReview(data)}\n\n<!-- loopcompass-review:v1\n${JSON.stringify(data)}\n-->`,
  };
}

function rawComment(data, overrides = {}) {
  return {
    id: 100,
    author: "maintainer",
    author_type: "User",
    performed_via_github_app: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    body: `Invalid visible record\n\n<!-- loopcompass-review:v1\n${JSON.stringify(data)}\n-->`,
    ...overrides,
  };
}

function apiComment(value = comment(metadata())) {
  return {
    id: value.id,
    body: value.body,
    user: { login: value.author, type: value.author_type },
    performed_via_github_app: value.performed_via_github_app,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function authorizationComment({
  id = 50,
  headSha = sha,
  author = "maintainer",
  authorType = "User",
  app = null,
  createdAt = "2025-12-31T23:59:00Z",
  updatedAt = createdAt,
  headGeneration = 1,
} = {}) {
  return {
    id,
    body: renderHumanAuthorization(headSha, headGeneration),
    author,
    author_type: authorType,
    performed_via_github_app: app,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function rawSnapshot({
  headSha = sha,
  pullNumber = 1,
  author = "maintainer",
  files = [{ filename: "README.md" }],
  comments = [apiComment()],
  reviews = [],
  changedFiles = files.length,
  headGeneration = 1,
  generationCreatedAt = "2025-12-31T23:58:00Z",
} = {}) {
  return {
    pull: {
      number: pullNumber,
      head: { sha: headSha },
      user: { login: author },
      changed_files: changedFiles,
    },
    files,
    comments,
    reviews,
    generation: {
      id: headGeneration,
      pullNumber,
      headSha,
      createdAt: generationCreatedAt,
    },
  };
}

function evaluate({
  data = metadata(),
  author = "maintainer",
  changedFiles = ["README.md"],
  commentAuthor = "maintainer",
  reviewComment,
  nativeApprovals = [],
  authorizationComments = [],
  policy = config,
  headGeneration = 1,
  generationCreatedAt,
} = {}) {
  return validateReviewRecord({
    comment: reviewComment ?? comment(data, commentAuthor),
    headSha: sha,
    headGeneration,
    generationCreatedAt,
    author,
    changedFiles,
    config: policy,
    repository,
    pullNumber: 1,
    authorizationComments,
    nativeApprovals,
  });
}

test("trusted non-sensitive change passes with three independent current reviews", () => {
  assert.equal(evaluate().ok, true);
});

test("missing, duplicate, and non-independent reviews fail", () => {
  assert.equal(evaluate({ data: metadata({ reviews: metadata().reviews.slice(0, 2) }) }).ok, false);
  const duplicateSeat = metadata();
  duplicateSeat.reviews[2].seat = "R1";
  assert.match(evaluate({ data: duplicateSeat }).reasons.join(" "), /seats must be unique/);
  const duplicateModel = metadata();
  duplicateModel.reviews[2].model = duplicateModel.reviews[0].model;
  assert.match(evaluate({ data: duplicateModel }).reasons.join(" "), /model identities/);
  const invalidSeat = metadata();
  invalidSeat.reviews[2].seat = "review-three";
  assert.match(evaluate({ data: invalidSeat }).reasons.join(" "), /R<n>/);
  assert.match(
    evaluate({ data: metadata(), policy: { ...config, required_model_reviews: 2 } }).reasons.join(
      " ",
    ),
    /exactly three/,
  );
});

test("per-seat changes-requested verdict remains truthful and non-green", () => {
  const data = metadata({ overall_verdict: "changes_requested" });
  data.reviews[1].verdict = "changes_requested";
  const value = comment(data);
  value.body = value.body.replace("**Verdict:** `Approved`", "**Verdict:** `Changes requested`");
  const result = validateReviewRecord({
    comment: value,
    headSha: sha,
    author: "maintainer",
    changedFiles: ["README.md"],
    config,
  });
  assert.match(value.body, /R2 — provider-b\/model-b — Changes requested/);
  assert.equal(result.modelOk, false);
  assert.doesNotMatch(result.modelReasons.join(" "), /visible review summary is missing the R2 verdict/);
});

test("a later push invalidates stale review evidence", () => {
  const stale = metadata({ head_sha: "b".repeat(40) });
  const result = evaluate({ data: stale });
  assert.match(result.reasons.join(" "), /current HEAD/);
});

test("review targets must be exact 40-hex SHAs", () => {
  const invalid = metadata({ head_sha: "not-a-sha" });
  const result = validateReviewRecord({
    comment: comment(invalid),
    headSha: "not-a-sha",
    author: "maintainer",
    changedFiles: ["README.md"],
    config,
  });
  assert.match(result.modelReasons.join(" "), /exact 40-hex SHAs/);
});

test("unresolved material findings fail and evidence-backed dispositions pass", () => {
  const unresolved = metadata();
  unresolved.reviews[0].findings = [finding({ disposition: undefined })];
  assert.match(evaluate({ data: unresolved }).reasons.join(" "), /evidence-backed disposition/);
  const resolved = metadata();
  resolved.reviews[0].findings = [finding()];
  assert.equal(evaluate({ data: resolved }).ok, true);
});

test("external and sensitive changes require current human maintainer review", () => {
  for (const input of [
    { author: "external" },
    { changedFiles: [".github/workflows/verify.yml"] },
  ]) {
    assert.match(evaluate(input).reasons.join(" "), /human maintainer review/);
  }
  const selfAuthorized = metadata({
    human_approval: {
      reviewer: "maintainer",
      head_sha: sha,
      head_generation: 1,
      verdict: "approved",
      kind: "operator_authorization",
      authorization_reference: "https://github.com/example/project/pull/1#issuecomment-50",
    },
  });
  const maintainerReviewed = metadata({
    human_approval: {
      reviewer: "maintainer",
      head_sha: sha,
      head_generation: 1,
      verdict: "approved",
      kind: "maintainer_review",
      authorization_reference: "https://github.com/example/project/pull/1",
    },
  });
  assert.match(renderVisibleReview(maintainerReviewed), /\*\*Human approval:\*\*/);
  assert.match(renderVisibleReview(maintainerReviewed), /Reviewer: maintainer/);
  assert.match(
    renderVisibleReview(maintainerReviewed),
    /Authorization: https:\/\/github\.com\/example\/project\/pull\/1/,
  );
  assert.equal(evaluate({ data: maintainerReviewed, author: "external" }).ok, true);
  assert.equal(
    evaluate({
      data: selfAuthorized,
      changedFiles: [".github/workflows/verify.yml"],
      authorizationComments: [authorizationComment()],
    }).ok,
    true,
  );
});

test("delivery policy is independent of missing or malformed model evidence", () => {
  const trusted = validateReviewRecord({
    comment: null,
    headSha: sha,
    author: "maintainer",
    changedFiles: ["README.md"],
    config,
  });
  assert.equal(trusted.modelOk, false);
  assert.equal(trusted.deliveryOk, true);

  const nativeApproval = {
    id: 1,
    state: "APPROVED",
    commit_id: sha,
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer", type: "User" },
    performed_via_github_app: null,
  };
  const sensitive = validateReviewRecord({
    comment: { ...comment(metadata()), body: "<!-- loopcompass-review:v1\n{" },
    headSha: sha,
    author: "external",
    changedFiles: [".github/workflows/verify.yml"],
    config,
    nativeApprovals: [nativeApproval],
  });
  assert.equal(sensitive.modelOk, false);
  assert.equal(sensitive.deliveryOk, true);
});

test("deep malformed model payloads fail closed without throwing", () => {
  const valid = metadata();
  const cases = [
    null,
    7,
    [],
    { ...valid, reviews: null },
    { ...valid, reviews: [null, valid.reviews[1], valid.reviews[2]] },
    { ...valid, reviews: [7, valid.reviews[1], valid.reviews[2]] },
    {
      ...valid,
      reviews: [{ ...valid.reviews[0], findings: [null] }, ...valid.reviews.slice(1)],
    },
    {
      ...valid,
      reviews: [
        { ...valid.reviews[0], findings: [finding({ disposition: null })] },
        ...valid.reviews.slice(1),
      ],
    },
  ];
  for (const payload of cases) {
    let result;
    assert.doesNotThrow(() => {
      result = validateReviewRecord({
        comment: rawComment(payload),
        headSha: sha,
        author: "maintainer",
        changedFiles: ["README.md"],
        config,
        repository,
      });
    });
    assert.equal(result.modelOk, false);
    assert.equal(result.deliveryOk, true);
  }
  const normalized = normalizeGitHubSnapshot(
    rawSnapshot({ comments: [apiComment(rawComment(null))] }),
  );
  let driverResult;
  assert.doesNotThrow(() => {
    driverResult = evaluateSnapshot(normalized, config, repository);
  });
  assert.equal(driverResult.modelOk, false);
  assert.equal(driverResult.deliveryOk, true);
});

test("attestation authorization must reference the current repository", () => {
  const data = metadata({
    human_approval: {
      reviewer: "maintainer",
      head_sha: sha,
      head_generation: 1,
      verdict: "approved",
      kind: "operator_authorization",
      authorization_reference: "https://github.com/another/project/pull/1#issuecomment-50",
    },
  });
  assert.equal(
    evaluate({ data, changedFiles: [".github/workflows/verify.yml"] }).deliveryOk,
    false,
  );
});

test("operator authorization resolves to an immutable same-PR human comment", () => {
  const data = metadata({
    human_approval: {
      reviewer: "maintainer",
      head_sha: sha,
      head_generation: 1,
      verdict: "approved",
      kind: "operator_authorization",
      authorization_reference: "https://github.com/example/project/pull/1#issuecomment-50",
    },
  });
  const base = authorizationComment();
  assert.equal(
    evaluate({
      data,
      changedFiles: [".github/workflows/verify.yml"],
      authorizationComments: [base],
    }).deliveryOk,
    true,
  );
  const invalid = [
    [],
    [{ ...base, id: 51 }],
    [authorizationComment({ headSha: "b".repeat(40) })],
    [authorizationComment({ author: "other" })],
    [authorizationComment({ authorType: "Bot" })],
    [authorizationComment({ app: { id: 1 } })],
    [authorizationComment({ updatedAt: "2026-01-01T00:00:01Z" })],
    [authorizationComment({ createdAt: "2026-01-01T00:01:00Z" })],
  ];
  for (const authorizationComments of invalid) {
    assert.equal(
      evaluate({
        data,
        changedFiles: [".github/workflows/verify.yml"],
        authorizationComments,
      }).deliveryOk,
      false,
    );
  }
  for (const [authorizationCreated, reviewCreated] of [
    ["not-a-date", "2026-01-01T00:00:00Z"],
    ["2025-12-31T23:59:00Z", "not-a-date"],
  ]) {
    const authorization = authorizationComment({
      createdAt: authorizationCreated,
    });
    const review = comment(data);
    review.created_at = reviewCreated;
    review.updated_at = reviewCreated;
    const result = evaluate({
      data,
      changedFiles: [".github/workflows/verify.yml"],
      reviewComment: review,
      authorizationComments: [authorization],
    });
    assert.equal(result.deliveryOk, false);
  }
  const sameSecondEarlierId = authorizationComment({
    id: 50,
    createdAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(
    evaluate({
      data,
      changedFiles: [".github/workflows/verify.yml"],
      authorizationComments: [sameSecondEarlierId],
    }).deliveryOk,
    true,
  );
  const sameSecondLaterId = authorizationComment({
    id: 150,
    createdAt: "2026-01-01T00:00:00Z",
  });
  const laterIdData = structuredClone(data);
  laterIdData.human_approval.authorization_reference =
    "https://github.com/example/project/pull/1#issuecomment-150";
  assert.equal(
    evaluate({
      data: laterIdData,
      changedFiles: [".github/workflows/verify.yml"],
      authorizationComments: [sameSecondLaterId],
    }).deliveryOk,
    false,
  );
});

test("operator authorization allows one terminal line ending and rejects suffixes", () => {
  const canonical = renderHumanAuthorization(sha);
  const fullCrlf = canonical.replace(/\n/g, "\r\n");
  for (const body of [
    canonical,
    `${canonical}\n`,
    `${canonical}\r\n`,
    fullCrlf,
    `${fullCrlf}\r\n`,
  ]) {
    assert.equal(parseHumanAuthorization(body)?.metadata?.head_sha, sha);
  }
  for (const body of [`${canonical}\n\n`, `${canonical} suffix`]) {
    assert.match(parseHumanAuthorization(body)?.error ?? "", /invalid/);
  }
  const malformed = canonical.replace(
    "<!-- loopcompass-human-authorization:v1\n",
    "<!-- loopcompass-human-authorization:v1 ",
  );
  assert.match(parseHumanAuthorization(malformed)?.error ?? "", /exactly one canonical/);
});

test("canonical review comments accept full CRLF and reject extra suffix whitespace", () => {
  const value = comment(metadata());
  value.body = value.body.replace(/\n/g, "\r\n");
  assert.equal(
    validateReviewRecord({
      comment: value,
      headSha: sha,
      author: "maintainer",
      changedFiles: ["README.md"],
      config,
    }).modelOk,
    true,
  );
  value.body += "\r\n\r\n";
  assert.match(
    validateReviewRecord({
      comment: value,
      headSha: sha,
      author: "maintainer",
      changedFiles: ["README.md"],
      config,
    }).modelReasons.join(" "),
    /text after/,
  );
});

test("edited carrying review comments cannot satisfy human approval", () => {
  const data = metadata({
    human_approval: {
      reviewer: "maintainer",
      head_sha: sha,
      head_generation: 1,
      verdict: "approved",
      kind: "maintainer_review",
      authorization_reference: "https://github.com/example/project/pull/1",
    },
  });
  const current = comment(data);
  assert.equal(
    evaluate({
      data,
      author: "external",
      changedFiles: ["README.md"],
      reviewComment: current,
    }).deliveryOk,
    true,
  );
  const edited = { ...current, updated_at: "2026-01-01T00:01:00Z" };
  assert.equal(
    evaluate({
      data,
      author: "external",
      changedFiles: ["README.md"],
      reviewComment: edited,
    }).deliveryOk,
    false,
  );
});

test("human_approval is structurally validated even when delivery review is not required", () => {
  const data = metadata({
    human_approval: {
      reviewer: 7,
      head_sha: "not-a-sha",
      head_generation: 0,
      verdict: "maybe",
      kind: "unknown",
      authorization_reference: 9,
    },
  });
  const result = evaluate({ data });
  assert.equal(result.deliveryOk, true);
  assert.equal(result.modelOk, false);
  assert.match(result.modelReasons.join(" "), /human_approval/);
});

test("native human approval must target the current SHA", () => {
  const changedFiles = [".github/workflows/verify.yml"];
  const stale = [{
    state: "APPROVED",
    commit_id: "b".repeat(40),
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer", type: "User" },
    performed_via_github_app: null,
  }];
  assert.equal(
    evaluate({ author: "external", changedFiles, nativeApprovals: stale }).ok,
    false,
  );
  const current = [{
    state: "APPROVED",
    commit_id: sha,
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer", type: "User" },
    performed_via_github_app: null,
  }];
  assert.equal(
    evaluate({ author: "external", changedFiles, nativeApprovals: current }).ok,
    true,
  );
  assert.equal(evaluate({ changedFiles, nativeApprovals: current }).deliveryOk, false);
});

test("latest maintainer review invalidates an earlier approval", () => {
  const changedFiles = [".github/workflows/verify.yml"];
  const approval = {
    state: "APPROVED",
    commit_id: sha,
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer", type: "User" },
    performed_via_github_app: null,
  };
  for (const state of ["CHANGES_REQUESTED", "DISMISSED"]) {
    const later = {
      state,
      commit_id: sha,
      submitted_at: "2026-01-01T00:01:00Z",
      user: { login: "maintainer", type: "User" },
      performed_via_github_app: null,
    };
    assert.equal(
      evaluate({
        author: "external",
        changedFiles,
        nativeApprovals: [approval, later],
      }).ok,
      false,
    );
  }
});

test("a later COMMENTED review preserves the latest current approval", () => {
  const approval = {
    id: 1,
    state: "APPROVED",
    commit_id: sha,
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer", type: "User" },
    performed_via_github_app: null,
  };
  const commented = {
    ...approval,
    id: 2,
    state: "COMMENTED",
    submitted_at: "2026-01-01T00:01:00Z",
  };
  assert.equal(
    evaluate({
      author: "external",
      changedFiles: [".github/workflows/verify.yml"],
      nativeApprovals: [approval, commented],
    }).deliveryOk,
    true,
  );
});

test("Bot and App records cannot satisfy human review", () => {
  const base = {
    id: 1,
    state: "APPROVED",
    commit_id: sha,
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer", type: "User" },
    performed_via_github_app: null,
  };
  for (const review of [
    { ...base, user: { login: "maintainer", type: "Bot" } },
    { ...base, performed_via_github_app: { id: 1 } },
  ]) {
    assert.equal(
      evaluate({
        changedFiles: [".github/workflows/verify.yml"],
        nativeApprovals: [review],
      }).deliveryOk,
      false,
    );
  }
  const data = metadata({
    human_approval: {
      reviewer: "maintainer",
      head_sha: sha,
      head_generation: 1,
      verdict: "approved",
      kind: "operator_authorization",
      authorization_reference: "https://github.com/example/project/pull/1#issuecomment-50",
    },
  });
  const botComment = comment(data);
  botComment.author_type = "Bot";
  assert.equal(
    validateReviewRecord({
      comment: botComment,
      headSha: sha,
      author: "maintainer",
      changedFiles: [".github/workflows/verify.yml"],
      config,
      repository,
    }).deliveryOk,
    false,
  );
});

test("prior material findings must remain in the current reconciled disposition", () => {
  const result = validateReviewRecord({
    comment: comment(metadata()),
    headSha: sha,
    author: "maintainer",
    changedFiles: ["README.md"],
    config,
    priorFindingIds: ["R1-OLD"],
  });
  assert.match(result.modelReasons.join(" "), /prior material finding R1-OLD/);
});

test("review summary must be maintainer-authored and attribution-neutral", () => {
  assert.match(
    evaluate({ commentAuthor: "external" }).reasons.join(" "),
    /configured human maintainer/,
  );
  const forbidden = [
    "I found no blockers.",
    "We found no blockers.",
    `${["pa", "nel"].join("")} found no blockers.`,
    `/${["pa", "nel"].join("")} found no blockers.`,
    `${["private", "orchestration"].join(" ")} found no blockers.`,
    "the agent found no blockers.",
  ];
  for (const phrase of forbidden) {
    const value = comment(metadata());
    value.body = value.body.replace("No blocking findings identified.", phrase);
    const result = validateReviewRecord({
      comment: value,
      headSha: sha,
      author: "maintainer",
      changedFiles: ["README.md"],
      config,
    });
    assert.match(result.modelReasons.join(" "), /attribution-neutral/, phrase);
  }
  const privateName = ["pa", "nel"].join("");
  const hiddenExecution = metadata();
  hiddenExecution.reviews[0].execution_id = `run-${privateName}`;
  assert.match(
    evaluate({ data: hiddenExecution }).modelReasons.join(" "),
    /attribution-neutral/,
  );
  const hiddenFindingId = metadata();
  hiddenFindingId.reviews[0].findings = [
    finding({ id: `R1-${privateName}` }),
  ];
  assert.match(
    evaluate({ data: hiddenFindingId }).modelReasons.join(" "),
    /attribution-neutral/,
  );
});

test("visible review body rejects omitted finding lines, contradictions, and trailing prose", () => {
  const data = metadata();
  data.reviews[0].findings = [finding()];
  const canonical = comment(data);
  for (const mutate of [
    (body) => body.replace("- Impact: The gate could accept obsolete evidence.\n", ""),
    (body) => body.replace(
      "- Verification: The stale-SHA fixture fails.",
      "- Verification: An unrelated check passes.",
    ),
    (body) => body.replace("\n\n<!-- loopcompass", "\n\nExtra conclusion.\n\n<!-- loopcompass"),
    (body) => `${body}\nExtra trailing prose.`,
  ]) {
    const value = { ...canonical, body: mutate(canonical.body) };
    assert.equal(
      validateReviewRecord({
        comment: value,
        headSha: sha,
        author: "maintainer",
        changedFiles: ["README.md"],
        config,
      }).modelOk,
      false,
    );
  }
});

test("review schema rejects unknown fields and weak or duplicate provenance", () => {
  const unknown = metadata({ unexpected: true });
  assert.match(evaluate({ data: unknown }).modelReasons.join(" "), /unknown field unexpected/);
  const weak = metadata();
  weak.reviews[0].evidence_digest = "short";
  assert.match(evaluate({ data: weak }).modelReasons.join(" "), /64-hex evidence digest/);
  const duplicate = metadata();
  duplicate.reviews[2].execution_id = duplicate.reviews[0].execution_id;
  duplicate.reviews[2].evidence_digest = duplicate.reviews[0].evidence_digest;
  assert.match(evaluate({ data: duplicate }).modelReasons.join(" "), /execution IDs must be unique/);
  assert.match(evaluate({ data: duplicate }).modelReasons.join(" "), /digests must be unique/);
});

test("review metadata rejects duplicate JSON keys at every nesting level", () => {
  const body = (json) => `Visible\n\n<!-- loopcompass-review:v1\n${json}\n-->`;
  const otherSha = "b".repeat(40);
  for (const json of [
    `{"head_sha":"${sha}","head_sha":"${otherSha}"}`,
    `{"head_sha":"${otherSha}","head_sha":"${sha}"}`,
    `{"reviews":[{"verdict":"approved","verdict":"changes_requested"}]}`,
    `{"reviews":[{"verdict":"changes_requested","verdict":"approved"}]}`,
  ]) {
    assert.equal(
      parseReviewComment(body(json)).error,
      "review metadata contains duplicate JSON object keys",
    );
  }
});

test("operator authorization rejects duplicate JSON keys", () => {
  const body = [
    "### Operator authorization",
    "",
    `**Target:** \`${sha}\``,
    "",
    "**Verdict:** `Approved`",
    "",
    "<!-- loopcompass-human-authorization:v1",
    `{"schema":1,"head_sha":"${sha}","verdict":"approved","verdict":"changes_requested"}`,
    "-->",
  ].join("\n");
  assert.equal(
    parseHumanAuthorization(body).error,
    "operator authorization metadata contains duplicate JSON object keys",
  );
});

test("visible Target and Verdict fields use the canonical bold format", () => {
  for (const [from, to] of [
    [`**Target:** \`${sha}\``, `Target: \`${sha}\``],
    ["**Verdict:** `Approved`", "Verdict: Approved"],
  ]) {
    const value = comment(metadata());
    value.body = value.body.replace(from, to);
    assert.equal(
      validateReviewRecord({
        comment: value,
        headSha: sha,
        author: "maintainer",
        changedFiles: ["README.md"],
        config,
      }).modelOk,
      false,
    );
  }
});

test("material findings persist across review comment revisions", () => {
  const oldData = metadata({ head_sha: "b".repeat(40) });
  oldData.reviews[0].findings = [finding({ id: "R1-OLD" })];
  const currentData = freshReviewProvenance(metadata(), 4);
  const prior = { ...comment(oldData), id: 99 };
  const current = comment(currentData);
  currentData.previous_comment_id = 99;
  const history = analyzeReviewHistory(
    [prior, current],
    current,
    config,
    repository,
  );
  assert.deepEqual(history.priorFindingIds, ["R1-OLD"]);
  const missing = validateReviewRecord({
    comment: comment(currentData),
    headSha: sha,
    author: "maintainer",
    changedFiles: ["README.md"],
    config,
    ...history,
  });
  assert.match(missing.modelReasons.join(" "), /R1-OLD/);
  currentData.reviews[0].findings = [finding({ id: "R1-OLD" })];
  assert.equal(
    validateReviewRecord({
      comment: comment(currentData),
      headSha: sha,
      author: "maintainer",
      changedFiles: ["README.md"],
      config,
      ...history,
    }).modelOk,
    true,
  );

  const changedIdentity = freshReviewProvenance(metadata(), 7);
  changedIdentity.previous_comment_id = 99;
  changedIdentity.reviews[0].findings = [
    finding({
      id: "R1-OLD",
      prefix: "Risk identified",
      summary: "Different summary.",
      impact: "Different impact.",
      required_fix: "Different required fix.",
      verification: "Different verification.",
    }),
  ];
  assert.match(
    validateReviewRecord({
      comment: comment(changedIdentity),
      headSha: sha,
      author: "maintainer",
      changedFiles: ["README.md"],
      config,
      ...history,
    }).modelReasons.join(" "),
    /changed immutable identity fields/,
  );

  const dispositionOnly = freshReviewProvenance(metadata(), 10);
  dispositionOnly.previous_comment_id = 99;
  dispositionOnly.reviews[0].findings = [
    finding({
      id: "R1-OLD",
      disposition: {
        status: "accepted",
        rationale: "The residual risk is bounded.",
        evidence: "The limitation is documented and approved.",
      },
    }),
  ];
  assert.equal(
    validateReviewRecord({
      comment: comment(dispositionOnly),
      headSha: sha,
      author: "maintainer",
      changedFiles: ["README.md"],
      config,
      ...history,
    }).modelOk,
    true,
  );
});

test("review provenance cannot be reused across prior comment SHAs", () => {
  const prior = {
    ...comment(metadata({ head_sha: "b".repeat(40) })),
    id: 99,
  };
  const currentData = metadata({ previous_comment_id: 99 });
  const current = {
    ...comment(currentData),
    id: 100,
    created_at: "2026-01-01T00:01:00Z",
    updated_at: "2026-01-01T00:01:00Z",
  };
  const history = analyzeReviewHistory(
    [prior, current],
    current,
    config,
    repository,
    1,
  );
  const result = validateReviewRecord({
    comment: current,
    headSha: sha,
    author: "maintainer",
    changedFiles: ["README.md"],
    config,
    repository,
    pullNumber: 1,
    ...history,
  });
  assert.match(result.modelReasons.join(" "), /execution IDs must not be reused/);
  assert.match(result.modelReasons.join(" "), /digests must not be reused/);
});

test("review evidence is immutable and links to the preceding comment", () => {
  const edited = comment(metadata());
  edited.updated_at = "2026-01-01T00:01:00Z";
  assert.match(
    validateReviewRecord({
      comment: edited,
      headSha: sha,
      author: "maintainer",
      changedFiles: ["README.md"],
      config,
    }).modelReasons.join(" "),
    /immutable/,
  );
  const data = metadata({ previous_comment_id: 99 });
  assert.match(
    validateReviewRecord({
      comment: comment(data),
      headSha: sha,
      author: "maintainer",
      changedFiles: ["README.md"],
      config,
      expectedPreviousCommentId: 98,
    }).modelReasons.join(" "),
    /preceding immutable/,
  );
  const missingTimestamp = comment(metadata());
  delete missingTimestamp.created_at;
  assert.match(
    validateReviewRecord({
      comment: missingTimestamp,
      headSha: sha,
      author: "maintainer",
      changedFiles: ["README.md"],
      config,
      repository,
    }).modelReasons.join(" "),
    /requires created_at and updated_at/,
  );
});

test("history rejects malformed markers, edited records, broken chains, and deletion gaps", () => {
  const first = { ...comment(metadata()), id: 10 };
  const secondData = freshReviewProvenance(
    metadata({
      head_sha: "b".repeat(40),
      previous_comment_id: 10,
    }),
    4,
  );
  const second = {
    ...comment(secondData),
    id: 11,
    created_at: "2026-01-01T00:01:00Z",
    updated_at: "2026-01-01T00:01:00Z",
  };
  const currentData = freshReviewProvenance(
    metadata({ previous_comment_id: 11 }),
    7,
  );
  const current = {
    ...comment(currentData),
    id: 12,
    created_at: "2026-01-01T00:02:00Z",
    updated_at: "2026-01-01T00:02:00Z",
  };
  assert.deepEqual(
    analyzeReviewHistory([first, second, current], current, config, repository).historyErrors,
    [],
  );

  const edited = { ...first, updated_at: "2026-01-01T00:00:01Z" };
  assert.match(
    analyzeReviewHistory([edited, second, current], current, config, repository).historyErrors.join(" "),
    /immutable/,
  );
  const malformed = { ...first, body: "<!-- loopcompass-review:v1\n{" };
  assert.match(
    analyzeReviewHistory([malformed, second, current], current, config, repository).historyErrors.join(" "),
    /metadata marker is not closed/,
  );
  assert.match(
    analyzeReviewHistory([second, current], current, config, repository).historyErrors.join(" "),
    /preceding immutable review comment/,
  );
  const malformedCurrent = { ...current, body: "<!-- loopcompass-review:v1\n{" };
  const malformedResult = validateReviewRecord({
    comment: malformedCurrent,
    headSha: sha,
    author: "maintainer",
    changedFiles: ["README.md"],
    config,
    repository,
    historyErrors: ["historical chain failure"],
  });
  assert.match(malformedResult.modelReasons.join(" "), /historical chain failure/);
});

test("historical records receive full fail-closed model validation", () => {
  const current = {
    ...comment(
      freshReviewProvenance(metadata({ previous_comment_id: 10 }), 4),
    ),
    id: 11,
    created_at: "2026-01-01T00:01:00Z",
    updated_at: "2026-01-01T00:01:00Z",
  };
  const validPrior = { ...comment(metadata()), id: 10 };
  const invalidPayloads = [
    null,
    { ...metadata(), unexpected: true },
    { ...metadata(), head_sha: "not-a-sha" },
    { ...metadata(), reviews: [null, ...metadata().reviews.slice(1)] },
    (() => {
      const value = metadata();
      value.reviews[0].evidence_digest = "short";
      return value;
    })(),
  ];
  for (const payload of invalidPayloads) {
    const prior = { ...rawComment(payload), id: 10 };
    let history;
    assert.doesNotThrow(() => {
      history = analyzeReviewHistory([prior, current], current, config, repository);
    });
    assert.ok(history.historyErrors.length > 0);
  }
  for (const prior of [
    { ...validPrior, author_type: "Bot" },
    { ...validPrior, performed_via_github_app: { id: 1 } },
    { ...validPrior, created_at: undefined },
    { ...validPrior, updated_at: undefined },
  ]) {
    assert.ok(
      analyzeReviewHistory([prior, current], current, config, repository).historyErrors
        .length > 0,
    );
  }
});

test("historical changes-requested records remain valid evidence", () => {
  const priorData = metadata({ overall_verdict: "changes_requested" });
  priorData.reviews[0].verdict = "changes_requested";
  const prior = { ...comment(priorData), id: 10 };
  const current = {
    ...comment(
      freshReviewProvenance(metadata({ previous_comment_id: 10 }), 4),
    ),
    id: 11,
    created_at: "2026-01-01T00:01:00Z",
    updated_at: "2026-01-01T00:01:00Z",
  };
  assert.deepEqual(
    analyzeReviewHistory([prior, current], current, config, repository).historyErrors,
    [],
  );
});

test("historical ordering uses created_at then numeric comment ID", () => {
  const first = { ...comment(metadata()), id: 9 };
  const second = {
    ...comment(
      freshReviewProvenance(metadata({ previous_comment_id: 9 }), 4),
    ),
    id: 10,
  };
  const current = {
    ...comment(
      freshReviewProvenance(metadata({ previous_comment_id: 10 }), 7),
    ),
    id: 11,
    created_at: "2026-01-01T00:01:00Z",
    updated_at: "2026-01-01T00:01:00Z",
  };
  assert.deepEqual(
    analyzeReviewHistory([second, first, current], current, config, repository).historyErrors,
    [],
  );
});

test("every intermediate history record carries earlier finding IDs", () => {
  const firstData = metadata({ head_sha: "1".repeat(40) });
  firstData.reviews[0].findings = [finding({ id: "R1-EARLY" })];
  const first = { ...comment(firstData), id: 1 };
  const second = {
    ...comment(
      freshReviewProvenance(
        metadata({ head_sha: "2".repeat(40), previous_comment_id: 1 }),
        4,
      ),
    ),
    id: 2,
    created_at: "2026-01-01T00:01:00Z",
    updated_at: "2026-01-01T00:01:00Z",
  };
  const thirdData = freshReviewProvenance(
    metadata({ previous_comment_id: 2 }),
    7,
  );
  thirdData.reviews[0].findings = [finding({ id: "R1-EARLY" })];
  const third = {
    ...comment(thirdData),
    id: 3,
    created_at: "2026-01-01T00:02:00Z",
    updated_at: "2026-01-01T00:02:00Z",
  };
  const history = analyzeReviewHistory(
    [first, second, third],
    third,
    config,
    repository,
    1,
  );
  assert.match(history.historyErrors.join(" "), /comment 2: prior material finding R1-EARLY/);
  const result = validateReviewRecord({
    comment: third,
    headSha: sha,
    author: "maintainer",
    changedFiles: ["README.md"],
    config,
    repository,
    pullNumber: 1,
    authorizationComments: [first, second, third],
    ...history,
  });
  assert.equal(result.modelOk, false);
});

test("selector fails forward to the latest maintainer marker and ignores foreign comments", () => {
  const older = { ...comment(metadata()), id: 10 };
  const latest = {
    ...comment(metadata()),
    id: 11,
    body: "<!-- loopcompass-review:v1\n{",
    created_at: "2026-01-01T00:01:00Z",
    updated_at: "2026-01-01T00:01:00Z",
  };
  const foreign = {
    ...comment(metadata(), "external"),
    id: 12,
    created_at: "2026-01-01T00:02:00Z",
    updated_at: "2026-01-01T00:02:00Z",
  };
  const ignoredContexts = [
    "> <!-- loopcompass-review:v1\n> {}",
    "```html\n<!-- loopcompass-review:v1\n{}\n```",
    "    <!-- loopcompass-review:v1\n    {}",
    "````markdown\n```\n<!-- loopcompass-review:v1\n{}\n````",
    "````markdown\n```` trailing text\n<!-- loopcompass-review:v1\n{}\n````",
    "~~~ info~and`both\n<!-- loopcompass-review:v1\n{}\n~~~",
  ].map((body, index) => ({
    ...comment(metadata()),
    id: 13 + index,
    body,
    created_at: `2026-01-01T00:0${3 + index}:00Z`,
    updated_at: `2026-01-01T00:0${3 + index}:00Z`,
  }));
  assert.equal(
    selectReviewComment([older, latest, foreign, ...ignoredContexts], ["maintainer"]),
    latest,
  );
});

test("rendered scalar delimiters are escaped without hiding public evidence", () => {
  const unsafe = metadata();
  unsafe.reviews[0].model = "provider/model<!--";
  unsafe.reviews[0].findings = [
    finding({
      summary: "<!-- hidden --> *emphasis* `code`",
      disposition: {
        status: "fixed",
        rationale: "<details>",
        evidence: "proof & verification",
      },
    }),
  ];
  const rendered = renderVisibleReview(unsafe);
  assert.doesNotMatch(rendered, /provider\/model<!--/);
  assert.match(rendered, /provider\/model&lt;!--/);
  assert.equal(
    rendered.includes("&lt;!-- hidden --&gt; \\*emphasis\\* \\`code\\`"),
    true,
  );
  assert.equal(evaluate({ data: unsafe }).modelOk, true);
});

test("multiline finding fields cannot inject selectable review metadata", () => {
  const multiline = metadata();
  multiline.reviews[0].findings = [
    finding({ summary: "first line\nsecond line" }),
  ];
  const multilineResult = evaluate({ data: multiline });
  assert.equal(multilineResult.modelOk, false);
  assert.match(multilineResult.modelReasons.join(" "), /single-line summary/);

  const injected = metadata();
  injected.reviews[0].findings = [
    finding({
      summary:
        "summary\n```\n<!-- loopcompass-review:v1\n{}\n-->\n```",
    }),
  ];
  const result = evaluate({ data: injected });
  assert.equal(result.modelOk, false);
});

test("delivery classification distinguishes first-party, external, and sensitive changes", () => {
  const fixtureConfig = {
    ...config,
    sensitive_paths: [".github/workflows/**", "**/auth/**"],
  };
  for (const fixture of deliveryCases.cases) {
    const actual = classifyDelivery({
      author: fixture.author,
      changedFiles: fixture.changed_files,
      config: fixtureConfig,
    });
    assert.deepEqual(
      {
        trusted: actual.trusted,
        sensitive: actual.sensitive,
        human_review_required: actual.humanReviewRequired,
      },
      fixture.expected,
      fixture.id,
    );
  }
});

test("real sensitive-path policy is case-insensitive and covers gate boundaries", () => {
  for (const path of [
    "AUTH/session.mjs",
    "services/oauth2/client.mjs",
    "lib/Permissions/check.mjs",
    "lib/permission-cache/read.mjs",
    "db/MIGRATIONS/001.sql",
    "db/migration-plan/001.sql",
    "src/SECURITY/boundary.mjs",
    "src/security-boundaries/access.mjs",
    "config/credential-store/read.mjs",
    "config/secret-values/read.mjs",
    "scripts/verify.mjs",
    "scripts/lib/signature.mjs",
    "tests/repository-health.test.mjs",
    ".github/workflows/review-gate.yml",
  ]) {
    assert.equal(matchesSensitivePath(path, repositoryConfig.sensitive_paths), true, path);
  }
});

test("durable remote implementation branches need a same-repository pull request", () => {
  const branches = [
    { name: "main" },
    { name: "codex/covered" },
    { name: "codex/orphaned" },
    { name: "feature/fork-collision" },
    { name: "release/orphaned" },
    { name: "archive/explicitly-exempt" },
  ];
  assert.deepEqual(
    auditBranches({
      branches,
      openPullRequests: [
        { head: { ref: "codex/covered", repo: { full_name: "owner/project" } } },
        { head: { ref: "feature/fork-collision", repo: { full_name: "fork/project" } } },
      ],
      repository: "owner/project",
      exemptions: ["archive/explicitly-exempt"],
    }),
    ["codex/orphaned", "feature/fork-collision", "release/orphaned"],
  );
  assert.deepEqual(
    auditBranches({
      branches: [{ name: "main" }, { name: "codex/null-head" }],
      openPullRequests: [{ head: null }, null],
      repository: "owner/project",
    }),
    ["codex/null-head"],
  );
  assert.deepEqual(
    auditBranches({
      branches: [{ name: "trunk" }, { name: "main" }],
      openPullRequests: [],
      repository: "owner/project",
      defaultBranch: "trunk",
    }),
    ["main"],
  );
});

test("event resolution and layered status payloads are deterministic", () => {
  assert.equal(resolvePullRequestNumber({ pull_request: { number: 7 } }), 7);
  assert.equal(
    resolvePullRequestNumber({ issue: { number: 8, pull_request: { url: "x" } } }),
    8,
  );
  assert.equal(
    resolvePullRequestNumber({ review: { pull_request_url: "https://api.github.com/pulls/9" } }),
    9,
  );
  assert.equal(resolvePullRequestNumber({ inputs: { pull_request_number: "11" } }), 11);
  assert.throws(() => resolvePullRequestNumber({ issue: { number: 10 } }));
  const pending = buildStatusPayloads({
    state: "pending",
    targetUrl: "https://github.com/example/project/actions/runs/1",
  });
  assert.deepEqual(pending.map((item) => item.state), ["pending", "pending"]);
  assert.deepEqual(
    pending.map((item) => item.context),
    ["model-review-gate", "delivery-policy"],
  );
  const terminal = buildStatusPayloads({
    state: "terminal",
    result: {
      modelOk: true,
      deliveryOk: false,
      modelReasons: [],
      deliveryReasons: ["human review missing"],
    },
    targetUrl: "https://github.com/example/project/actions/runs/1",
  });
  assert.deepEqual(terminal.map((item) => item.state), ["success", "failure"]);

  const approval = buildBotReviewDecision(
    { modelOk: true, deliveryOk: true },
    sha,
  );
  assert.equal(approval.event, "APPROVE");
  assert.match(approval.body, /Three independent model reviews/);
  assert.doesNotMatch(approval.body, /\b(?:I|we|our|ours|my|mine)\b/i);
  assert.doesNotMatch(
    approval.body,
    new RegExp(`\\b${["pa", "nel"].join("")}\\b`, "i"),
  );
  const changes = buildBotReviewDecision(
    { modelOk: true, deliveryOk: false },
    sha,
  );
  assert.equal(changes.event, "REQUEST_CHANGES");
  assert.equal(
    latestBotReviewMatches(
      [
        {
          id: 1,
          state: "APPROVED",
          commit_id: sha,
          body: approval.body,
          user: { login: "github-actions[bot]" },
        },
      ],
      approval,
    ),
    true,
  );
  assert.equal(
    latestBotReviewMatches(
      [
        {
          id: 1,
          state: "APPROVED",
          commit_id: sha,
          body: approval.body,
          user: { login: "github-actions[bot]" },
        },
        {
          id: 2,
          state: "CHANGES_REQUESTED",
          commit_id: sha,
          body: changes.body,
          performed_via_github_app: { slug: "github-actions" },
        },
      ],
      changes,
    ),
    true,
  );
  assert.equal(
    latestBotReviewMatches(
      [
        {
          id: 1,
          state: "APPROVED",
          commit_id: sha,
          body: approval.body,
          user: { login: "github-actions[bot]" },
        },
        {
          id: 2,
          state: "CHANGES_REQUESTED",
          commit_id: sha,
          body: changes.body,
          performed_via_github_app: { slug: "github-actions" },
        },
      ],
      approval,
    ),
    false,
  );
});

test("bot review attestations are durably bound to their policy run", () => {
  const decision = buildBotReviewDecision(
    { modelOk: true, deliveryOk: true },
    sha,
    "https://github.com/example/project/actions/runs/123",
  );
  assert.match(decision.body, /Policy run 123\./);
});

test("workflow runs provide a trusted per-pull-request head generation", () => {
  const otherSha = "b".repeat(40);
  assert.deepEqual(
    selectWorkflowHeadGeneration(
      [
        {
          id: 10,
          display_title: `delivery-policy-opened-pr-1-head-${sha}`,
          head_sha: "c".repeat(40),
          created_at: "2026-01-01T00:00:00Z",
          pull_requests: [{ number: 1 }],
        },
        {
          id: 12,
          display_title: `delivery-policy-synchronize-pr-1-head-${otherSha}`,
          head_sha: "c".repeat(40),
          created_at: "2026-01-01T00:02:00Z",
          pull_requests: [{ number: 1 }],
        },
        {
          id: 99,
          display_title: `delivery-policy-synchronize-pr-2-head-${sha}`,
          head_sha: sha,
          created_at: "2026-01-01T00:03:00Z",
          pull_requests: [{ number: 2 }],
        },
      ],
      1,
    ),
    {
      id: 12,
      pullNumber: 1,
      headSha: otherSha,
      createdAt: "2026-01-01T00:02:00Z",
    },
  );
});

test("workflow history remains usable when GitHub omits pull request associations", () => {
  const candidate = {
    id: 12,
    display_title: `delivery-policy-synchronize-pr-1-head-${sha}`,
    head_sha: "b".repeat(40),
    created_at: "2026-01-01T00:02:00Z",
    pull_requests: [],
  };
  assert.equal(selectWorkflowHeadGeneration([candidate], 1).headSha, sha);
});

test("an older establishing run rerun cannot replace the latest head generation", () => {
  const headB = "b".repeat(40);
  const runs = [
    {
      id: 10,
      run_attempt: 2,
      display_title: `delivery-policy-opened-pr-1-head-${sha}`,
      head_sha: "c".repeat(40),
      run_started_at: "2026-01-01T00:04:00Z",
      created_at: "2026-01-01T00:00:00Z",
      pull_requests: [{ number: 1 }],
    },
    {
      id: 11,
      display_title: `delivery-policy-synchronize-pr-1-head-${headB}`,
      head_sha: "c".repeat(40),
      created_at: "2026-01-01T00:01:00Z",
      pull_requests: [{ number: 1 }],
    },
    {
      id: 12,
      display_title: `delivery-policy-synchronize-pr-1-head-${sha}`,
      head_sha: "c".repeat(40),
      created_at: "2026-01-01T00:02:00Z",
      pull_requests: [{ number: 1 }],
    },
  ];
  assert.deepEqual(selectWorkflowHeadGeneration(runs, 1), {
    id: 12,
    pullNumber: 1,
    headSha: sha,
    createdAt: "2026-01-01T00:02:00Z",
  });
});

test("current establishing candidate uses immutable event head during API visibility lag", () => {
  const apiHead = "b".repeat(40);
  const candidate = currentWorkflowHeadGenerationCandidate(
    {
      id: 12,
      head_sha: apiHead,
      created_at: "2026-01-01T00:02:00Z",
    },
    {
      action: "synchronize",
      pull_request: { head: { sha } },
    },
    1,
  );
  assert.equal(candidate.head_sha, apiHead);
  assert.match(candidate.display_title, new RegExp(`-head-${sha}$`));
  assert.equal(selectWorkflowHeadGeneration([candidate], 1).headSha, sha);
});

function ownedStatuses(runUrl) {
  return [
    { context: "model-review-gate", state: "pending", target_url: runUrl },
    { context: "delivery-policy", state: "pending", target_url: runUrl },
  ];
}

function associatedPullRequests(number = 1, headSha = sha) {
  return [{ number, state: "open", head: { sha: headSha } }];
}

async function runDriver(
  snapshots,
  {
    statuses,
    failureAt,
    runUrl = "https://github.com/example/project/actions/runs/7",
  } = {},
) {
  const published = [];
  const reviewDecisions = [];
  let index = 1;
  const outcomePromise = runPolicyEvaluation({
    loadHead: async () => snapshots[0].pull.head.sha,
    loadSnapshot: async () => {
      if (failureAt === index) throw new Error("synthetic driver failure");
      return snapshots[Math.min(index++, snapshots.length - 1)];
    },
    loadAssociatedPullRequests: async () => associatedPullRequests(),
    publish: async (head, state, result, targetUrl) => {
      published.push({ head, state, result, targetUrl });
    },
    publishReview: async (head, result) => {
      reviewDecisions.push(buildBotReviewDecision(result, head));
    },
    listStatuses: async () => statuses ?? ownedStatuses(runUrl),
    config,
    repository,
    pullNumber: 1,
    runUrl,
  });
  return { outcome: await outcomePromise, published, reviewDecisions };
}

test("driver rejects missing or edited same-SHA review comments", async () => {
  const initial = rawSnapshot();
  const deleted = rawSnapshot({ comments: [] });
  const deletion = await runDriver([initial, deleted]);
  assert.equal(deletion.outcome.outcome, "fail");
  assert.equal(deletion.published.at(-1).result.modelOk, false);
  assert.equal(deletion.reviewDecisions.at(-1).event, "REQUEST_CHANGES");

  const editedComment = apiComment();
  editedComment.updated_at = "2026-01-01T00:01:00Z";
  const edit = await runDriver([initial, rawSnapshot({ comments: [editedComment] })]);
  assert.equal(edit.outcome.outcome, "fail");
  assert.match(edit.published.at(-1).result.modelReasons.join(" "), /immutable/);
  assert.equal(edit.reviewDecisions.at(-1).event, "REQUEST_CHANGES");
});

test("A to B to A requires newly generated model and human evidence", async () => {
  const headB = "b".repeat(40);
  const oldModelComment = apiComment(comment(metadata({ head_generation: 1 })));

  assert.equal(
    (await runDriver([
      rawSnapshot({
        comments: [oldModelComment],
        headGeneration: 1,
      }),
    ])).outcome.outcome,
    "pass",
  );
  assert.equal(
    (await runDriver([
      rawSnapshot({
        headSha: headB,
        comments: [oldModelComment],
        headGeneration: 2,
      }),
    ])).outcome.outcome,
    "fail",
  );
  assert.equal(
    (await runDriver([
      rawSnapshot({
        comments: [oldModelComment],
        headGeneration: 3,
      }),
    ])).outcome.outcome,
    "fail",
  );

  const freshModel = freshReviewProvenance(metadata({ head_generation: 3 }), 20);
  assert.equal(
    (await runDriver([
      rawSnapshot({
        comments: [apiComment(comment(freshModel))],
        headGeneration: 3,
      }),
    ])).outcome.outcome,
    "pass",
  );

  const staleHuman = metadata({
    head_generation: 1,
    human_approval: {
      reviewer: "maintainer",
      head_sha: sha,
      head_generation: 1,
      verdict: "approved",
      kind: "operator_authorization",
      authorization_reference: "https://github.com/example/project/pull/1#issuecomment-50",
    },
  });
  assert.equal(
    evaluate({
      data: staleHuman,
      changedFiles: [".github/workflows/verify.yml"],
      authorizationComments: [authorizationComment()],
      headGeneration: 3,
    }).deliveryOk,
    false,
  );

  const freshHuman = structuredClone(staleHuman);
  freshHuman.head_generation = 3;
  freshHuman.human_approval.head_generation = 3;
  assert.equal(
    evaluate({
      data: freshHuman,
      changedFiles: [".github/workflows/verify.yml"],
      authorizationComments: [authorizationComment({ headGeneration: 3 })],
      headGeneration: 3,
    }).deliveryOk,
    true,
  );
});

test("trusted non-sensitive pull requests receive an autonomous bot approval", async () => {
  const result = await runDriver([rawSnapshot(), rawSnapshot()]);
  assert.equal(result.outcome.outcome, "pass");
  assert.equal(result.reviewDecisions.length, 1);
  assert.equal(result.reviewDecisions[0].event, "APPROVE");
  assert.equal(result.reviewDecisions[0].commit_id, sha);
});

test("external and sensitive pull requests cannot receive bot approval without human input", async () => {
  for (const snapshot of [
    rawSnapshot({ author: "external" }),
    rawSnapshot({ files: [{ filename: ".github/workflows/verify.yml" }] }),
  ]) {
    const result = await runDriver([snapshot, snapshot]);
    assert.equal(result.outcome.outcome, "fail");
    assert.equal(result.outcome.result.deliveryOk, false);
    assert.equal(result.reviewDecisions.at(-1).event, "REQUEST_CHANGES");
  }
});

test("current human approval allows an external pull request to receive bot approval", async () => {
  const nativeApproval = {
    id: 1,
    state: "APPROVED",
    commit_id: sha,
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer", type: "User" },
    performed_via_github_app: null,
  };
  const snapshot = rawSnapshot({
    author: "external",
    reviews: [nativeApproval],
  });
  const result = await runDriver([snapshot, snapshot]);
  assert.equal(result.outcome.outcome, "pass");
  assert.equal(result.reviewDecisions.at(-1).event, "APPROVE");
});

test("driver revalidates same-SHA approval dismissal", async () => {
  const approval = {
    id: 1,
    state: "APPROVED",
    commit_id: sha,
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer", type: "User" },
    performed_via_github_app: null,
  };
  const dismissed = { ...approval, state: "DISMISSED" };
  const files = [{ filename: ".github/workflows/verify.yml" }];
  const result = await runDriver([
    rawSnapshot({ files, reviews: [approval] }),
    rawSnapshot({ files, reviews: [dismissed] }),
  ]);
  assert.equal(result.outcome.outcome, "fail");
  assert.equal(result.published.at(-1).result.modelOk, true);
  assert.equal(result.published.at(-1).result.deliveryOk, false);
  assert.equal(result.reviewDecisions.at(-1).event, "REQUEST_CHANGES");
});

test("driver fence yields to newer runs and never writes terminal status after HEAD drift", async () => {
  const newerStatuses = ownedStatuses(
    "https://github.com/example/project/actions/runs/8",
  ).map((status, index) => ({
    ...status,
    id: 20 + index,
    created_at: "2026-01-01T00:01:00Z",
  }));
  newerStatuses.unshift(
    ...ownedStatuses("https://github.com/example/project/actions/runs/7").map(
      (status, index) => ({
        ...status,
        id: 10 + index,
        created_at: "2026-01-01T00:00:00Z",
      }),
    ),
  );
  const superseded = await runDriver([rawSnapshot(), rawSnapshot()], {
    statuses: newerStatuses,
  });
  assert.equal(superseded.outcome.outcome, "superseded");
  assert.deepEqual(
    superseded.published.map((item) => item.state),
    ["pending", "reassert"],
  );

  const drifted = await runDriver([
    rawSnapshot(),
    rawSnapshot({ headSha: "b".repeat(40) }),
  ]);
  assert.equal(drifted.outcome.outcome, "head_drift");
  assert.deepEqual(drifted.published, [
    {
      head: sha,
      state: "pending",
      result: undefined,
      targetUrl: "https://github.com/example/project/actions/runs/7",
    },
  ]);
});

test("older runs restore higher-run pending contexts after interleaved terminal writes", async () => {
  const runA = "https://github.com/example/project/actions/runs/100";
  const runB = "https://github.com/example/project/actions/runs/101";
  for (const newerStates of [
    ["pending", "pending"],
    ["success", "failure"],
  ]) {
    const published = [];
    let reads = 0;
    const result = await runPolicyEvaluation({
      loadHead: async () => sha,
      loadSnapshot: async () => rawSnapshot(),
      loadAssociatedPullRequests: async () => associatedPullRequests(),
      publish: async (head, state, value, targetUrl) => {
        published.push({ head, state, value, targetUrl });
      },
      publishReview: async () => {
        throw new Error("superseded run must not publish a pull request review");
      },
      listStatuses: async () => {
        reads += 1;
        if (reads <= 3) return ownedStatuses(runA);
        return [
          ...ownedStatuses(runA).map((status) => ({ ...status, state: "success" })),
          ...ownedStatuses(runB).map((status, index) => ({
            ...status,
            state: newerStates[index],
            description: `newer ${status.context} ${newerStates[index]}`,
          })),
        ];
      },
      config,
      repository,
      pullNumber: 1,
      runUrl: runA,
    });
    assert.equal(result.outcome, "superseded_after_terminal");
    assert.deepEqual(published.map((item) => item.state), [
      "pending",
      "terminal",
      "reassert",
    ]);
    assert.deepEqual(
      buildObservedStatusPayloads(published.at(-1).value).map((status) => status.state),
      newerStates,
    );
  }
});

test("older runs do not publish over a higher run discovered before or after pending", async () => {
  const runA = "https://github.com/example/project/actions/runs/100";
  const runB = "https://github.com/example/project/actions/runs/101";
  const before = [];
  const supersededBefore = await runPolicyEvaluation({
    loadHead: async () => sha,
    loadSnapshot: async () => rawSnapshot(),
    loadAssociatedPullRequests: async () => associatedPullRequests(),
    publish: async (...args) => before.push(args),
    publishReview: async () => {
      throw new Error("superseded run must not publish a pull request review");
    },
    listStatuses: async () => ownedStatuses(runB),
    config,
    repository,
    pullNumber: 1,
    runUrl: runA,
  });
  assert.equal(supersededBefore.outcome, "superseded");
  assert.deepEqual(
    before.map((item) => item[1]),
    ["pending", "reassert"],
  );

  const after = [];
  let reads = 0;
  const supersededAfter = await runPolicyEvaluation({
    loadHead: async () => sha,
    loadSnapshot: async () => rawSnapshot(),
    loadAssociatedPullRequests: async () => associatedPullRequests(),
    publish: async (head, state, result, targetUrl) =>
      after.push({ head, state, result, targetUrl }),
    publishReview: async () => {
      throw new Error("superseded run must not publish a pull request review");
    },
    listStatuses: async () => {
      reads += 1;
      return reads === 1 ? [] : ownedStatuses(runB);
    },
    config,
    repository,
    pullNumber: 1,
    runUrl: runA,
  });
  assert.equal(supersededAfter.outcome, "superseded_after_pending");
  assert.deepEqual(
    after.map((item) => [item.state, item.targetUrl]),
    [
      ["pending", runA],
      ["reassert", undefined],
    ],
  );
  assert.deepEqual(
    buildObservedStatusPayloads(after.at(-1).result).map((status) => status.target_url),
    [runB, runB],
  );
});

test("a lower-run failure yields to higher-run success before terminal publication", async () => {
  const lower = "https://github.com/example/project/actions/runs/100";
  const higher = "https://github.com/example/project/actions/runs/101";
  const lowerOwned = ownedStatuses(lower);
  const higherSuccess = ownedStatuses(higher).map((status) => ({
    ...status,
    state: "success",
  }));
  let reads = 0;
  const published = [];
  const reviews = [];
  const badSnapshot = rawSnapshot();
  badSnapshot.pull.number = 2;
  const result = await runPolicyEvaluation({
    loadHead: async () => sha,
    loadSnapshot: async () => badSnapshot,
    loadAssociatedPullRequests: async () => associatedPullRequests(),
    publish: async (head, state, value, targetUrl) =>
      published.push({ head, state, value, targetUrl }),
    publishReview: async (...args) => reviews.push(args),
    listStatuses: async () => {
      reads += 1;
      return reads < 3 ? lowerOwned : higherSuccess;
    },
    config,
    repository,
    pullNumber: 1,
    runUrl: lower,
  });
  assert.equal(result.outcome, "superseded");
  assert.deepEqual(published.map((item) => item.state), ["pending", "reassert"]);
  assert.deepEqual(
    buildObservedStatusPayloads(published.at(-1).value).map((status) => status.state),
    ["success", "success"],
  );
  assert.equal(reviews.length, 0);
});

test("a lower-run failure reasserts higher success that appears after terminal publication", async () => {
  const lower = "https://github.com/example/project/actions/runs/100";
  const higher = "https://github.com/example/project/actions/runs/101";
  const lowerOwned = ownedStatuses(lower);
  const higherSuccess = ownedStatuses(higher).map((status) => ({
    ...status,
    state: "success",
  }));
  let reads = 0;
  const published = [];
  const reviews = [];
  const badSnapshot = rawSnapshot();
  badSnapshot.pull.number = 2;
  const result = await runPolicyEvaluation({
    loadHead: async () => sha,
    loadSnapshot: async () => badSnapshot,
    loadAssociatedPullRequests: async () => associatedPullRequests(),
    publish: async (head, state, value, targetUrl) =>
      published.push({ head, state, value, targetUrl }),
    publishReview: async (...args) => reviews.push(args),
    listStatuses: async () => {
      reads += 1;
      return reads < 4 ? lowerOwned : higherSuccess;
    },
    config,
    repository,
    pullNumber: 1,
    runUrl: lower,
  });
  assert.equal(result.outcome, "superseded_after_terminal");
  assert.deepEqual(
    published.map((item) => item.state),
    ["pending", "terminal", "reassert"],
  );
  assert.deepEqual(
    buildObservedStatusPayloads(published.at(-1).value).map((status) => status.state),
    ["success", "success"],
  );
  assert.equal(reviews.length, 0);
});

test("a lower bot approval is neutralized when a higher run appears during review publication", async () => {
  const lower = "https://github.com/example/project/actions/runs/100";
  const higher = "https://github.com/example/project/actions/runs/101";
  const lowerOwned = ownedStatuses(lower);
  const higherSuccess = ownedStatuses(higher).map((status) => ({
    ...status,
    state: "success",
  }));
  let reviewPosted = false;
  const published = [];
  const reviews = [];
  const result = await runPolicyEvaluation({
    loadHead: async () => sha,
    loadSnapshot: async () => rawSnapshot(),
    loadAssociatedPullRequests: async () => associatedPullRequests(),
    publish: async (head, state, value, targetUrl) =>
      published.push({ head, state, value, targetUrl }),
    publishReview: async (head, value) => {
      reviews.push(buildBotReviewDecision(value, head));
      reviewPosted = true;
    },
    listStatuses: async () => (reviewPosted ? higherSuccess : lowerOwned),
    config,
    repository,
    pullNumber: 1,
    runUrl: lower,
  });
  assert.equal(result.outcome, "superseded_after_review");
  assert.deepEqual(
    reviews.map((review) => review.event),
    ["APPROVE", "REQUEST_CHANGES"],
  );
  assert.deepEqual(
    published.map((item) => item.state),
    ["pending", "terminal", "reassert"],
  );
  assert.deepEqual(
    buildObservedStatusPayloads(published.at(-1).value).map((status) => status.state),
    ["success", "success"],
  );
});

test("status ownership misses and pending publication failures overwrite old green", async () => {
  const runUrl = "https://github.com/example/project/actions/runs/100";
  const oldGreen = ownedStatuses(
    "https://github.com/example/project/actions/runs/99",
  ).map((status) => ({ ...status, state: "success" }));
  const ownershipMiss = await runDriver([rawSnapshot(), rawSnapshot()], {
    statuses: oldGreen,
    runUrl,
  });
  assert.equal(ownershipMiss.outcome.outcome, "fail");
  assert.equal(ownershipMiss.published.at(-1).state, "terminal");
  assert.match(
    ownershipMiss.published.at(-1).result.deliveryReasons.join(" "),
    /did not acquire/,
  );
  assert.equal(ownershipMiss.reviewDecisions.at(-1).event, "REQUEST_CHANGES");

  let ownershipReads = 0;
  const preTerminalPublished = [];
  const preTerminalReviews = [];
  const preTerminalMiss = await runPolicyEvaluation({
    loadHead: async () => sha,
    loadSnapshot: async () => rawSnapshot(),
    loadAssociatedPullRequests: async () => associatedPullRequests(),
    publish: async (head, state, result, targetUrl) =>
      preTerminalPublished.push({ head, state, result, targetUrl }),
    publishReview: async (head, result) =>
      preTerminalReviews.push(buildBotReviewDecision(result, head)),
    listStatuses: async () => {
      ownershipReads += 1;
      return ownershipReads < 3 ? ownedStatuses(runUrl) : oldGreen;
    },
    config,
    repository,
    pullNumber: 1,
    runUrl,
  });
  assert.equal(preTerminalMiss.outcome, "fail");
  assert.match(
    preTerminalPublished.at(-1).result.deliveryReasons.join(" "),
    /lost ownership/,
  );
  assert.equal(preTerminalReviews.at(-1).event, "REQUEST_CHANGES");

  const published = [];
  const reviewDecisions = [];
  await assert.rejects(
    runPolicyEvaluation({
      loadHead: async () => sha,
      loadSnapshot: async () => rawSnapshot(),
      loadAssociatedPullRequests: async () => associatedPullRequests(),
      publish: async (head, state, result, targetUrl) => {
        published.push({ head, state, result, targetUrl });
        if (state === "pending") throw new Error("pending publication failed");
      },
      publishReview: async (head, result) =>
        reviewDecisions.push(buildBotReviewDecision(result, head)),
      listStatuses: async () => oldGreen,
      config,
      repository,
      pullNumber: 1,
      runUrl,
    }),
  );
  assert.equal(published.at(-1).state, "terminal");
  assert.equal(published.at(-1).result.ok, false);
  assert.equal(reviewDecisions.at(-1).event, "REQUEST_CHANGES");
});

test("run 101 reclaims both contexts from later terminal writes by run 100", async () => {
  const lower = "https://github.com/example/project/actions/runs/100";
  const higher = "https://github.com/example/project/actions/runs/101";
  const lowerTerminal = ownedStatuses(lower).map((status, index) => ({
    ...status,
    id: 20 + index,
    created_at: "2026-01-01T00:01:00Z",
    state: index === 0 ? "success" : "failure",
  }));
  const higherPending = ownedStatuses(higher).map((status, index) => ({
    ...status,
    id: 10 + index,
    created_at: "2026-01-01T00:00:00Z",
  }));
  const higherReasserted = higherPending.map((status, index) => ({
    ...status,
    id: 30 + index,
    created_at: "2026-01-01T00:02:00Z",
  }));
  const higherTerminal = higherPending.map((status, index) => ({
    ...status,
    id: 40 + index,
    created_at: "2026-01-01T00:03:00Z",
    state: "success",
  }));
  const histories = [
    lowerTerminal,
    [...lowerTerminal, ...higherPending],
    [...lowerTerminal, ...higherReasserted],
    [...lowerTerminal, ...higherReasserted, ...higherTerminal],
  ];
  let reads = 0;
  const published = [];
  const reviewDecisions = [];
  const result = await runPolicyEvaluation({
    loadHead: async () => sha,
    loadSnapshot: async () => rawSnapshot(),
    loadAssociatedPullRequests: async () => associatedPullRequests(),
    publish: async (head, state, value, targetUrl) =>
      published.push({ head, state, value, targetUrl }),
    publishReview: async (head, value) =>
      reviewDecisions.push(buildBotReviewDecision(value, head)),
    listStatuses: async () =>
      histories[Math.min(reads++, histories.length - 1)],
    config,
    repository,
    pullNumber: 1,
    runUrl: higher,
  });
  assert.equal(result.outcome, "pass");
  assert.deepEqual(
    published.map((item) => item.state),
    ["pending", "reassert", "terminal"],
  );
  assert.deepEqual(
    buildObservedStatusPayloads(published[1].value).map((status) => status.state),
    ["pending", "pending"],
  );
  assert.equal(published[2].targetUrl, higher);
  assert.equal(reviewDecisions.at(-1).event, "APPROVE");
});

test("foreign or unparseable policy status URLs fail closed", async () => {
  const current = "https://github.com/example/project/actions/runs/100";
  for (const target_url of [
    "https://checks.example.test/run/500",
    "https://github.com/other/project/actions/runs/101",
  ]) {
    const statuses = [
      ...ownedStatuses(current),
      {
        context: "delivery-policy",
        state: "failure",
        target_url,
      },
    ];
    const result = await runDriver([rawSnapshot(), rawSnapshot()], {
      statuses,
      runUrl: current,
    });
    assert.equal(result.outcome.outcome, "fail");
    assert.equal(result.published.at(-1).state, "terminal");
    assert.match(
      result.published.at(-1).result.deliveryReasons.join(" "),
      /foreign or unparseable/,
    );
  }
});

test("paginated status-history adapter uses the full commit statuses endpoint", async () => {
  const history = [
    {
      context: "model-review-gate",
      state: "success",
      target_url: "https://github.com/example/project/actions/runs/99",
    },
    {
      context: "delivery-policy",
      state: "failure",
      target_url: "https://github.com/example/project/actions/runs/99",
    },
  ];
  const paths = [];
  const result = await loadStatusHistory({
    repository,
    sha,
    pages: async (path) => {
      paths.push(path);
      return history;
    },
  });
  assert.deepEqual(paths, [`/repos/${repository}/commits/${sha}/statuses`]);
  assert.deepEqual(result, history);
});

test("shared HEAD association failure yields without overwriting a higher run", async () => {
  const currentRun = "https://github.com/example/project/actions/runs/100";
  const otherRun = "https://github.com/example/project/actions/runs/101";
  const published = [];
  const reviewDecisions = [];
  const result = await runPolicyEvaluation({
    loadHead: async () => sha,
    loadSnapshot: async () => rawSnapshot({ pullNumber: 2 }),
    loadAssociatedPullRequests: async () => [
      { number: 1, state: "open", head: { sha } },
      { number: 2, state: "open", head: { sha } },
    ],
    publish: async (head, state, value, targetUrl) =>
      published.push({ head, state, value, targetUrl }),
    publishReview: async (head, value) =>
      reviewDecisions.push(buildBotReviewDecision(value, head)),
    listStatuses: async () =>
      ownedStatuses(otherRun).map((status) => ({
        ...status,
        state: "success",
      })),
    config,
    repository,
    pullNumber: 2,
    runUrl: currentRun,
  });
  assert.equal(result.outcome, "superseded");
  assert.deepEqual(published.map((item) => item.state), ["pending", "reassert"]);
  assert.deepEqual(
    buildObservedStatusPayloads(published[1].value).map((status) => status.state),
    ["success", "success"],
  );
  assert.equal(reviewDecisions.length, 0);
});

test("driver publishes pending immediately after exact HEAD and before remote preflight reads", async () => {
  const runUrl = "https://github.com/example/project/actions/runs/100";
  const calls = [];
  await runPolicyEvaluation({
    loadHead: async () => {
      calls.push("head");
      return sha;
    },
    loadSnapshot: async () => {
      calls.push("snapshot");
      return rawSnapshot();
    },
    loadAssociatedPullRequests: async () => {
      calls.push("association");
      return associatedPullRequests();
    },
    publish: async (_head, state) => calls.push(`publish:${state}`),
    publishReview: async () => calls.push("review"),
    listStatuses: async () => {
      calls.push("statuses");
      return ownedStatuses(runUrl);
    },
    config,
    repository,
    pullNumber: 1,
    runUrl,
  });
  assert.deepEqual(calls.slice(0, 3), ["head", "publish:pending", "association"]);
});

test("driver exception path fails only the original owned status contexts", async () => {
  const runUrl = "https://github.com/example/project/actions/runs/7";
  const published = [];
  const reviewDecisions = [];
  await assert.rejects(
    runPolicyEvaluation({
      loadHead: async () => sha,
      loadSnapshot: async () => {
        throw new Error("synthetic driver failure");
      },
      loadAssociatedPullRequests: async () => associatedPullRequests(),
      publish: async (head, state, result) => published.push({ head, state, result }),
      publishReview: async (head, result) =>
        reviewDecisions.push(buildBotReviewDecision(result, head)),
      listStatuses: async () => ownedStatuses(runUrl),
      config,
      repository,
      pullNumber: 1,
      runUrl,
    }),
  );
  assert.deepEqual(published.map((item) => [item.head, item.state]), [
    [sha, "pending"],
    [sha, "terminal"],
  ]);
  assert.equal(published[1].result.modelOk, false);
  assert.equal(published[1].result.deliveryOk, false);
  assert.equal(reviewDecisions.at(-1).event, "REQUEST_CHANGES");
});

test("snapshot normalization includes rename sources and fails closed on truncated file lists", () => {
  const renamed = normalizeGitHubSnapshot(
    rawSnapshot({
      files: [{ filename: "docs/new.md", previous_filename: "AUTH/old-token.md" }],
    }),
  );
  assert.deepEqual(renamed.changedFiles, ["docs/new.md", "AUTH/old-token.md"]);
  assert.equal(evaluateSnapshot(renamed, repositoryConfig, repository).delivery.sensitive, true);

  const truncated = normalizeGitHubSnapshot(
    rawSnapshot({ files: [{ filename: "README.md" }], changedFiles: 2 }),
  );
  assert.equal(truncated.filesComplete, false);
  assert.equal(evaluateSnapshot(truncated, config, repository).delivery.sensitive, true);
});

test("repository policy drift fixtures cover every required live control", () => {
  const desired = {
    ...repositoryConfig.desired_ruleset,
    repository_settings: repositoryConfig.desired_repository_settings,
    actions_workflow_permissions:
      repositoryConfig.desired_actions_workflow_permissions,
  };
  const ruleset = {
    name: desired.name,
    source_type: desired.source_type,
    source: desired.source,
    target: desired.target,
    conditions: structuredClone(desired.conditions),
    enforcement: "active",
    bypass_actors: [],
    rules: [
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["squash"],
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: true,
          required_approving_review_count: 1,
          required_review_thread_resolution: true,
          required_reviewers: [],
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: desired.required_status_checks,
        },
      },
    ],
  };
  const settings = { ...repositoryConfig.desired_repository_settings };
  const workflowPermissions = {
    ...repositoryConfig.desired_actions_workflow_permissions,
  };
  assert.deepEqual(
    evaluateRepositoryPolicy({
      ruleset,
      settings,
      workflowPermissions,
      desired,
    }),
    [],
  );
  const withDismissalRestrictions = structuredClone(ruleset);
  withDismissalRestrictions.rules[0].parameters.dismissal_restriction = {
    enabled: false,
    allowed_actors: [],
  };
  assert.deepEqual(
    evaluateRepositoryPolicy({
      ruleset: withDismissalRestrictions,
      settings,
      workflowPermissions,
      desired,
    }),
    [],
  );
  const reorderedRuleset = structuredClone(ruleset);
  const reorderedDesired = structuredClone(desired);
  reorderedRuleset.conditions.ref_name = {
    exclude: ["refs/heads/archive/*", "refs/heads/legacy/*"],
    include: ["refs/heads/release/*", "refs/heads/main"],
  };
  reorderedDesired.conditions.ref_name = {
    include: ["refs/heads/main", "refs/heads/release/*"],
    exclude: ["refs/heads/legacy/*", "refs/heads/archive/*"],
  };
  assert.deepEqual(
    evaluateRepositoryPolicy({
      ruleset: reorderedRuleset,
      settings,
      workflowPermissions,
      desired: reorderedDesired,
    }),
    [],
  );
  const mutations = [
    (value) => delete value.ruleset.bypass_actors,
    (value) => value.ruleset.bypass_actors.push({ actor_id: 1 }),
    (value) => (value.ruleset.source = "organization"),
    (value) => (value.ruleset.source_type = "Organization"),
    (value) => (value.ruleset.target = "tag"),
    (value) => (value.ruleset.conditions.ref_name.include = ["refs/heads/develop"]),
    (value) => (value.ruleset.conditions.ref_name.exclude = ["refs/heads/main"]),
    (value) => (value.ruleset.conditions.ref_name.include = "refs/heads/main"),
    (value) => (value.ruleset.conditions.ref_name.exclude = [""]),
    (value) =>
      (value.ruleset.rules[0].parameters.allowed_merge_methods = ["merge", "squash"]),
    (value) =>
      (value.ruleset.rules[1].parameters.strict_required_status_checks_policy = false),
    (value) =>
      (value.ruleset.rules[1].parameters.do_not_enforce_on_create = true),
    (value) =>
      (value.ruleset.rules[1].parameters.required_status_checks[0].integration_id = 1),
    (value) =>
      (value.ruleset.rules[0].parameters.required_review_thread_resolution = false),
    (value) =>
      (value.ruleset.rules[0].parameters.dismiss_stale_reviews_on_push = false),
    (value) =>
      (value.ruleset.rules[0].parameters.require_code_owner_review = true),
    (value) =>
      (value.ruleset.rules[0].parameters.require_last_push_approval = false),
    (value) =>
      (value.ruleset.rules[0].parameters.required_approving_review_count = 0),
    (value) => (value.ruleset.rules[0].parameters.required_reviewers = [{}]),
    (value) => delete value.ruleset.rules[0].parameters.required_reviewers,
    (value) => (value.settings.allow_auto_merge = false),
    (value) => (value.workflowPermissions.default_workflow_permissions = "write"),
    (value) => (value.workflowPermissions.can_approve_pull_request_reviews = false),
  ];
  for (const mutate of mutations) {
    const value = structuredClone({ ruleset, settings, workflowPermissions });
    mutate(value);
    assert.ok(
      evaluateRepositoryPolicy({ ...value, desired }).length > 0,
    );
  }
  const additiveResponseFields = structuredClone({
    ruleset,
    settings,
    workflowPermissions,
  });
  additiveResponseFields.ruleset.rules[0].parameters.future_option = true;
  additiveResponseFields.ruleset.rules[1].parameters.future_option = true;
  additiveResponseFields.ruleset.conditions.ref_name.future_option = {
    mode: "additive",
  };
  additiveResponseFields.workflowPermissions.future_option = true;
  assert.deepEqual(
    evaluateRepositoryPolicy({ ...additiveResponseFields, desired }),
    [],
  );
  const hiddenBypass = structuredClone(ruleset);
  delete hiddenBypass.bypass_actors;
  assert.ok(
    evaluateRepositoryPolicy({
      ruleset: hiddenBypass,
      settings,
      workflowPermissions,
      desired,
    }).includes(
      "ruleset bypass actors are unverifiable",
    ),
  );
});
