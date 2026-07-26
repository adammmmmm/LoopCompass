import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures", "human-attention", "cases.json");
const referencePath = path.join(
  root,
  "skills",
  "loop-compass",
  "references",
  "human-attention.md",
);
const integrationPath = path.join(
  root,
  "skills",
  "loop-compass",
  "references",
  "integration.md",
);

function isHumanAction(incident, config) {
  const capabilities = new Set(config.human_only_capabilities ?? []);
  const decisions = new Set(
    (config.human_only_decisions ?? []).map((decision) => `decision:${decision}`),
  );
  return incident.requires.some(
    (requirement) => capabilities.has(requirement) || decisions.has(requirement),
  );
}

function assessConformance(testCase) {
  const config = testCase.profile_config;
  if (!config.enabled) return [];

  const errors = [];
  if (!config.authority) errors.push("invalid_profile:authority");
  if (!config.surface) errors.push("invalid_profile:surface");

  const openIncidents = new Map(
    testCase.incidents
      .filter((incident) => incident.open)
      .map((incident) => [incident.slug, incident]),
  );
  const projectionsBySlug = new Map();
  for (const projection of testCase.projections) {
    const matches = projectionsBySlug.get(projection.incident_slug) ?? [];
    matches.push(projection);
    projectionsBySlug.set(projection.incident_slug, matches);
  }

  for (const incident of openIncidents.values()) {
    const count = (projectionsBySlug.get(incident.slug) ?? []).length;
    if (isHumanAction(incident, config)) {
      if (count === 0) errors.push(`missing_projection:${incident.slug}`);
      if (count > 1) errors.push(`duplicate_projection:${incident.slug}`);
      if (
        count === 1 &&
        incident.verification_pending &&
        projectionsBySlug.get(incident.slug)[0].state !== "verification_pending"
      ) {
        errors.push(`projection_state_not_verification_pending:${incident.slug}`);
      }
    } else if (count > 0) {
      errors.push(`unexpected_projection:${incident.slug}`);
    }
  }

  const verifiedClosures = new Set(testCase.verified_closures);
  for (const [slug] of projectionsBySlug) {
    if (openIncidents.has(slug)) continue;
    const closure = verifiedClosures.has(slug) ? "verified-closure" : "unknown-closure";
    errors.push(`orphan_projection:${closure}:${slug}`);
  }

  return errors.sort();
}

describe("optional human-attention profile", () => {
  it("ships the host-neutral profile and keeps it disabled by default", () => {
    const reference = readFileSync(referencePath, "utf8");
    const integration = readFileSync(integrationPath, "utf8");

    assert.match(reference, /optional and disabled by default/i);
    assert.match(reference, /has no `HANDOFF\.md`[\s\S]*human-projection requirement/i);
    assert.match(reference, /exactly once on[\s\S]*designated durable attention surface/i);
    assert.match(reference, /canonical incident slug as its durable join key/i);
    assert.match(reference, /owner` remains the lifecycle coordinator/i);
    assert.match(reference, /State schema 1 needs no new incident fields/i);
    assert.match(reference, /verification_pending/);
    assert.match(reference, /Remove the projection only after verified closure/i);
    assert.match(integration, /\[human-attention\.md\]\(human-attention\.md\)/);
    assert.match(integration, /Install and update flows must not create, rewrite, or reconcile/i);
  });

  it("evaluates all enabled, disabled, lifecycle, and reconciliation fixtures", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    assert.equal(fixture.schema, 1);
    assert.equal(fixture.profile, "loopcompass-human-attention-v1");
    assert.ok(fixture.cases.length >= 10);

    for (const testCase of fixture.cases) {
      const errors = assessConformance(testCase);
      assert.deepEqual(errors, [...testCase.expected.errors].sort(), testCase.id);
      assert.equal(errors.length === 0, testCase.expected.conformant, testCase.id);
    }
  });

  it("covers every acceptance-test discriminator", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const ids = new Set(fixture.cases.map((testCase) => testCase.id));

    for (const id of [
      "disabled-imposes-no-projection",
      "enabled-missing-human-projection",
      "enabled-duplicate-human-projection",
      "human-decision-awaits-verification",
      "human-step-does-not-permit-early-removal",
      "human-step-advances-existing-projection",
      "verified-closure-permits-cleanup",
      "non-human-action-has-no-human-projection",
      "human-to-non-human-reassignment-removes-projection",
      "wrong-slug-is-missing-plus-orphan",
      "orphan-with-verified-closure-must-be-cleaned",
      "enabled-profile-needs-one-authority-surface",
    ]) {
      assert.ok(ids.has(id), `missing human-attention fixture: ${id}`);
    }
  });

  it("does not mutate a consumer-owned projection during install", () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "lc-human-profile-"));
    const handoff = path.join(project, "HANDOFF.md");
    const original = "# Operator attention\n\n- incident: preserve-this-entry\n";
    try {
      mkdirSync(path.join(project, ".loopcompass"), { recursive: true });
      writeFileSync(handoff, original, "utf8");

      const result = spawnSync(
        process.execPath,
        [
          path.join(root, "scripts", "release.mjs"),
          "stage-install",
          "--project",
          project,
          "--hosts",
          "agents",
        ],
        { cwd: root, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(readFileSync(handoff, "utf8"), original);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
