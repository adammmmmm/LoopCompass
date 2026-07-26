import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  analyzeReviewHistory,
  auditBranches,
  classifyDelivery,
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
      { seat: "R1", model: "provider-a/model-a", verdict: "approved", findings: [] },
      { seat: "R2", model: "provider-b/model-b", verdict: "approved", findings: [] },
      { seat: "R3", model: "provider-c/model-c", verdict: "approved", findings: [] },
    ],
    ...overrides,
  };
}

function comment(data = metadata(), author = "maintainer") {
  const verdicts = data.reviews
    .map(
      (review) =>
        `- ${review.seat} — ${review.model} — ${
          review.verdict === "approved" ? "Approved" : "Changes requested"
        }`,
    )
    .join("\n");
  const findings = data.reviews
    .flatMap((review) =>
      review.findings.map(
        (item) => {
          const disposition = item.disposition ?? {
            status: "missing",
            rationale: "missing",
            evidence: "missing",
          };
          return (
            `**${item.prefix} (${review.seat}):** ${item.summary}\n` +
            `- Impact: ${item.impact}\n- Required fix: ${item.required_fix}\n` +
            `- Verification: ${item.verification}\n` +
            `- Disposition: ${disposition.status} — ${disposition.rationale}; ${disposition.evidence}`
          );
        },
      ),
    )
    .join("\n");
  return {
    id: 100,
    author,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    body:
      "### Independent model reviews — 3/3 complete\n\n" +
      `**Target:** \`${data.head_sha}\`\n\n**Verdict:** \`Approved\`\n\n${verdicts}\n\n` +
      `${findings || "No blocking findings identified."}\n\n` +
      `<!-- loopcompass-review:v1\n${JSON.stringify(data)}\n-->`,
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
  const data = metadata({
    human_approval: { reviewer: "maintainer", head_sha: sha, verdict: "approved" },
  });
  assert.equal(evaluate({ data, author: "external" }).ok, true);
  assert.equal(evaluate({ data, changedFiles: [".github/workflows/verify.yml"] }).ok, true);
});

test("native human approval must target the current SHA", () => {
  const changedFiles = [".github/workflows/verify.yml"];
  const stale = [{
    state: "APPROVED",
    commit_id: "b".repeat(40),
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer" },
  }];
  assert.equal(evaluate({ changedFiles, nativeApprovals: stale }).ok, false);
  const current = [{
    state: "APPROVED",
    commit_id: sha,
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer" },
  }];
  assert.equal(evaluate({ changedFiles, nativeApprovals: current }).ok, true);
});

test("latest maintainer review invalidates an earlier approval", () => {
  const changedFiles = [".github/workflows/verify.yml"];
  const approval = {
    state: "APPROVED",
    commit_id: sha,
    submitted_at: "2026-01-01T00:00:00Z",
    user: { login: "maintainer" },
  };
  for (const state of ["CHANGES_REQUESTED", "DISMISSED"]) {
    const later = {
      state,
      commit_id: sha,
      submitted_at: "2026-01-01T00:01:00Z",
      user: { login: "maintainer" },
    };
    assert.equal(evaluate({ changedFiles, nativeApprovals: [approval, later] }).ok, false);
  }
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
  assert.match(evaluate({ commentAuthor: "external" }).reasons.join(" "), /configured maintainer/);
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

test("durable remote branches need an open pull request after the grace period", () => {
  const branches = [
    { name: "main", commit: { committed_at: "2026-01-01T00:00:00Z" } },
    { name: "codex/covered", commit: { committed_at: "2026-01-01T00:00:00Z" } },
    { name: "codex/orphaned", commit: { committed_at: "2026-01-01T00:00:00Z" } },
    { name: "codex/new", commit: { committed_at: "2026-01-01T01:50:00Z" } },
  ];
  assert.deepEqual(
    auditBranches({
      branches,
      openPullRequests: [{ head: { ref: "codex/covered" } }],
      now: "2026-01-01T02:00:00Z",
      graceMinutes: 30,
    }),
    ["codex/orphaned"],
  );
});
