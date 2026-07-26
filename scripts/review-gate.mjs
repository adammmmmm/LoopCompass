#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  auditBranches,
  analyzeReviewHistory,
  buildStatusPayloads,
  resolvePullRequestNumber,
  selectReviewComment,
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
  const number = resolvePullRequestNumber(event);
  const repo = repository();
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  let statusSha = null;
  const publish = async (sha, state, result) => {
    statusSha = sha;
    await Promise.all(
      buildStatusPayloads({ state, result, targetUrl: runUrl }).map((payload) =>
        api(`/repos/${repo}/statuses/${sha}`, {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      ),
    );
  };
  const load = async () => {
    const pull = await api(`/repos/${repo}/pulls/${number}`);
    const [files, comments, reviews] = await Promise.all([
      pages(`/repos/${repo}/pulls/${number}/files`),
      pages(`/repos/${repo}/issues/${number}/comments`),
      pages(`/repos/${repo}/pulls/${number}/reviews`),
    ]);
    return { pull, files, comments, reviews };
  };

  try {
    const initialPull = await api(`/repos/${repo}/pulls/${number}`);
    await publish(initialPull.head.sha, "pending");
    await load();
    const snapshot = await load();
    if (snapshot.pull.head.sha !== initialPull.head.sha) {
      await publish(snapshot.pull.head.sha, "pending");
    }
    const normalizedComments = snapshot.comments.map((item) => ({
      id: item.id,
      body: item.body,
      author: item.user.login,
      author_type: item.user.type,
      performed_via_github_app: item.performed_via_github_app,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
    const comment = selectReviewComment(normalizedComments, config.human_maintainers);
    const history = analyzeReviewHistory(
      normalizedComments,
      comment,
      config.human_maintainers,
    );
    const result = validateReviewRecord({
      comment,
      headSha: snapshot.pull.head.sha,
      author: snapshot.pull.user.login,
      changedFiles: snapshot.files.map((file) => file.filename),
      config,
      nativeApprovals: snapshot.reviews,
      ...history,
    });
    const terminalPull = await api(`/repos/${repo}/pulls/${number}`);
    if (terminalPull.head.sha !== snapshot.pull.head.sha) {
      await publish(terminalPull.head.sha, "pending");
      throw new Error("pull request HEAD changed during policy evaluation");
    }
    await publish(snapshot.pull.head.sha, "terminal", result);
    console.log(
      JSON.stringify(
        {
          pull_request: number,
          head_sha: snapshot.pull.head.sha,
          result: result.ok ? "pass" : "fail",
          policy: result.delivery,
          reasons: result.reasons,
        },
        null,
        2,
      ),
    );
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    if (statusSha) {
      try {
        const failure = {
          modelOk: false,
          deliveryOk: false,
          modelReasons: ["Policy evaluation did not complete"],
          deliveryReasons: ["Policy evaluation did not complete"],
        };
        await publish(statusSha, "terminal", failure);
      } catch {
        // The workflow failure remains visible when status publication is unavailable.
      }
    }
    throw error;
  }
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
else {
  console.error("usage: node scripts/review-gate.mjs <github|branches>");
  process.exitCode = 2;
}
