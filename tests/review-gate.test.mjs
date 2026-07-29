import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateReviewPolicy,
  renderOwnerApproval,
  renderOwnerPanel,
} from "../scripts/lib/review-gate.mjs";

const headSha = "a".repeat(40);
const staleSha = "b".repeat(40);
const owner = "maintainer";
const approvedReviews = [
  { seat: "R1", model: "provider-a/model-a", verdict: "approved" },
  { seat: "R2", model: "provider-b/model-b", verdict: "approved" },
  { seat: "R3", model: "provider-c/model-c", verdict: "approved" },
];

function comment(body, login = owner) {
  return {
    body,
    user: { login, type: "User" },
    performed_via_github_app: null,
  };
}

function evaluate(comments) {
  return evaluateReviewPolicy({ headSha, comments, owner });
}

test("current-HEAD owner panel passes without human evidence", () => {
  const result = evaluate([comment(renderOwnerPanel(headSha, approvedReviews))]);
  assert.deepEqual(
    {
      ok: result.ok,
      route: result.route,
      panelValid: result.panelValid,
      humanValid: result.humanValid,
    },
    { ok: true, route: "panel", panelValid: true, humanValid: false },
  );
});

test("current-HEAD configured-owner comment passes", () => {
  const result = evaluate([comment(renderOwnerApproval(headSha))]);
  assert.equal(result.ok, true);
  assert.equal(result.route, "owner");
});

test("neither approval route fails", () => {
  const result = evaluate([]);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /owner panel or owner approval/);
});

test("one panel rejection fails", () => {
  const reviews = structuredClone(approvedReviews);
  reviews[1].verdict = "changes_requested";
  const result = evaluate([comment(renderOwnerPanel(headSha, reviews))]);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /does not approve/);
});

test("stale-SHA evidence fails", () => {
  const result = evaluate([
    comment(renderOwnerPanel(staleSha, approvedReviews)),
    comment(renderOwnerApproval(staleSha)),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /current HEAD/);
});

test("wrong-author evidence fails", () => {
  const result = evaluate([
    comment(renderOwnerPanel(headSha, approvedReviews), "other-user"),
    comment(renderOwnerApproval(headSha), "other-user"),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /configured owner/);
});

test("malformed evidence fails safely", () => {
  const malformed = renderOwnerPanel(headSha, approvedReviews).replace(
    '"schema":1',
    '"schema":2',
  );
  const result = evaluate([comment(malformed)]);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /malformed/);
});
