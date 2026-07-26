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

const ACTIVE_OBLIGATIONS = new Set([
  "human_action_pending",
  "verification_pending",
]);
const RELEASED_OBLIGATIONS = new Set([
  "reassigned_nonhuman",
  "verified_closed",
]);

function resolveCase(fixture, testCase) {
  return {
    ...testCase,
    profile_config: fixture.profiles[testCase.profile_config],
  };
}

function obligationFingerprint(obligation) {
  return JSON.stringify({
    incident_slug: obligation.incident_slug,
    state: obligation.state,
    revision: obligation.revision,
    requested_action: obligation.requested_action ?? null,
    closure_evidence_ref: obligation.closure_evidence_ref ?? null,
  });
}

function selectObligations(obligations, errors = []) {
  const bySlug = new Map();
  for (const obligation of obligations) {
    const matches = bySlug.get(obligation.incident_slug) ?? [];
    matches.push(obligation);
    bySlug.set(obligation.incident_slug, matches);
  }

  const selected = new Map();
  for (const [slug, matches] of bySlug) {
    const valid = matches.filter(
      (obligation) =>
        Number.isInteger(obligation.revision) &&
        obligation.revision > 0 &&
        (ACTIVE_OBLIGATIONS.has(obligation.state) ||
          RELEASED_OBLIGATIONS.has(obligation.state)),
    );
    if (valid.length !== matches.length) {
      errors.push(`invalid_obligation:${slug}`);
    }
    if (valid.length === 0) continue;

    const greatestRevision = Math.max(...valid.map((obligation) => obligation.revision));
    const latest = valid.filter(
      (obligation) => obligation.revision === greatestRevision,
    );
    const distinct = new Set(latest.map(obligationFingerprint));
    if (distinct.size > 1) {
      errors.push(`conflicting_obligation_revision:${slug}`);
      continue;
    }
    selected.set(slug, latest[0]);
  }
  return selected;
}

function hasVerifiedClosure(testCase, obligation) {
  if (obligation.state !== "verified_closed" || !obligation.closure_evidence_ref) {
    return false;
  }
  const evidence = testCase.closure_evidence.find(
    (candidate) => candidate.id === obligation.closure_evidence_ref,
  );
  return Boolean(
    evidence &&
      evidence.incident_slug === obligation.incident_slug &&
      evidence.normal_path_verified === true &&
      evidence.containment_removed === true &&
      evidence.incident_closure_recorded === true,
  );
}

function assessConformance(testCase) {
  const config = testCase.profile_config;
  if (!config.enabled) return [];

  const errors = [];
  if (!config.authority) errors.push("invalid_profile:authority");
  if (!config.history_retention) errors.push("invalid_profile:history_retention");
  if (!config.surface) errors.push("invalid_profile:surface");

  const openIncidents = new Map(
    testCase.incidents
      .filter((incident) => incident.open)
      .map((incident) => [incident.slug, incident]),
  );
  const obligations = selectObligations(testCase.obligations, errors);
  const knownObligations = new Set(testCase.known_obligations);
  for (const slug of knownObligations) {
    if (!obligations.has(slug)) {
      errors.push(`missing_obligation_history:${slug}`);
    }
  }
  for (const slug of obligations.keys()) {
    if (!knownObligations.has(slug)) {
      errors.push(`unregistered_obligation:${slug}`);
    }
  }
  const projectionsBySlug = new Map();
  for (const projection of testCase.projections) {
    const matches = projectionsBySlug.get(projection.incident_slug) ?? [];
    matches.push(projection);
    projectionsBySlug.set(projection.incident_slug, matches);
  }

  for (const incident of openIncidents.values()) {
    const obligation = obligations.get(incident.slug);
    if (isHumanAction(incident, config)) {
      if (!obligation) {
        errors.push(`missing_obligation:${incident.slug}`);
      } else if (RELEASED_OBLIGATIONS.has(obligation.state)) {
        errors.push(`obligation_conflicts_current_requires:${incident.slug}`);
      }
    }
  }

  for (const [slug, obligation] of obligations) {
    const projections = projectionsBySlug.get(slug) ?? [];
    if (ACTIVE_OBLIGATIONS.has(obligation.state)) {
      if (projections.length === 0) {
        errors.push(`missing_projection:${slug}`);
      } else if (projections.length > 1) {
        errors.push(`duplicate_projection:${slug}`);
      } else {
        const [projection] = projections;
        if (projection.state !== obligation.state) {
          errors.push(`projection_state_mismatch:${slug}`);
        }
        if (projection.obligation_revision !== obligation.revision) {
          errors.push(`projection_revision_mismatch:${slug}`);
        }
      }
      if (!openIncidents.has(slug)) {
        errors.push(`missing_closure_evidence:${slug}`);
      }
    } else {
      if (projections.length > 0) {
        errors.push(`unexpected_projection:${slug}`);
      }
      if (
        obligation.state === "verified_closed" &&
        !hasVerifiedClosure(testCase, obligation)
      ) {
        errors.push(`missing_closure_evidence:${slug}`);
      }
    }
  }

  for (const [slug] of projectionsBySlug) {
    if (obligations.has(slug)) continue;
    const closureKnown = testCase.closure_evidence.some(
      (evidence) =>
        evidence.incident_slug === slug &&
        evidence.normal_path_verified === true &&
        evidence.containment_removed === true &&
        evidence.incident_closure_recorded === true,
    );
    const closure = closureKnown ? "verified-closure" : "unknown-closure";
    errors.push(`orphan_projection:${closure}:${slug}`);
  }

  return errors.sort();
}

