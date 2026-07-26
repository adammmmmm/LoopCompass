import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
const piiReferencePath = path.join(
  root,
  "skills",
  "loop-compass",
  "references",
  "pii-sanitation.md",
);
const skillPath = path.join(root, "skills", "loop-compass", "SKILL.md");
const updateStrategyPath = path.join(root, "docs", "update-strategy-v1.md");

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
const REQUIRED_PROJECTION_FIELDS = [
  "incident_slug",
  "requested_action",
  "incident_path",
  "state",
  "obligation_revision",
  "surface",
];

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
  const failed = new Set();
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
      failed.add(slug);
      continue;
    }

    const greatestRevision = Math.max(...valid.map((obligation) => obligation.revision));
    const latest = valid.filter(
      (obligation) => obligation.revision === greatestRevision,
    );
    const distinct = new Set(latest.map(obligationFingerprint));
    if (distinct.size > 1) {
      errors.push(`conflicting_obligation_revision:${slug}`);
      failed.add(slug);
      continue;
    }
    selected.set(slug, latest[0]);
  }
  return { selected, failed };
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

function registryBySlug(testCase, errors) {
  const registry = new Map();
  for (const record of testCase.known_obligations) {
    const slug = record.incident_slug;
    if (
      !slug ||
      !Number.isInteger(record.last_known_revision) ||
      record.last_known_revision < 0
    ) {
      errors.push(`invalid_registry_record:${slug || "missing-slug"}`);
      continue;
    }
    if (registry.has(slug)) {
      errors.push(`duplicate_registry_record:${slug}`);
      continue;
    }
    registry.set(slug, record);
  }
  return registry;
}

function canonicalProjection(config, obligation) {
  return {
    incident_slug: obligation.incident_slug,
    requested_action: obligation.requested_action,
    incident_path: `.loopcompass/incidents/${obligation.incident_slug}.md`,
    state: obligation.state,
    obligation_revision: obligation.revision,
    surface: config.surface,
  };
}

