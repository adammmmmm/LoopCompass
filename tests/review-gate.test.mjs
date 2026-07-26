import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  analyzeReviewHistory,
  auditBranches,
  buildStatusPayloads,
  classifyDelivery,
  matchesSensitivePath,
  renderVisibleReview,
  resolvePullRequestNumber,
  selectReviewComment,
  validateReviewRecord,
} from "../scripts/lib/review-gate.mjs";

const sha = "a".repeat(40);
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

function evaluate({
  data = metadata(),
  author = "maintainer",
  changedFiles = ["README.md"],
  commentAuthor = "maintainer",
  nativeApprovals = [],
} = {}) {
  return validateReviewRecord({
    comment: comment(data, commentAuthor),
    headSha: sha,
    author,
    changedFiles,
    config,
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
      verdict: "approved",
      kind: "operator_authorization",
      authorization_reference: "https://github.com/example/project/issues/1#issuecomment-2",
    },
  });
  const maintainerReviewed = metadata({
    human_approval: {
      reviewer: "maintainer",
      head_sha: sha,
      verdict: "approved",
      kind: "maintainer_review",
      authorization_reference: "https://github.com/example/project/pull/1",
    },
  });
  assert.equal(evaluate({ data: maintainerReviewed, author: "external" }).ok, true);
  assert.equal(
    evaluate({ data: selfAuthorized, changedFiles: [".github/workflows/verify.yml"] }).ok,
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
    author: "maintainer",
    changedFiles: [".github/workflows/verify.yml"],
    config,
    nativeApprovals: [nativeApproval],
  });
  assert.equal(sensitive.modelOk, false);
  assert.equal(sensitive.deliveryOk, true);
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
  assert.equal(evaluate({ changedFiles, nativeApprovals: stale }).ok, false);
  const current = [{
    state: "APPROVED",
    commit_id: sha,
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer", type: "User" },
    performed_via_github_app: null,
  }];
  assert.equal(evaluate({ changedFiles, nativeApprovals: current }).ok, true);
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
    assert.equal(evaluate({ changedFiles, nativeApprovals: [approval, later] }).ok, false);
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
      verdict: "approved",
      kind: "operator_authorization",
      authorization_reference: "https://github.com/example/project/issues/1",
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
  const currentData = metadata();
  const prior = { ...comment(oldData), id: 99 };
  const current = comment(currentData);
  currentData.previous_comment_id = 99;
  const history = analyzeReviewHistory(
    [prior, current],
    current,
    ["maintainer"],
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
});

test("history rejects malformed markers, edited records, broken chains, and deletion gaps", () => {
  const first = { ...comment(metadata()), id: 10 };
  const secondData = metadata({
    head_sha: "b".repeat(40),
    previous_comment_id: 10,
  });
  const second = {
    ...comment(secondData),
    id: 11,
    created_at: "2026-01-01T00:01:00Z",
    updated_at: "2026-01-01T00:01:00Z",
  };
  const currentData = metadata({ previous_comment_id: 11 });
  const current = {
    ...comment(currentData),
    id: 12,
    created_at: "2026-01-01T00:02:00Z",
    updated_at: "2026-01-01T00:02:00Z",
  };
  assert.deepEqual(analyzeReviewHistory([first, second, current], current, ["maintainer"]).historyErrors, []);

  const edited = { ...first, updated_at: "2026-01-01T00:00:01Z" };
  assert.match(
    analyzeReviewHistory([edited, second, current], current, ["maintainer"]).historyErrors.join(" "),
    /was edited/,
  );
  const malformed = { ...first, body: "<!-- loopcompass-review:v1\n{" };
  assert.match(
    analyzeReviewHistory([malformed, second, current], current, ["maintainer"]).historyErrors.join(" "),
    /malformed metadata/,
  );
  assert.match(
    analyzeReviewHistory([second, current], current, ["maintainer"]).historyErrors.join(" "),
    /broken predecessor link/,
  );
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
  assert.equal(selectReviewComment([older, latest, foreign], ["maintainer"]), latest);
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
    "lib/Permissions/check.mjs",
    "db/MIGRATIONS/001.sql",
    "src/SECURITY/boundary.mjs",
    "scripts/verify.mjs",
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
    { name: "release/ignored" },
  ];
  assert.deepEqual(
    auditBranches({
      branches,
      openPullRequests: [
        { head: { ref: "codex/covered", repo: { full_name: "owner/project" } } },
        { head: { ref: "feature/fork-collision", repo: { full_name: "fork/project" } } },
      ],
      repository: "owner/project",
      branchPatterns: ["codex/**", "feature/**"],
    }),
    ["codex/orphaned", "feature/fork-collision"],
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
});
