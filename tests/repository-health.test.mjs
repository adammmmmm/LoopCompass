import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("community health files remain complete and discoverable", async () => {
  const [
    codeOfConduct,
    contributing,
    security,
    pullRequestTemplate,
    bugForm,
    featureForm,
    issueConfig,
    readme,
  ] = await Promise.all([
    read(".github/CODE_OF_CONDUCT.md"),
    read(".github/CONTRIBUTING.md"),
    read(".github/SECURITY.md"),
    read(".github/PULL_REQUEST_TEMPLATE.md"),
    read(".github/ISSUE_TEMPLATE/bug-report.yml"),
    read(".github/ISSUE_TEMPLATE/feature-request.yml"),
    read(".github/ISSUE_TEMPLATE/config.yml"),
    read("README.md"),
  ]);

  for (const policy of [codeOfConduct, contributing, security, pullRequestTemplate]) {
    assert.ok(policy.trim().length > 200);
    assert.doesNotMatch(policy, /\[(?:NOTE|INSERT|TODO)[^\]]*\]/i);
  }
  for (const form of [bugForm, featureForm]) {
    assert.match(form, /^name: .+/m);
    assert.match(form, /^description: .+/m);
    assert.match(form, /^body:/m);
  }
  assert.match(issueConfig, /^blank_issues_enabled: false$/m);
  assert.match(security, /security\/advisories\/new/);
  assert.match(readme, /\.github\/CONTRIBUTING\.md/);
});

test("GitHub workflows use immutable actions and bounded permissions", async () => {
  const [verifyWorkflow, pagesWorkflow, dependabot] = await Promise.all([
    read(".github/workflows/validate-manifest.yml"),
    read(".github/workflows/pages.yml"),
    read(".github/dependabot.yml"),
  ]);
  const workflows = `${verifyWorkflow}\n${pagesWorkflow}`;
  const actionReferences = [...workflows.matchAll(/^\s*-?\s*uses:\s+([^\s#]+)/gm)].map(
    ([, reference]) => reference,
  );

  assert.ok(actionReferences.length >= 8);
  for (const reference of actionReferences) {
    assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/);
  }
  assert.doesNotMatch(workflows, /uses:\s+[^\s]+@v\d/);
  assert.match(verifyWorkflow, /^permissions:\n  contents: read$/m);
  assert.match(verifyWorkflow, /node-version: "24"/);
  assert.match(workflows, /timeout-minutes: 10/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
});