function canonicalStateErrors(config, testCase, obligations, openIncidents) {
  const errors = [];
  for (const [slug, obligation] of obligations) {
    const incident = openIncidents.get(slug);
    if (
      obligation.state === "human_action_pending" &&
      (!incident || !isHumanAction(incident, config))
    ) {
      errors.push(
        incident
          ? `human_action_pending_requires_human_match:${slug}`
          : `active_obligation_missing_incident:${slug}`,
      );
    }
    if (obligation.state === "verification_pending" && !incident) {
      errors.push(`active_obligation_missing_incident:${slug}`);
    }
    if (
      obligation.state === "reassigned_nonhuman" &&
      (!incident || isHumanAction(incident, config))
    ) {
      errors.push(
        incident
          ? `reassigned_nonhuman_requires_nonhuman_match:${slug}`
          : `reassigned_nonhuman_missing_incident:${slug}`,
      );
    }
    if (obligation.state === "verified_closed") {
      if (incident) {
        errors.push(`verified_closed_incident_still_open:${slug}`);
      } else if (!hasVerifiedClosure(testCase, obligation)) {
        errors.push(`missing_closure_evidence:${slug}`);
      }
    }
  }
  return errors;
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
  const registry = registryBySlug(testCase, errors);
  const { selected: obligations, failed: failedObligations } = selectObligations(
    testCase.obligations,
    errors,
  );
  for (const [slug, record] of registry) {
    if (failedObligations.has(slug)) continue;
    const obligation = obligations.get(slug);
    if (!obligation) {
      const incident = openIncidents.get(slug);
      if (
        record.last_known_revision === 0 &&
        incident &&
        isHumanAction(incident, config) &&
        record.pending_requested_action &&
        record.pending_human_requirement
      ) {
        errors.push(`recoverable_first_marker_gap:${slug}`);
      } else {
        errors.push(`missing_obligation_history:${slug}`);
      }
    } else if (record.last_known_revision !== obligation.revision) {
      errors.push(`registry_revision_mismatch:${slug}`);
    }
  }
  for (const slug of obligations.keys()) {
    if (!registry.has(slug)) {
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
      if (failedObligations.has(incident.slug)) {
        continue;
      } else if (!obligation && !registry.has(incident.slug)) {
        errors.push(`missing_obligation:${incident.slug}`);
      } else if (obligation && RELEASED_OBLIGATIONS.has(obligation.state)) {
        errors.push(`obligation_conflicts_current_requires:${incident.slug}`);
      }
    }
  }

  errors.push(
    ...canonicalStateErrors(config, testCase, obligations, openIncidents),
  );

  for (const [slug, obligation] of obligations) {
    const projections = projectionsBySlug.get(slug) ?? [];

    if (ACTIVE_OBLIGATIONS.has(obligation.state)) {
      if (projections.length === 0) {
        errors.push(`missing_projection:${slug}`);
      } else if (projections.length > 1) {
        const surfaces = new Set(projections.map((projection) => projection.surface));
        errors.push(
          surfaces.size > 1
            ? `duplicate_projection_across_surfaces:${slug}`
            : `duplicate_projection:${slug}`,
        );
      } else {
        const [projection] = projections;
        for (const field of REQUIRED_PROJECTION_FIELDS) {
          if (
            !Object.prototype.hasOwnProperty.call(projection, field) ||
            projection[field] === ""
          ) {
            errors.push(`projection_field_missing:${field}:${slug}`);
          }
        }
        const expected = canonicalProjection(config, obligation);
        for (const field of REQUIRED_PROJECTION_FIELDS) {
          if (
            Object.prototype.hasOwnProperty.call(projection, field) &&
            projection[field] !== "" &&
            projection[field] !== expected[field]
          ) {
            errors.push(`projection_${field}_mismatch:${slug}`);
          }
        }
      }
    } else {
      if (projections.length > 0) {
        errors.push(`unexpected_projection:${slug}`);
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
  const registry = registryBySlug(testCase, obligationErrors);
  const { selected: obligations, failed } = selectObligations(
    testCase.obligations,
    obligationErrors,
  );
  for (const [slug, record] of registry) {
    if (!obligations.has(slug) && !failed.has(slug)) {
      obligationErrors.push(`missing_obligation_history:${slug}`);
    } else if (
      obligations.has(slug) &&
      record.last_known_revision !== obligations.get(slug).revision
    ) {
      obligationErrors.push(`registry_revision_mismatch:${slug}`);
    }
  }
  for (const slug of obligations.keys()) {
    if (!registry.has(slug)) {
      obligationErrors.push(`unregistered_obligation:${slug}`);
    }
  }
  const openIncidents = new Map(
    testCase.incidents
      .filter((incident) => incident.open)
      .map((incident) => [incident.slug, incident]),
  );
  obligationErrors.push(
    ...canonicalStateErrors(
      testCase.profile_config,
      testCase,
      obligations,
      openIncidents,
    ),
  );
  assert.deepEqual(obligationErrors, [], "obligation conflict blocks reconciliation");
  const deterministic = [];

  for (const obligation of obligations.values()) {
    if (!ACTIVE_OBLIGATIONS.has(obligation.state)) continue;
    deterministic.push(canonicalProjection(testCase.profile_config, obligation));
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

function repairFirstMarkerCrash(testCase) {
  const config = testCase.profile_config;
  const errors = [];
  const registry = registryBySlug(testCase, errors);
  const { selected: obligations } = selectObligations(testCase.obligations, errors);
  const openIncidents = new Map(
    testCase.incidents
      .filter((incident) => incident.open)
      .map((incident) => [incident.slug, incident]),
  );

  for (const [slug, record] of registry) {
    if (obligations.has(slug) || record.last_known_revision !== 0) continue;
    const incident = openIncidents.get(slug);
    if (
      !incident ||
      !isHumanAction(incident, config) ||
      !incident.requires.includes(record.pending_human_requirement) ||
      !record.pending_requested_action
    ) {
      continue;
    }
    const marker = {
      incident_slug: slug,
      state: "human_action_pending",
      revision: 1,
      requested_action: record.pending_requested_action,
    };
    testCase.obligations.push(marker);
    record.last_known_revision = 1;
    obligations.set(slug, marker);
  }

  return {
    ...testCase,
    known_obligations: [...registry.values()],
    obligations: [...obligations.values()],
    projections: [...obligations.values()]
      .filter((obligation) => ACTIVE_OBLIGATIONS.has(obligation.state))
      .map((obligation) => canonicalProjection(config, obligation)),
  };
}

function snapshotProject(project, excludedPrefix) {
  const snapshot = {};
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = path.relative(project, full).replaceAll("\\", "/");
      if (rel === excludedPrefix || rel.startsWith(`${excludedPrefix}/`)) continue;
      if (statSync(full).isDirectory()) visit(full);
      else snapshot[rel] = readFileSync(full).toString("base64");
    }
  };
  visit(project);
  return snapshot;
}

describe("optional human-attention profile", () => {
  it("ships the host-neutral profile and keeps it disabled by default", () => {
    const reference = readFileSync(referencePath, "utf8");
    const integration = readFileSync(integrationPath, "utf8");
    const skill = readFileSync(skillPath, "utf8");
    const pii = readFileSync(piiReferencePath, "utf8");
    const updateStrategy = readFileSync(updateStrategyPath, "utf8");

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
    assert.match(skill, /\[[^\]]*human-attention[^\]]*\]\(references\/human-attention\.md\)/i);
    assert.match(
      pii,
      /obligation markers[\s\S]*known-obligation registr(?:y|ies)[\s\S]*requested_action/i,
    );
    assert.match(
      updateStrategy,
      /projection[\s\S]*marker[\s\S]*registry[\s\S]*byte-for-byte/i,
    );
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
      "enabled-exactly-one-human-capability",
      "mixed-capability-list-creates-human-obligation",
      "enabled-needs-persisted-obligation",
      "first-marker-write-crash-is-recoverable",
      "total-deletion-remains-detectable",
      "enabled-missing-human-projection",
      "enabled-divergent-duplicates-recompute",
      "duplicate-across-surfaces-fails",
      "human-decision-awaits-verification",
      "human-token-removed-after-action-retains-projection",
      "true-non-human-reassignment-releases-projection",
      "reassignment-with-stale-projection-fails",
      "verified-closure-permits-cleanup",
      "cleanup-without-closure-evidence-fails",
      "verified-closed-stale-projection-must-be-cleaned",
      "invalid-marker-fails",
      "same-max-revision-conflict-forward",
      "same-max-revision-conflict-reverse",
      "unregistered-marker-fails",
      "release-marker-conflicts-with-current-human-requires",
      "projection-state-mismatch-fails",
      "projection-revision-mismatch-fails",
      "active-obligation-missing-canonical-incident",
      "true-orphan-with-verified-closure-is-cleaned",
      "verified-closed-while-incident-open-fails",
      "stale-human-action-after-token-removal-fails",
      "off-surface-projection-fails",
      "projection-missing-required-fields-fails",
      "failed-verification-renews-human-action",
      "failed-verification-renewal-without-human-token-fails",
      "registry-revision-mismatch-fails",
      "human-action-missing-canonical-incident",
      "reassignment-missing-canonical-incident",
      "projection-requested-action-mismatch-fails",
      "projection-incident-path-mismatch-fails",
      "non-human-action-has-no-human-projection",
      "wrong-canonical-slug-is-missing-plus-orphan",
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
      incident_slug: "release-approval-required",
      requested_action: "Approve the production release.",
      incident_path: ".loopcompass/incidents/release-approval-required.md",
      state: "verification_pending",
      obligation_revision: 2,
      surface: "OPERATOR_QUEUE.md",
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
      {
        incident_slug: "console-action-required",
        last_known_revision: 3,
      },
    ]);
    assert.deepEqual(assessConformance(testCase), [
      "missing_obligation_history:console-action-required",
    ]);
  });

  it("repairs a first-marker write crash and preserves registry metadata on replay", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "first-marker-write-crash-is-recoverable",
    );
    const testCase = resolveCase(fixture, structuredClone(rawCase));
    const originalRegistry = structuredClone(testCase.known_obligations);

    const firstPass = repairFirstMarkerCrash(testCase);
    assert.equal(firstPass.known_obligations[0].last_known_revision, 1);
    assert.equal(
      firstPass.known_obligations[0].pending_requested_action,
      originalRegistry[0].pending_requested_action,
    );
    assert.deepEqual(assessConformance(firstPass), []);

    const replay = repairFirstMarkerCrash(structuredClone(firstPass));
    assert.deepEqual(replay, firstPass);
  });

  it("rejects same-revision marker conflicts independent of input order", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const errors = ["conflicting_obligation_revision:console-action-required"];
    for (const id of [
      "same-max-revision-conflict-forward",
      "same-max-revision-conflict-reverse",
    ]) {
      const rawCase = fixture.cases.find((testCase) => testCase.id === id);
      assert.deepEqual(assessConformance(resolveCase(fixture, rawCase)), errors);
    }
  });

  it("removes a true verified orphan deterministically on replay", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "true-orphan-with-verified-closure-is-cleaned",
    );
    const testCase = resolveCase(fixture, rawCase);

    const firstPass = reconcileProjections(testCase);
    assert.deepEqual(firstPass, []);
    const replay = reconcileProjections({ ...testCase, projections: firstPass });
    assert.deepEqual(replay, []);
  });

  it("mutates only the permitted skill path during install", () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "lc-human-profile-"));
    try {
      mkdirSync(path.join(project, ".loopcompass", "incidents"), {
        recursive: true,
      });
      mkdirSync(path.join(project, "docs"), { recursive: true });
      writeFileSync(
        path.join(project, "HANDOFF.md"),
        "# Operator attention\n\n- incident: preserve-this-entry\n",
        "utf8",
      );
      writeFileSync(
        path.join(project, ".loopcompass", "human-attention-registry.json"),
        '{"known":["preserve-this-entry"]}\n',
        "utf8",
      );
      writeFileSync(
        path.join(project, ".loopcompass", "incidents", "preserve-this-entry.md"),
        "# Preserve\n",
        "utf8",
      );
      writeFileSync(
        path.join(project, "docs", "operator-queue.md"),
        "# Queue\n",
        "utf8",
      );
      const before = snapshotProject(project, ".agents/skills/loop-compass");

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
      const after = snapshotProject(project, ".agents/skills/loop-compass");
      assert.deepEqual(after, before);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
