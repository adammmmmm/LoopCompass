#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  auditBranches,
  buildStatusPayloads,
  evaluateRepositoryPolicy,
  resolvePullRequestNumber,
  runPolicyEvaluation,
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
  const number = resolvePullRequestNumber(event);
  const repo = repository();
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const publish = async (sha, state, result, targetUrl = runUrl) => {
    await Promise.all(
      buildStatusPayloads({ state, result, targetUrl }).map((payload) =>
        api(`/repos/${repo}/statuses/${sha}`, {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      ),
    );
  };
  const loadSnapshot = async () => {
    const pull = await api(`/repos/${repo}/pulls/${number}`);
    const [files, comments, reviews] = await Promise.all([
      pages(`/repos/${repo}/pulls/${number}/files`),
      pages(`/repos/${repo}/issues/${number}/comments`),
      pages(`/repos/${repo}/pulls/${number}/reviews`),
    ]);
    return { pull, files, comments, reviews };
  };
  const loadHead = async () => (await api(`/repos/${repo}/pulls/${number}`)).head.sha;
  const listStatuses = async (sha) =>
    (await api(`/repos/${repo}/commits/${sha}/status`)).statuses;
  const outcome = await runPolicyEvaluation({
    loadHead,
    loadSnapshot,
    publish,
    listStatuses,
    config,
    repository: repo,
    runUrl,
  });
  console.log(JSON.stringify({ pull_request: number, ...outcome }, null, 2));
  if (outcome.outcome === "fail") process.exitCode = 1;
}

async function auditRepositoryPolicy() {
  const repo = repository();
  let ruleset;
  let settings;
  try {
    const summaries = await api(`/repos/${repo}/rulesets`);
    const named = summaries.filter(
      (item) => item.name === config.desired_ruleset.name,
    );
    const summary =
      named.find(
        (item) =>
          item.target === config.desired_ruleset.target &&
          item.source_type === config.desired_ruleset.source_type &&
          item.source === config.desired_ruleset.source,
      ) ?? named[0];
    if (!summary) throw new Error("configured ruleset is not visible");
    [ruleset, settings] = await Promise.all([
      api(`/repos/${repo}/rulesets/${summary.id}`),
      api(`/repos/${repo}`),
    ]);
  } catch (error) {
    throw new Error(`repository delivery policy is unverifiable: ${error.message}`);
  }
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
  const [branches, pulls] = await Promise.all([
    pages(`/repos/${repo}/branches`),
    pages(`/repos/${repo}/pulls?state=open`),
  ]);
  const orphaned = auditBranches({
    branches,
    openPullRequests: pulls,
    repository: repo,
    branchPatterns: config.implementation_branch_patterns,
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
