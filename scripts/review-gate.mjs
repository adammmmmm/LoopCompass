#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  auditBranches,
  analyzeReviewHistory,
  selectCurrentReviewComment,
  validateReviewRecord,
} from "./lib/review-gate.mjs";

const root = new URL("../", import.meta.url);
const config = JSON.parse(await readFile(new URL(".github/delivery-policy.json", root), "utf8"));

async function api(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`);
  return response.status === 204 ? null : response.json();
}

async function pages(path) {
  const output = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const values = await api(`${path}${separator}per_page=100&page=${page}`);
    output.push(...values);
    if (values.length < 100) return output;
  }
}

function repository() {
  const value = process.env.GITHUB_REPOSITORY;
  if (!value?.includes("/")) throw new Error("GITHUB_REPOSITORY is required");
  return value;
}

async function evaluatePullRequest() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const number = event.pull_request?.number ?? event.issue?.number ?? event.review?.pull_request_url?.split("/").at(-1);
  if (!number) throw new Error("event does not identify a pull request");
  const repo = repository();
  const pull = await api(`/repos/${repo}/pulls/${number}`);
  const [files, comments, reviews] = await Promise.all([
    pages(`/repos/${repo}/pulls/${number}/files`),
    pages(`/repos/${repo}/issues/${number}/comments`),
    pages(`/repos/${repo}/pulls/${number}/reviews`),
  ]);
  const normalizedComments = comments.map((item) => ({
      id: item.id,
      body: item.body,
      author: item.user.login,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
  const comment = selectCurrentReviewComment(
    normalizedComments,
    pull.head.sha,
    config.human_maintainers,
  );
  const history = analyzeReviewHistory(
    normalizedComments,
    comment,
    config.human_maintainers,
  );
  const result = validateReviewRecord({
    comment,
    headSha: pull.head.sha,
    author: pull.user.login,
    changedFiles: files.map((file) => file.filename),
    config,
    nativeApprovals: reviews,
    ...history,
  });
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const statuses = [
    {
      context: "model-review-gate",
      ok: result.modelOk,
      reasons: result.modelReasons,
      success: "Three independent model reviews satisfied",
    },
    {
      context: "delivery-policy",
      ok: result.deliveryOk,
      reasons: result.deliveryReasons,
      success: "Conditional delivery policy satisfied",
    },
  ];
  await Promise.all(
    statuses.map((status) =>
      api(`/repos/${repo}/statuses/${pull.head.sha}`, {
        method: "POST",
        body: JSON.stringify({
          state: status.ok ? "success" : "failure",
          context: status.context,
          description: (status.ok ? status.success : status.reasons.join("; ")).slice(0, 140),
          target_url: runUrl,
        }),
      }),
    ),
  );
  console.log(
    JSON.stringify(
      {
        pull_request: number,
        head_sha: pull.head.sha,
        result: result.ok ? "pass" : "fail",
        policy: result.delivery,
        reasons: result.reasons,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exitCode = 1;
}

async function evaluateBranches() {
  const repo = repository();
  const [rawBranches, pulls] = await Promise.all([
    pages(`/repos/${repo}/branches`),
    pages(`/repos/${repo}/pulls?state=open`),
  ]);
  const branches = await Promise.all(
    rawBranches.map(async (branch) => {
      const commit = await api(`/repos/${repo}/commits/${branch.commit.sha}`);
      return { name: branch.name, commit: { committed_at: commit.commit.committer.date } };
    }),
  );
  const orphaned = auditBranches({
    branches,
    openPullRequests: pulls,
    now: new Date().toISOString(),
    graceMinutes: config.branch_pr_grace_minutes,
    branchPatterns: config.implementation_branch_patterns,
  });
  console.log(JSON.stringify({ orphaned_branches: orphaned }, null, 2));
  if (orphaned.length > 0) process.exitCode = 1;
}

const command = process.argv[2];
if (command === "github") await evaluatePullRequest();
else if (command === "branches") await evaluateBranches();
else {
  console.error("usage: node scripts/review-gate.mjs <github|branches>");
  process.exitCode = 2;
}