function reconcileProjections(testCase) {
  if (!testCase.profile_config.enabled) return testCase.projections;
  const obligationErrors = [];
  const obligations = selectObligations(testCase.obligations, obligationErrors);
  const knownObligations = new Set(testCase.known_obligations);
  for (const slug of knownObligations) {
    if (!obligations.has(slug)) {
      obligationErrors.push(`missing_obligation_history:${slug}`);
    }
  }
  for (const slug of obligations.keys()) {
    if (!knownObligations.has(slug)) {
      obligationErrors.push(`unregistered_obligation:${slug}`);
    }
  }
  assert.deepEqual(obligationErrors, [], "obligation conflict blocks reconciliation");
  const deterministic = [];

  for (const obligation of obligations.values()) {
    if (!ACTIVE_OBLIGATIONS.has(obligation.state)) continue;
    deterministic.push({
      incident_slug: obligation.incident_slug,
      state: obligation.state,
      obligation_revision: obligation.revision,
      requested_action: obligation.requested_action,
      incident_path: `.loopcompass/incidents/${obligation.incident_slug}.md`,
    });
  }

  for (const projection of testCase.projections) {
    if (obligations.has(projection.incident_slug)) continue;
    const hasClosure = testCase.closure_evidence.some(
      (evidence) =>
        evidence.incident_slug === projection.incident_slug &&
        evidence.normal_path_verified === true &&
        evidence.containment_removed === true &&
        evidence.incident_closure_recorded === true,
    );
    if (!hasClosure) deterministic.push(projection);
  }

  return deterministic.sort((a, b) =>
    a.incident_slug.localeCompare(b.incident_slug),
  );
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
    assert.match(reference, /persisted obligation marker/i);
    assert.match(reference, /minimal known-obligation registry/i);
    assert.match(reference, /otherwise empty current state[\s\S]*not evidence/i);
    assert.match(reference, /monotonically increasing integer `revision`/i);
    assert.match(
      reference,
      /Divergent records with the same greatest revision are a hard conflict/i,
    );
    assert.match(reference, /deterministically render one projection/i);
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

    for (const rawCase of fixture.cases) {
      const testCase = resolveCase(fixture, rawCase);
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
      "enabled-needs-persisted-obligation",
      "enabled-missing-human-projection",
      "enabled-divergent-duplicates-recompute",
      "human-decision-awaits-verification",
      "human-step-does-not-permit-early-removal",
      "human-token-removed-after-action-retains-projection",
      "true-non-human-reassignment-releases-projection",
      "reassignment-with-stale-projection-fails",
      "verified-closure-permits-cleanup",
      "cleanup-without-closure-evidence-fails",
      "non-human-action-has-no-human-projection",
      "wrong-slug-is-missing-plus-orphan",
      "orphan-with-verified-closure-must-be-cleaned",
      "total-deletion-remains-detectable",
      "failed-verification-renews-human-action",
      "enabled-profile-needs-one-authority-surface",
    ]) {
      assert.ok(ids.has(id), `missing human-attention fixture: ${id}`);
    }
  });

  it("recomputes divergent duplicates deterministically and survives crash replay", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "enabled-divergent-duplicates-recompute",
    );
    const testCase = resolveCase(fixture, rawCase);

    const firstPass = reconcileProjections(testCase);
    assert.deepEqual(firstPass, [testCase.expected.reconciled_projection]);
    const replay = reconcileProjections({ ...testCase, projections: firstPass });
    assert.deepEqual(replay, firstPass);
  });

  it("uses higher revision after failed verification even when the state looks earlier", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "failed-verification-renews-human-action",
    );
    const testCase = resolveCase(fixture, rawCase);
    const staleProjection = {
      incident_slug: "production-release-needs-approval",
      state: "verification_pending",
      obligation_revision: 2,
    };

    const firstPass = reconcileProjections({
      ...testCase,
      projections: [staleProjection],
    });
    assert.deepEqual(firstPass, [testCase.expected.reconciled_projection]);
    const replay = reconcileProjections({ ...testCase, projections: firstPass });
    assert.deepEqual(replay, firstPass);
  });

  it("detects total deletion from the retained known-obligation registry", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "total-deletion-remains-detectable",
    );
    const testCase = resolveCase(fixture, rawCase);

    assert.deepEqual(testCase.incidents, []);
    assert.deepEqual(testCase.obligations, []);
    assert.deepEqual(testCase.projections, []);
    assert.deepEqual(testCase.closure_evidence, []);
    assert.deepEqual(testCase.known_obligations, [
      "production-console-action-is-required",
    ]);
    assert.deepEqual(assessConformance(testCase), [
      "missing_obligation_history:production-console-action-is-required",
    ]);
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
