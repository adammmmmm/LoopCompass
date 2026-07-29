import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("community health files remain complete and describe the current review policy", async () => {
  const [
    codeOfConduct,
    contributing,
    security,
    pullRequestTemplate,
    bugForm,
    featureForm,
    conductForm,
    issueConfig,
    readme,
    maintainerPolicy,
  ] = await Promise.all([
    read(".github/CODE_OF_CONDUCT.md"),
    read(".github/CONTRIBUTING.md"),
    read(".github/SECURITY.md"),
    read(".github/PULL_REQUEST_TEMPLATE.md"),
    read(".github/ISSUE_TEMPLATE/bug-report.yml"),
    read(".github/ISSUE_TEMPLATE/feature-request.yml"),
    read(".github/ISSUE_TEMPLATE/conduct-concern.yml"),
    read(".github/ISSUE_TEMPLATE/config.yml"),
    read("README.md"),
    read("docs/maintainer-delivery-policy.md"),
  ]);

  for (const policy of [codeOfConduct, contributing, security, pullRequestTemplate]) {
    assert.ok(policy.trim().length > 200);
    assert.doesNotMatch(policy, /\[(?:NOTE|INSERT|TODO)[^\]]*\]/i);
  }
  for (const form of [bugForm, featureForm, conductForm]) {
    assert.match(form, /^name: .+/m);
    assert.match(form, /^description: .+/m);
    assert.match(form, /^body:/m);
  }
  assert.match(issueConfig, /^blank_issues_enabled: false$/m);
  assert.match(issueConfig, /support\.github\.com\/contact\/report-content/);
  assert.match(codeOfConduct, /issues\/new\?template=conduct-concern\.yml/);
  assert.match(conductForm, /I understand this issue is public/);
  assert.doesNotMatch(featureForm, /does not require a daemon, database, or hosted service/);
  assert.match(security, /security\/advisories\/new/);
  assert.match(readme, /\.github\/CONTRIBUTING\.md/);
  assert.match(pullRequestTemplate, /green `verify` and `review-policy`/);
  assert.match(pullRequestTemplate, /Squash is the only merge method/);
  assert.match(pullRequestTemplate, /merged remote branches are deleted/);
  for (const publicPolicy of [contributing, pullRequestTemplate, maintainerPolicy]) {
    assert.match(publicPolicy, /three-model panel/i);
    assert.match(publicPolicy, /exact-current-HEAD|exact current HEAD/i);
  }
  assert.match(maintainerPolicy, /cooperative repository quality policy/);
  assert.match(maintainerPolicy, /GitHub commit statuses are SHA-scoped/);
});

test("GitHub workflows use immutable actions and trusted review-policy execution", async () => {
  const [verifyWorkflow, releaseWorkflow, reviewWorkflow, branchWorkflow, pagesWorkflow, dependabot, script] =
    await Promise.all([
      read(".github/workflows/validate-manifest.yml"),
      read(".github/workflows/release.yml"),
      read(".github/workflows/review-gate.yml"),
      read(".github/workflows/branch-lifecycle.yml"),
      read(".github/workflows/pages.yml"),
      read(".github/dependabot.yml"),
      read("scripts/review-gate.mjs"),
    ]);
  const workflows = [
    verifyWorkflow,
    releaseWorkflow,
    reviewWorkflow,
    branchWorkflow,
    pagesWorkflow,
  ].join("\n");
  const actionReferences = [...workflows.matchAll(/^\s*-?\s*uses:\s+([^\s#]+)/gm)].map(
    ([, reference]) => reference,
  );
  assert.ok(actionReferences.length >= 7);
  for (const reference of actionReferences) {
    assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/);
  }
  assert.doesNotMatch(workflows, /uses:\s+[^\s]+@v\d/);
  assert.match(verifyWorkflow, /^permissions:\n  contents: read$/m);
  assert.match(verifyWorkflow, /node-version: "24"/);
  assert.match(releaseWorkflow, /tags: \["v\*"\]/);
  assert.match(releaseWorkflow, /^\s{2}verify-tag:$/m);
  assert.match(releaseWorkflow, /needs: verify-tag/);
  assert.match(releaseWorkflow, /loopcompass-release-dist/);
  assert.match(reviewWorkflow, /^name: review-policy$/m);
  assert.match(reviewWorkflow, /statuses: write/);
  assert.match(reviewWorkflow, /pull-requests: read/);
  assert.doesNotMatch(reviewWorkflow, /pull-requests: write|actions: read|pull_request_review/);
  assert.match(reviewWorkflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(reviewWorkflow, /types: \[created, edited, deleted\]/);
  assert.match(reviewWorkflow, /group: review-policy-/);
  assert.match(reviewWorkflow, /cancel-in-progress: true/);
  assert.match(script, /\/repos\/\$\{repo\}\/issues\/\$\{number\}\/comments/);
  assert.doesNotMatch(
    script,
    /api\(`\/repos\/\$\{repo\}\/(?:pulls\/\$\{number\}\/reviews|commits\/\$\{sha\}\/pulls|actions\/runs)/,
  );
  assert.match(script, /A policy denial is a completed evaluation/);
  assert.match(branchWorkflow, /scripts\/review-gate\.mjs branches/);
  assert.doesNotMatch(branchWorkflow, /scripts\/review-gate\.mjs audit/);
  assert.match(workflows, /timeout-minutes: 10/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
});

test("delivery policy records the simplified live ruleset and cleanup settings", async () => {
  const policy = JSON.parse(await read(".github/delivery-policy.json"));
  assert.equal(policy.schema, 2);
  assert.equal(policy.repository_owner, "adammmmmm");
  assert.equal(policy.desired_ruleset.name, "Protect main");
  assert.equal(policy.desired_ruleset.source_type, "Repository");
  assert.equal(policy.desired_ruleset.source, "adammmmmm/LoopCompass");
  assert.equal(policy.desired_ruleset.target, "branch");
  assert.deepEqual(policy.desired_ruleset.conditions, {
    ref_name: { include: ["refs/heads/main"], exclude: [] },
  });
  assert.equal(policy.desired_ruleset.strict_required_status_checks, true);
  assert.equal(policy.desired_ruleset.do_not_enforce_on_create, false);
  assert.deepEqual(policy.desired_ruleset.required_status_checks, [
    { context: "verify", integration_id: 15368 },
    { context: "review-policy", integration_id: 15368 },
  ]);
  assert.deepEqual(policy.desired_ruleset.allowed_merge_methods, ["squash"]);
  assert.equal(policy.desired_ruleset.dismiss_stale_reviews_on_push, true);
  assert.equal(policy.desired_ruleset.require_code_owner_review, false);
  assert.equal(policy.desired_ruleset.require_last_push_approval, false);
  assert.equal(policy.desired_ruleset.required_approving_review_count, 0);
  assert.equal(policy.desired_ruleset.required_review_thread_resolution, true);
  assert.deepEqual(policy.desired_ruleset.required_reviewers, []);
  assert.deepEqual(policy.desired_ruleset.bypass_actors, []);
  for (const removed of [
    "trusted_contributors",
    "human_maintainers",
    "required_model_reviews",
    "sensitive_paths",
    "desired_actions_workflow_permissions",
  ]) {
    assert.equal(removed in policy, false);
  }
  assert.deepEqual(policy.branch_audit_exemptions, []);
  assert.deepEqual(policy.desired_repository_settings, {
    allow_auto_merge: true,
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
  });
});
