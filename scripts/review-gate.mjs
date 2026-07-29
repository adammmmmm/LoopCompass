#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  auditBranches,
  buildStatusPayload,
  evaluateRepositoryPolicy,
  evaluateReviewPolicy,
  resolvePullRequestNumber,
} from "./lib/review-gate.mjs";

const root = new URL("../", import.meta.url);
const config = JSON.parse(await readFile(new URL(".github/delivery-policy.json", root), "utf8"));

async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
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
    if (!Array.isArray(values)) throw new Error(`GitHub API returned a non-list: ${path}`);
    output.push(...values);
    if (values.length < 100) return output;
  }
}

function repository() {
  const value = process.env.GITHUB_REPOSITORY;
  if (!value?.includes("/")) throw new Error("GITHUB_REPOSITORY is required");
  return value;
}

async function publishStatus(repo, sha, payload) {
  await api(`/repos/${repo}/statuses/${sha}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function evaluatePullRequest() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const number = resolvePullRequestNumber(event);
  const repo = repository();
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const pull = await api(`/repos/${repo}/pulls/${number}`);
  const headSha = pull?.head?.sha;
  if (typeof headSha !== "string" || !/^[0-9a-f]{40}$/.test(headSha)) {
    throw new Error("pull request HEAD is unavailable");
  }
  await publishStatus(
    repo,
    headSha,
    buildStatusPayload({ state: "pending", targetUrl: runUrl }),
  );
  const comments = await pages(`/repos/${repo}/issues/${number}/comments`);
  const result = evaluateReviewPolicy({
    headSha,
    comments,
    owner: config.repository_owner,
  });
  const currentHead = (await api(`/repos/${repo}/pulls/${number}`))?.head?.sha;
  if (currentHead !== headSha) {
    console.log(JSON.stringify({ pull_request: number, outcome: "head_changed" }, null, 2));
    return;
  }
  await publishStatus(
    repo,
    headSha,
    buildStatusPayload({
      state: result.ok ? "success" : "failure",
      result,
      targetUrl: runUrl,
    }),
  );
  console.log(
    JSON.stringify(
      { pull_request: number, head_sha: headSha, outcome: result.ok ? "pass" : "fail", ...result },
      null,
      2,
    ),
  );
  // A policy denial is a completed evaluation represented by the required
  // review-policy status. API and driver failures still fail this workflow job.
}

async function auditRepositoryPolicy() {
  const repo = repository();
  const summaries = await api(`/repos/${repo}/rulesets`);
  const summary = summaries.find((item) => item.name === config.desired_ruleset.name);
  if (!summary) throw new Error("configured ruleset is not visible");
  const [ruleset, settings] = await Promise.all([
    api(`/repos/${repo}/rulesets/${summary.id}`),
    api(`/repos/${repo}`),
  ]);
  const drifts = evaluateRepositoryPolicy({
    ruleset,
    settings,
    desired: {
      ...config.desired_ruleset,
      repository_settings: config.desired_repository_settings,
    },
  });
  console.log(JSON.stringify({ repository: repo, policy_drift: drifts }, null, 2));
  if (drifts.length > 0) process.exitCode = 1;
}

async function evaluateBranches() {
  const repo = repository();
  const [branches, pulls, settings] = await Promise.all([
    pages(`/repos/${repo}/branches`),
    pages(`/repos/${repo}/pulls?state=open`),
    api(`/repos/${repo}`),
  ]);
  const orphaned = auditBranches({
    branches,
    openPullRequests: pulls,
    repository: repo,
    defaultBranch: settings.default_branch,
    exemptions: config.branch_audit_exemptions,
  });
  console.log(JSON.stringify({ orphaned_branches: orphaned }, null, 2));
  if (orphaned.length > 0) process.exitCode = 1;
}

const command = process.argv[2];
if (command === "github") await evaluatePullRequest();
else if (command === "branches") await evaluateBranches();
else if (command === "audit") await auditRepositoryPolicy();
else {
  console.error("usage: node scripts/review-gate.mjs <github|branches|audit>");
  process.exitCode = 2;
}
