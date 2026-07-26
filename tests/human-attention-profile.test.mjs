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
const verificationPath = path.join(root, "docs", "verification.md");
const designPath = path.join(root, "docs", "design.md");

function isHumanAction(incident, config) {
  const capabilities = new Set(config.human_only_capabilities ?? []);
  const decisions = new Set(
    (config.human_only_decisions ?? []).map((decision) => `decision:${decision}`),
  );
  return incident.requires.some(
    (requirement) => capabilities.has(requirement) || decisions.has(requirement),
  );
}

function isDeclaredHumanRequirement(requirement, config) {
  if (!requirement) return false;
  return (
    (config.human_only_capabilities ?? []).includes(requirement) ||
    (requirement.startsWith("decision:") &&
      (config.human_only_decisions ?? []).includes(
        requirement.slice("decision:".length),
      ))
  );
}

function pendingMetadataIsStable(record, config) {
  return Boolean(
    record.last_known_revision === 0 &&
      typeof record.pending_requested_action === "string" &&
      record.pending_requested_action.trim() &&
      typeof record.pending_human_requirement === "string" &&
      isDeclaredHumanRequirement(record.pending_human_requirement, config),
  );
}

function exactPendingMetadataMatches(record, incident, config) {
  return Boolean(
    incident &&
      pendingMetadataIsStable(record, config) &&
      incident.requires.includes(record.pending_human_requirement),
  );
}

function initialMarkerMatches(record, marker, config) {
  return Boolean(
    pendingMetadataIsStable(record, config) &&
      marker &&
      marker.revision === 1 &&
      marker.state === "human_action_pending" &&
      marker.requested_action === record.pending_requested_action &&
      marker.human_requirement === record.pending_human_requirement,
  );
}

function retainedInitialHistoryMatches(record, markers, config) {
  if (!pendingMetadataIsStable(record, config)) return false;
  const initial = markers.filter(
    (marker) =>
      isPlainRecord(marker) &&
      marker.incident_slug === record.incident_slug &&
      marker.revision === 1,
  );
  return (
    initial.length > 0 &&
    initial.every((marker) => initialMarkerMatches(record, marker, config)) &&
    new Set(initial.map(obligationFingerprint)).size === 1
  );
}

function initialHistoryStatus(record, markers, incident, config) {
  const initial = markers.filter(
    (marker) =>
      isPlainRecord(marker) &&
      marker.incident_slug === record.incident_slug &&
      marker.revision === 1,
  );
  if (initial.length > 0) {
    return retainedInitialHistoryMatches(record, markers, config)
      ? "retained"
      : "invalid";
  }
  if (exactPendingMetadataMatches(record, incident, config)) {
    return "synthesizable";
  }
  return pendingMetadataIsStable(record, config)
    ? "missing"
    : "invalid";
}

const ACTIVE_OBLIGATIONS = new Set([
  "human_action_pending",
  "verification_pending",
]);
const RELEASED_OBLIGATIONS = new Set([
  "reassigned_nonhuman",
  "verified_closed",
]);
const CANONICAL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_PROJECTION_FIELDS = [
  "incident_slug",
  "requested_action",
  "incident_path",
  "state",
  "obligation_revision",
  "surface",
];

function isPlainRecord(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
}

function isCanonicalSlug(value) {
  return (
    typeof value === "string" &&
    value.length <= 96 &&
    CANONICAL_SLUG.test(value)
  );
}

function hasValidEnabledProfile(config) {
  return Boolean(
    isPlainRecord(config) &&
      config.enabled === true &&
      typeof config.surface === "string" &&
      config.surface.trim() &&
      typeof config.authority === "string" &&
      config.authority.trim() &&
      typeof config.history_retention === "string" &&
      config.history_retention.trim(),
  );
}

function incidentsBySlug(testCase, errors = []) {
  const openIncidents = new Map();
  const failed = new Set();
  const seen = new Set();
  let unscopedInvalid = false;
  if (!Array.isArray(testCase.incidents)) {
    errors.push("invalid_incident_collection");
    return { openIncidents, failed, unscopedInvalid: true };
  }
  for (const incident of testCase.incidents) {
    if (!isPlainRecord(incident)) {
      errors.push("invalid_incident_record:missing-slug");
      unscopedInvalid = true;
      continue;
    }
    const slug = incident.slug;
    if (!isCanonicalSlug(slug)) {
      errors.push("invalid_incident_record:invalid-slug");
      unscopedInvalid = true;
      continue;
    }
    if (
      typeof incident.open !== "boolean" ||
      !Array.isArray(incident.requires) ||
      incident.requires.some(
        (requirement) =>
          typeof requirement !== "string" || !requirement.trim(),
      )
    ) {
      errors.push(`invalid_incident_record:${slug}`);
      failed.add(slug);
      openIncidents.delete(slug);
      continue;
    }
    if (seen.has(slug)) {
      errors.push(`duplicate_incident_record:${slug}`);
      failed.add(slug);
      openIncidents.delete(slug);
      continue;
    }
    seen.add(slug);
    if (incident.open) openIncidents.set(slug, incident);
  }
  for (const slug of failed) openIncidents.delete(slug);
  return { openIncidents, failed, unscopedInvalid };
}

function resolveCase(fixture, testCase) {
  return {
    ...testCase,
    profile_config: fixture.profiles[testCase.profile_config],
  };
}

function stableRecord(value) {
  if (Array.isArray(value)) return value.map(stableRecord);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableRecord(value[key])]),
    );
  }
  return value;
}

function obligationFingerprint(obligation) {
  return JSON.stringify(stableRecord(obligation));
}

function isIntrinsicallyValidObligation(obligation, config) {
  if (!isPlainRecord(obligation) || !isCanonicalSlug(obligation.incident_slug)) {
    return false;
  }
  const supportedState =
    ACTIVE_OBLIGATIONS.has(obligation.state) ||
    RELEASED_OBLIGATIONS.has(obligation.state);
  const activeFieldsValid =
    !ACTIVE_OBLIGATIONS.has(obligation.state) ||
    (typeof obligation.requested_action === "string" &&
      obligation.requested_action.trim() &&
      typeof obligation.human_requirement === "string" &&
      isDeclaredHumanRequirement(obligation.human_requirement, config));
  const closureFieldValid =
    obligation.state !== "verified_closed" ||
    (typeof obligation.closure_evidence_ref === "string" &&
      obligation.closure_evidence_ref.trim());
  return Boolean(
    Number.isInteger(obligation.revision) &&
      obligation.revision > 0 &&
      supportedState &&
      activeFieldsValid &&
      closureFieldValid,
  );
}

function selectObligations(obligations, config, errors = []) {
  const bySlug = new Map();
  const failed = new Set();
  let unscopedInvalid = false;
  if (!Array.isArray(obligations)) {
    errors.push("invalid_obligation_collection");
    return { selected: new Map(), failed, unscopedInvalid: true };
  }
  for (const obligation of obligations) {
    if (!isPlainRecord(obligation)) {
      errors.push("invalid_obligation:missing-slug");
      unscopedInvalid = true;
      continue;
    }
    const slug = obligation.incident_slug;
    const slugIsCanonical = isCanonicalSlug(slug);
    if (
      !slugIsCanonical ||
      !isIntrinsicallyValidObligation(obligation, config)
    ) {
      const diagnosticSlug = slugIsCanonical ? slug : "invalid-slug";
      errors.push(`invalid_obligation:${diagnosticSlug}`);
      if (slugIsCanonical) failed.add(slug);
      else unscopedInvalid = true;
      continue;
    }
    const matches = bySlug.get(obligation.incident_slug) ?? [];
    matches.push(obligation);
    bySlug.set(obligation.incident_slug, matches);
  }

  const selected = new Map();
  for (const [slug, matches] of bySlug) {
    if (failed.has(slug)) continue;
    const greatestRevision = Math.max(
      ...matches.map((obligation) => obligation.revision),
    );
    const latest = matches.filter(
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
  return { selected, failed, unscopedInvalid };
}

function hasCompleteClosureEvidence(testCase, slug, evidenceRef) {
  if (!Array.isArray(testCase.closure_evidence)) return false;
  return testCase.closure_evidence.some(
    (evidence) =>
      isPlainRecord(evidence) &&
      (!evidenceRef || evidence.id === evidenceRef) &&
      evidence.incident_slug === slug &&
      evidence.normal_path_verified === true &&
      evidence.containment_removed === true &&
      evidence.incident_closure_recorded === true,
  );
}

function hasVerifiedClosure(testCase, obligation) {
  return Boolean(
    obligation.state === "verified_closed" &&
      obligation.closure_evidence_ref &&
      hasCompleteClosureEvidence(
        testCase,
        obligation.incident_slug,
        obligation.closure_evidence_ref,
      ),
  );
}

function registryBySlug(testCase, errors) {
  const registry = new Map();
  const failed = new Set();
  const duplicateReported = new Set();
  const canonicalSlugCounts = new Map();
  let unscopedInvalid = false;
  if (!Array.isArray(testCase.known_obligations)) {
    errors.push("invalid_registry_collection");
    return { registry, failed, unscopedInvalid: true };
  }
  for (const record of testCase.known_obligations) {
    if (!isPlainRecord(record) || !isCanonicalSlug(record.incident_slug)) {
      continue;
    }
    canonicalSlugCounts.set(
      record.incident_slug,
      (canonicalSlugCounts.get(record.incident_slug) ?? 0) + 1,
    );
  }
  for (const record of testCase.known_obligations) {
    if (!isPlainRecord(record)) {
      errors.push("invalid_registry_record:missing-slug");
      unscopedInvalid = true;
      continue;
    }
    const slug = record.incident_slug;
    const slugIsCanonical = isCanonicalSlug(slug);
    const slugIsDuplicated =
      slugIsCanonical && canonicalSlugCounts.get(slug) > 1;
    if (slugIsDuplicated) {
      if (!duplicateReported.has(slug)) {
        errors.push(`duplicate_registry_record:${slug}`);
        duplicateReported.add(slug);
      }
      failed.add(slug);
      registry.delete(slug);
    }
    if (
      !slugIsCanonical ||
      !Number.isInteger(record.last_known_revision) ||
      record.last_known_revision < 0
    ) {
      const diagnosticSlug = slugIsCanonical ? slug : "invalid-slug";
      errors.push(`invalid_registry_record:${diagnosticSlug}`);
      if (slugIsCanonical) {
        failed.add(slug);
        registry.delete(slug);
      } else unscopedInvalid = true;
      continue;
    }
    if (slugIsDuplicated) continue;
    if (!failed.has(slug)) registry.set(slug, record);
  }
  return { registry, failed, unscopedInvalid };
}

function projectionsBySlug(testCase, errors) {
  const projections = new Map();
  let unscopedInvalid = false;
  if (!Array.isArray(testCase.projections)) {
    errors.push("invalid_projection_collection");
    return { projections, unscopedInvalid: true };
  }
  for (const projection of testCase.projections) {
    if (!isPlainRecord(projection)) {
      errors.push("invalid_projection:missing-slug");
      unscopedInvalid = true;
      continue;
    }
    const slug = projection.incident_slug;
    if (!isCanonicalSlug(slug)) {
      errors.push("invalid_projection:invalid-slug");
      unscopedInvalid = true;
      continue;
    }
    const matches = projections.get(slug) ?? [];
    matches.push(projection);
    projections.set(slug, matches);
  }
  return { projections, unscopedInvalid };
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

function projectionRepresentationErrors(config, obligation, projection) {
  const slug = obligation.incident_slug;
  const errors = [];
  for (const field of REQUIRED_PROJECTION_FIELDS) {
    if (
      !Object.prototype.hasOwnProperty.call(projection, field) ||
      projection[field] === "" ||
      projection[field] === null ||
      projection[field] === undefined
    ) {
      errors.push(`projection_field_missing:${field}:${slug}`);
    }
  }
  const expectedValues = {
    incident_slug: obligation.incident_slug,
    requested_action: obligation.requested_action,
    incident_path: `.loopcompass/incidents/${obligation.incident_slug}.md`,
    state: obligation.state,
    obligation_revision: obligation.revision,
    surface: config.surface,
  };
  for (const [field, expected] of Object.entries(expectedValues)) {
    if (
      projection[field] !== undefined &&
      projection[field] !== null &&
      projection[field] !== "" &&
      projection[field] !== expected
    ) {
      errors.push(`projection_${field}_mismatch:${slug}`);
    }
  }
  return errors;
}

function selectedMarkerStateErrors(config, testCase, marker, openIncidents) {
  return canonicalStateErrors(
    config,
    testCase,
    new Map([[marker.incident_slug, marker]]),
    openIncidents,
  );
}

function registryCatchUpError(
  config,
  testCase,
  record,
  marker,
  openIncidents,
) {
  if (record.last_known_revision === 0) {
    const history = initialHistoryStatus(
      record,
      testCase.obligations,
      openIncidents.get(record.incident_slug),
      config,
    );
    if (history === "invalid") return "invalid_first_write_metadata";
    if (history === "missing") return "missing_obligation_history";
  } else {
    const knownRevision = testCase.obligations.filter(
      (candidate) =>
        isPlainRecord(candidate) &&
        candidate.incident_slug === record.incident_slug &&
        candidate.revision === record.last_known_revision,
    );
    if (knownRevision.length === 0) return "missing_known_revision_history";
    if (
      knownRevision.length !== 1 ||
      !isIntrinsicallyValidObligation(knownRevision[0], config)
    ) {
      return "corrupt_known_revision_history";
    }
  }
  if (
    selectedMarkerStateErrors(config, testCase, marker, openIncidents).length > 0
  ) {
    return "unrepairable_registry_lag";
  }
  return null;
}

function canonicalStateErrors(
  config,
  testCase,
  obligations,
  openIncidents,
  failedIncidents = new Set(),
) {
  const errors = [];
  for (const [slug, obligation] of obligations) {
    if (failedIncidents.has(slug)) continue;
    const incident = openIncidents.get(slug);
    if (
      obligation.state === "human_action_pending" &&
      (!incident ||
        !incident.requires.includes(obligation.human_requirement) ||
        !isDeclaredHumanRequirement(obligation.human_requirement, config))
    ) {
      errors.push(
        incident
          ? `human_action_pending_requires_human_match:${slug}`
          : `active_obligation_missing_incident:${slug}`,
      );
    }
    if (obligation.state === "verification_pending") {
      if (!incident) {
        errors.push(`active_obligation_missing_incident:${slug}`);
      } else if (!isDeclaredHumanRequirement(obligation.human_requirement, config)) {
        errors.push(`verification_pending_requires_stable_human_requirement:${slug}`);
      }
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

function openIncidentObligationErrors(
  config,
  openIncidents,
  obligations,
  failedObligations,
  registry,
  projections,
) {
  const errors = [];
  for (const incident of openIncidents.values()) {
    const obligation = obligations.get(incident.slug);
    if (!isHumanAction(incident, config)) {
      if (
        !obligation &&
        !registry.has(incident.slug) &&
        !failedObligations.has(incident.slug) &&
        projections.has(incident.slug)
      ) {
        errors.push(`unexpected_projection:${incident.slug}`);
      }
      continue;
    }
    if (failedObligations.has(incident.slug)) continue;
    if (!obligation && !registry.has(incident.slug)) {
      errors.push(`missing_obligation:${incident.slug}`);
    } else if (obligation && RELEASED_OBLIGATIONS.has(obligation.state)) {
      errors.push(`obligation_conflicts_current_requires:${incident.slug}`);
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

  const {
    openIncidents,
    failed: failedIncidents,
    unscopedInvalid: unscopedIncident,
  } = incidentsBySlug(testCase, errors);
  const {
    registry,
    failed: failedRegistry,
    unscopedInvalid: unscopedRegistry,
  } = registryBySlug(testCase, errors);
  const {
    projections: projectionRecords,
    unscopedInvalid: unscopedProjection,
  } = projectionsBySlug(
    testCase,
    errors,
  );
  const {
    selected: obligations,
    failed: failedObligations,
    unscopedInvalid: unscopedMarker,
  } = selectObligations(testCase.obligations, config, errors);
  const unscopedSurfaceFailure =
    unscopedIncident ||
    unscopedRegistry ||
    unscopedProjection ||
    unscopedMarker;
  if (unscopedSurfaceFailure) {
    errors.push("invalid_attention_surface:unscoped-record");
  }
  const failedState = new Set([...failedObligations, ...failedRegistry]);
  for (const [slug, record] of registry) {
    if (failedState.has(slug) || failedIncidents.has(slug)) continue;
    const obligation = obligations.get(slug);
    if (!obligation) {
      const incident = openIncidents.get(slug);
      if (exactPendingMetadataMatches(record, incident, config)) {
        if (!unscopedSurfaceFailure) {
          errors.push(`recoverable_first_marker_gap:${slug}`);
        }
      } else if (record.last_known_revision === 0) {
        errors.push(
          `${
            pendingMetadataIsStable(record, config)
              ? "missing_obligation_history"
              : "invalid_first_write_metadata"
          }:${slug}`,
        );
      } else {
        errors.push(`missing_obligation_history:${slug}`);
      }
    } else if (record.last_known_revision < obligation.revision) {
      const catchUpError = registryCatchUpError(
        config,
        testCase,
        record,
        obligation,
        openIncidents,
      );
      if (catchUpError) {
        errors.push(`${catchUpError}:${slug}`);
      } else if (!unscopedSurfaceFailure) {
        errors.push(`recoverable_registry_lag:${slug}`);
      }
    } else if (record.last_known_revision > obligation.revision) {
      errors.push(`registry_ahead_of_marker:${slug}`);
    }
  }
  for (const slug of obligations.keys()) {
    if (!registry.has(slug) && !failedRegistry.has(slug)) {
      errors.push(`unregistered_obligation:${slug}`);
    }
  }
  errors.push(
    ...openIncidentObligationErrors(
      config,
      openIncidents,
      obligations,
      failedState,
      registry,
      projectionRecords,
    ),
  );

  errors.push(
    ...canonicalStateErrors(
      config,
      testCase,
      obligations,
      openIncidents,
      failedIncidents,
    ),
  );

  for (const [slug, obligation] of obligations) {
    const projections = projectionRecords.get(slug) ?? [];

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
        errors.push(
          ...projectionRepresentationErrors(config, obligation, projection),
        );
      }
    } else {
      if (projections.length > 0) {
        errors.push(`unexpected_projection:${slug}`);
      }
    }
  }

  for (const [slug] of projectionRecords) {
    if (
      obligations.has(slug) ||
      failedState.has(slug) ||
      failedIncidents.has(slug) ||
      registry.has(slug) ||
      openIncidents.has(slug)
    ) {
      continue;
    }
    const closureKnown = hasCompleteClosureEvidence(testCase, slug);
    const closure = closureKnown ? "verified-closure" : "unknown-closure";
    errors.push(`orphan_projection:${closure}:${slug}`);
  }

  return errors.sort();
}

function reconcileProjections(testCase) {
  if (!hasValidEnabledProfile(testCase.profile_config)) {
    return testCase.projections;
  }
  const obligationErrors = [];
  const {
    openIncidents,
    failed: failedIncidents,
  } = incidentsBySlug(testCase, obligationErrors);
  const { registry, failed: failedRegistry } = registryBySlug(
    testCase,
    obligationErrors,
  );
  const { projections: projectionRecords } = projectionsBySlug(
    testCase,
    obligationErrors,
  );
  const { selected: obligations, failed } = selectObligations(
    testCase.obligations,
    testCase.profile_config,
    obligationErrors,
  );
  const failedState = new Set([...failed, ...failedRegistry]);
  for (const [slug, record] of registry) {
    if (!obligations.has(slug) && !failedState.has(slug)) {
      obligationErrors.push(`missing_obligation_history:${slug}`);
    } else if (
      obligations.has(slug) &&
      record.last_known_revision !== obligations.get(slug).revision
    ) {
      obligationErrors.push(`registry_revision_mismatch:${slug}`);
    }
  }
  for (const slug of obligations.keys()) {
    if (!registry.has(slug) && !failedRegistry.has(slug)) {
      obligationErrors.push(`unregistered_obligation:${slug}`);
    }
  }
  obligationErrors.push(
    ...openIncidentObligationErrors(
      testCase.profile_config,
      openIncidents,
      obligations,
      failedState,
      registry,
      projectionRecords,
    ),
  );
  obligationErrors.push(
    ...canonicalStateErrors(
      testCase.profile_config,
      testCase,
      obligations,
      openIncidents,
      failedIncidents,
    ),
  );
  assert.deepEqual(obligationErrors, [], "obligation conflict blocks reconciliation");
  const deterministic = [];

  for (const obligation of obligations.values()) {
    if (!ACTIVE_OBLIGATIONS.has(obligation.state)) continue;
    const projection = canonicalProjection(testCase.profile_config, obligation);
    const renderedErrors = projectionRepresentationErrors(
      testCase.profile_config,
      obligation,
      projection,
    );
    assert.deepEqual(renderedErrors, [], "rendered projection must validate");
    deterministic.push(projection);
  }

  for (const projection of testCase.projections) {
    if (obligations.has(projection.incident_slug)) continue;
    if (openIncidents.has(projection.incident_slug)) {
      deterministic.push(projection);
      continue;
    }
    const hasClosure = hasCompleteClosureEvidence(
      testCase,
      projection.incident_slug,
    );
    if (!hasClosure) deterministic.push(projection);
  }

  return deterministic.sort((a, b) =>
    a.incident_slug.localeCompare(b.incident_slug),
  );
}

function repairRegistryCrash(testCase) {
  const config = testCase.profile_config;
  const errors = [];
  if (!hasValidEnabledProfile(config)) {
    return structuredClone(testCase);
  }
  if (
    !Array.isArray(testCase.incidents) ||
    !Array.isArray(testCase.known_obligations) ||
    !Array.isArray(testCase.obligations) ||
    !Array.isArray(testCase.projections)
  ) {
    return structuredClone(testCase);
  }
  const knownObligations = testCase.known_obligations.map((record) =>
    structuredClone(record),
  );
  const markerHistory = testCase.obligations.map((marker) =>
    structuredClone(marker),
  );
  const working = {
    ...testCase,
    known_obligations: knownObligations,
    obligations: markerHistory,
  };
  const {
    openIncidents,
    failed: failedIncidents,
    unscopedInvalid: unscopedIncident,
  } = incidentsBySlug(working, errors);
  const {
    registry,
    failed: failedRegistry,
    unscopedInvalid: unscopedRegistry,
  } = registryBySlug(working, errors);
  const { unscopedInvalid: unscopedProjection } = projectionsBySlug(
    testCase,
    errors,
  );
  const {
    selected: obligations,
    failed,
    unscopedInvalid,
  } = selectObligations(
    markerHistory,
    config,
    errors,
  );
  if (
    unscopedIncident ||
    unscopedInvalid ||
    unscopedRegistry ||
    unscopedProjection
  ) {
    return {
      ...testCase,
      known_obligations: knownObligations,
      obligations: markerHistory,
    };
  }
  for (let index = 0; index < knownObligations.length; index++) {
    const record = knownObligations[index];
    if (!isPlainRecord(record)) continue;
    const slug = record.incident_slug;
    if (
      registry.get(slug) !== record ||
      failedIncidents.has(slug) ||
      failed.has(slug) ||
      failedRegistry.has(slug)
    ) {
      continue;
    }
    const incident = openIncidents.get(slug);
    let marker = obligations.get(slug);
    const shouldSynthesize =
      record.last_known_revision === 0 &&
      initialHistoryStatus(record, markerHistory, incident, config) ===
        "synthesizable";
    const initialMarker = shouldSynthesize
      ? {
          incident_slug: slug,
          state: "human_action_pending",
          revision: 1,
          requested_action: record.pending_requested_action,
          human_requirement: record.pending_human_requirement,
        }
      : null;
    const candidateHistory = initialMarker
      ? [...markerHistory, initialMarker]
      : markerHistory;
    const candidateWorking = {
      ...working,
      obligations: candidateHistory,
    };
    const candidateMarker = marker ?? initialMarker;

    if (
      !candidateMarker ||
      record.last_known_revision >= candidateMarker.revision
    ) {
      continue;
    }
    if (
      registryCatchUpError(
        config,
        candidateWorking,
        record,
        candidateMarker,
        openIncidents,
      )
    ) {
      continue;
    }
    if (initialMarker) {
      markerHistory.push(initialMarker);
      if (!marker) {
        marker = initialMarker;
        obligations.set(slug, initialMarker);
      }
    }
    knownObligations[index] = {
      ...record,
      last_known_revision: candidateMarker.revision,
    };
  }

  return {
    ...testCase,
    known_obligations: knownObligations,
    obligations: markerHistory,
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
    const verification = readFileSync(verificationPath, "utf8");
    const design = readFileSync(designPath, "utf8");

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
      /Divergent full records with the same greatest revision are a hard conflict/i,
    );
    assert.doesNotMatch(reference, /next required action/i);
    for (const key of REQUIRED_PROJECTION_FIELDS) {
      assert.match(reference, new RegExp(`\`${key}\``));
    }
    assert.match(
      reference,
      /`obligation_revision` is the integer revision of the[\s\S]*selected marker/i,
    );
    assert.match(reference, /Fail closed if any co-marker is invalid/i);
    assert.match(reference, /Failed[\s\S]*validation is an exact no-op/i);
    assert.match(
      reference,
      /Projection representation does not gate marker\/registry crash repair/i,
    );
    assert.match(
      reference,
      /exactly one intrinsically valid marker[\s\S]*positive `last_known_revision`/i,
    );
    assert.match(
      reference,
      /Duplicate registry records[\s\S]*ambiguous authority/i,
    );
    assert.match(reference, /suppresses every `recoverable` diagnostic/i);
    assert.match(
      reference,
      /Incident records require[\s\S]*canonical slug[\s\S]*Boolean open state[\s\S]*requirements array/i,
    );
    assert.match(
      reference,
      /Null,\s*scalar,[\s\S]*malformed sibling records[\s\S]*never a[\s\S]*runtime exception/i,
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
    assert.match(
      verification,
      /human-attention lifecycle[\s\S]*fixtures\/human-attention\/cases\.json[\s\S]*tests\/human-attention-profile\.test\.mjs/i,
    );
    assert.match(
      design,
      /human-attention lifecycle[\s\S]*crash-repair[\s\S]*tests\/human-attention-profile\.test\.mjs/i,
    );
  });

  it("evaluates all enabled, disabled, lifecycle, and reconciliation fixtures", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    assert.equal(fixture.schema, 1);
    assert.equal(fixture.profile, "loopcompass-human-attention-v1");
    assert.ok(fixture.cases.length >= 10);
    assert.equal(
      new Set(fixture.cases.map((testCase) => testCase.id)).size,
      fixture.cases.length,
      "fixture IDs must be unique",
    );

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
      "registry-lag-repairable",
      "first-marker-registry-lag-is-recoverable",
      "invalid-first-write-metadata-does-not-reconstruct",
      "registry-ahead-of-marker-fails",
      "mixed-valid-invalid-markers-fail-closed",
      "same-revision-unknown-field-conflict-fails",
      "revision-zero-to-two-verification-lag-is-recoverable",
      "revision-zero-to-three-verification-lag-is-recoverable",
      "revision-zero-mismatched-initial-history-fails",
      "unrepairable-canonical-state-registry-lag",
      "later-marker-missing-revision-one-live-match-is-repairable",
      "later-marker-missing-revision-one-without-live-match-fails",
      "revision-zero-deleted-incident-is-missing-history",
      "first-marker-gap-with-existing-projection-is-repairable",
      "stale-closure-cannot-clean-open-incident-projection",
      "invalid-historical-marker-blocks-repair",
      "multi-slug-repair-is-isolated",
      "synthetic-revision-one-is-atomic-with-invalid-closed-marker",
      "synthetic-revision-one-is-atomic-with-invalid-reassignment",
      "stale-projection-does-not-block-registry-lag-repair",
      "divergent-projections-do-not-block-first-marker-gap-repair",
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

    const repaired = repairRegistryCrash(testCase);
    assert.equal(repaired.known_obligations[0].last_known_revision, 1);
    assert.equal(
      repaired.known_obligations[0].pending_requested_action,
      originalRegistry[0].pending_requested_action,
    );
    const firstPass = {
      ...repaired,
      projections: reconcileProjections(repaired),
    };
    assert.deepEqual(assessConformance(firstPass), []);

    const replayRepair = repairRegistryCrash(structuredClone(firstPass));
    const replay = {
      ...replayRepair,
      projections: reconcileProjections(replayRepair),
    };
    assert.deepEqual(replay, firstPass);
  });

  it("repairs either first-write crash window and rejects bad reconstruction metadata", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    for (const id of [
      "first-marker-write-crash-is-recoverable",
      "first-marker-gap-with-existing-projection-is-repairable",
      "first-marker-registry-lag-is-recoverable",
      "revision-zero-to-two-verification-lag-is-recoverable",
      "revision-zero-to-three-verification-lag-is-recoverable",
    ]) {
      const rawCase = fixture.cases.find((testCase) => testCase.id === id);
      const testCase = resolveCase(fixture, structuredClone(rawCase));
      const originalRegistry = structuredClone(testCase.known_obligations);
      const originalMarkers = structuredClone(testCase.obligations);
      const repaired = repairRegistryCrash(testCase);
      if (
        id === "first-marker-write-crash-is-recoverable" ||
        id === "first-marker-gap-with-existing-projection-is-repairable"
      ) {
        assert.equal(repaired.obligations.length, originalMarkers.length + 1);
      } else {
        assert.deepEqual(repaired.obligations, originalMarkers, `${id}: history`);
      }
      for (const [key, value] of Object.entries(originalRegistry[0])) {
        if (key === "last_known_revision") continue;
        assert.deepEqual(
          repaired.known_obligations[0][key],
          value,
          `${id}: registry ${key}`,
        );
      }
      const reconciled = {
        ...repaired,
        projections: reconcileProjections(repaired),
      };
      assert.deepEqual(assessConformance(reconciled), [], id);
      assert.deepEqual(
        repairRegistryCrash(structuredClone(reconciled)),
        reconciled,
        `${id}: replay`,
      );
    }

    const invalidRaw = fixture.cases.find(
      (testCase) =>
        testCase.id === "invalid-first-write-metadata-does-not-reconstruct",
    );
    const invalid = resolveCase(fixture, structuredClone(invalidRaw));
    assert.deepEqual(repairRegistryCrash(invalid), invalid);
    assert.deepEqual(invalid.obligations, []);

    const mismatchRaw = fixture.cases.find(
      (testCase) =>
        testCase.id === "revision-zero-mismatched-initial-history-fails",
    );
    const mismatch = resolveCase(fixture, structuredClone(mismatchRaw));
    assert.deepEqual(repairRegistryCrash(mismatch), mismatch);

    for (const id of [
      "later-marker-missing-revision-one-without-live-match-fails",
      "revision-zero-deleted-incident-is-missing-history",
    ]) {
      const rawCase = fixture.cases.find((testCase) => testCase.id === id);
      const testCase = resolveCase(fixture, structuredClone(rawCase));
      assert.deepEqual(repairRegistryCrash(testCase), testCase, id);
    }
  });

  it("synthesizes missing revision one before advancing to a valid later marker", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) =>
        testCase.id ===
        "later-marker-missing-revision-one-live-match-is-repairable",
    );
    const testCase = resolveCase(fixture, structuredClone(rawCase));
    const laterMarker = structuredClone(testCase.obligations[0]);

    const repaired = repairRegistryCrash(testCase);
    assert.equal(repaired.known_obligations[0].last_known_revision, 2);
    assert.equal(repaired.known_obligations[0].retention_note, "preserve");
    assert.deepEqual(repaired.obligations[0], laterMarker);
    assert.deepEqual(repaired.obligations[1], {
      incident_slug: "console-action-required",
      state: "human_action_pending",
      revision: 1,
      requested_action: "Perform the production console action.",
      human_requirement: "production-console",
    });
    const reconciled = {
      ...repaired,
      projections: reconcileProjections(repaired),
    };
    assert.deepEqual(assessConformance(reconciled), []);
    assert.deepEqual(repairRegistryCrash(structuredClone(reconciled)), reconciled);
  });

  it("commits synthetic history and registry advancement atomically", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    for (const id of [
      "synthetic-revision-one-is-atomic-with-invalid-closed-marker",
      "synthetic-revision-one-is-atomic-with-invalid-reassignment",
    ]) {
      const rawCase = fixture.cases.find((testCase) => testCase.id === id);
      const testCase = resolveCase(fixture, structuredClone(rawCase));
      const original = structuredClone(testCase);
      assert.doesNotMatch(
        assessConformance(testCase).join("\n"),
        /recoverable_registry_lag/,
      );
      assert.deepEqual(repairRegistryCrash(testCase), original, id);
    }
  });

  it("repairs marker and registry state before canonically rewriting projections", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    for (const id of [
      "stale-projection-does-not-block-registry-lag-repair",
      "divergent-projections-do-not-block-first-marker-gap-repair",
    ]) {
      const rawCase = fixture.cases.find((testCase) => testCase.id === id);
      const testCase = resolveCase(fixture, structuredClone(rawCase));
      const originalProjections = structuredClone(testCase.projections);

      const repaired = repairRegistryCrash(testCase);
      assert.deepEqual(
        repaired.projections,
        originalProjections,
        `${id}: repair must not rewrite projection`,
      );
      assert.ok(
        repaired.known_obligations[0].last_known_revision > 0,
        `${id}: registry must advance`,
      );
      const reconciled = {
        ...repaired,
        projections: reconcileProjections(repaired),
      };
      assert.deepEqual(assessConformance(reconciled), [], id);
    }
  });

  it("validates every historical marker and handles malformed values without throwing", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const lagRaw = fixture.cases.find(
      (testCase) => testCase.id === "registry-lag-repairable",
    );
    const malformedCases = [
      { marker: null, error: "invalid_obligation:missing-slug" },
      { marker: 7, error: "invalid_obligation:missing-slug" },
      { marker: [], error: "invalid_obligation:missing-slug" },
      {
        marker: {
          incident_slug: "console-action-required",
          state: "verified_closed",
          revision: 1,
        },
        error: "invalid_obligation:console-action-required",
      },
      {
        marker: {
          incident_slug: "Not Canonical",
          state: "reassigned_nonhuman",
          revision: 1,
        },
        error: "invalid_obligation:invalid-slug",
      },
    ];
    for (const { marker, error } of malformedCases) {
      const testCase = resolveCase(fixture, structuredClone(lagRaw));
      testCase.obligations.unshift(marker);
      assert.ok(assessConformance(testCase).includes(error));
      assert.deepEqual(repairRegistryCrash(testCase), testCase);
      assert.throws(
        () => reconcileProjections(testCase),
        /obligation conflict blocks reconciliation/,
      );
    }

    const historicalRaw = fixture.cases.find(
      (testCase) => testCase.id === "invalid-historical-marker-blocks-repair",
    );
    const historical = resolveCase(fixture, structuredClone(historicalRaw));
    assert.deepEqual(repairRegistryCrash(historical), historical);
    assert.throws(
      () => reconcileProjections(historical),
      /obligation conflict blocks reconciliation/,
    );

    const malformedClosed = resolveCase(fixture, structuredClone(lagRaw));
    malformedClosed.obligations.unshift({
      incident_slug: "console-action-required",
      state: "verified_closed",
      revision: 1,
    });
    assert.deepEqual(assessConformance(malformedClosed), [
      "invalid_obligation:console-action-required",
    ]);
    assert.deepEqual(repairRegistryCrash(malformedClosed), malformedClosed);
  });

  it("parses malformed marker, registry, and projection siblings totally", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const revZeroRaw = fixture.cases.find(
      (testCase) =>
        testCase.id === "revision-zero-to-two-verification-lag-is-recoverable",
    );
    for (const malformed of [null, 7, []]) {
      const testCase = resolveCase(fixture, structuredClone(revZeroRaw));
      testCase.obligations.push(malformed);
      const original = structuredClone(testCase);
      assert.ok(
        assessConformance(testCase).includes(
          "invalid_obligation:missing-slug",
        ),
      );
      assert.ok(
        assessConformance(testCase).includes(
          "invalid_attention_surface:unscoped-record",
        ),
      );
      assert.doesNotMatch(
        assessConformance(testCase).join("\n"),
        /recoverable_(?:first_marker_gap|registry_lag)/,
      );
      assert.deepEqual(repairRegistryCrash(testCase), original);
      assert.throws(
        () => reconcileProjections(testCase),
        /obligation conflict blocks reconciliation/,
      );
    }

    const lagRaw = fixture.cases.find(
      (testCase) => testCase.id === "registry-lag-repairable",
    );
    for (const collection of ["known_obligations", "projections"]) {
      for (const malformed of [null, 7, []]) {
        const testCase = resolveCase(fixture, structuredClone(lagRaw));
        testCase[collection].push(malformed);
        const original = structuredClone(testCase);
        const diagnostic =
          collection === "known_obligations"
            ? "invalid_registry_record:missing-slug"
            : "invalid_projection:missing-slug";
        assert.ok(assessConformance(testCase).includes(diagnostic));
        assert.ok(
          assessConformance(testCase).includes(
            "invalid_attention_surface:unscoped-record",
          ),
        );
        assert.doesNotMatch(
          assessConformance(testCase).join("\n"),
          /recoverable_(?:first_marker_gap|registry_lag)/,
        );
        assert.deepEqual(repairRegistryCrash(testCase), original);
        assert.throws(
          () => reconcileProjections(testCase),
          /obligation conflict blocks reconciliation/,
        );
      }
    }
  });

  it("parses malformed incident collections and siblings totally", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const lagRaw = fixture.cases.find(
      (testCase) => testCase.id === "registry-lag-repairable",
    );

    const invalidCollection = resolveCase(fixture, structuredClone(lagRaw));
    invalidCollection.incidents = null;
    assert.ok(
      assessConformance(invalidCollection).includes(
        "invalid_incident_collection",
      ),
    );
    assert.ok(
      assessConformance(invalidCollection).includes(
        "invalid_attention_surface:unscoped-record",
      ),
    );
    assert.deepEqual(repairRegistryCrash(invalidCollection), invalidCollection);
    assert.throws(
      () => reconcileProjections(invalidCollection),
      /obligation conflict blocks reconciliation/,
    );

    for (const { malformed, diagnostic } of [
      { malformed: null, diagnostic: "invalid_incident_record:missing-slug" },
      { malformed: 7, diagnostic: "invalid_incident_record:missing-slug" },
      { malformed: [], diagnostic: "invalid_incident_record:missing-slug" },
      {
        malformed: { slug: "Not Canonical", open: true, requires: [] },
        diagnostic: "invalid_incident_record:invalid-slug",
      },
    ]) {
      const testCase = resolveCase(fixture, structuredClone(lagRaw));
      testCase.incidents.push(malformed);
      const original = structuredClone(testCase);
      const errors = assessConformance(testCase);
      assert.ok(errors.includes(diagnostic));
      assert.ok(errors.includes("invalid_attention_surface:unscoped-record"));
      assert.doesNotMatch(
        errors.join("\n"),
        /recoverable_(?:first_marker_gap|registry_lag)/,
      );
      assert.deepEqual(repairRegistryCrash(testCase), original);
      assert.throws(
        () => reconcileProjections(testCase),
        /obligation conflict blocks reconciliation/,
      );
    }

    for (const replacement of [
      { slug: "console-action-required", open: true },
      {
        slug: "console-action-required",
        open: "true",
        requires: ["production-console"],
      },
      {
        slug: "console-action-required",
        open: true,
        requires: [null],
      },
    ]) {
      const testCase = resolveCase(fixture, structuredClone(lagRaw));
      testCase.incidents[0] = replacement;
      const original = structuredClone(testCase);
      const errors = assessConformance(testCase);
      assert.ok(
        errors.includes("invalid_incident_record:console-action-required"),
      );
      assert.doesNotMatch(errors.join("\n"), /recoverable_registry_lag/);
      assert.deepEqual(repairRegistryCrash(testCase), original);
      assert.throws(
        () => reconcileProjections(testCase),
        /obligation conflict blocks reconciliation/,
      );
    }
  });

  it("isolates malformed incident repair blocking by canonical slug", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "multi-slug-repair-is-isolated",
    );
    const testCase = resolveCase(fixture, structuredClone(rawCase));
    testCase.obligations.find(
      (marker) =>
        marker.incident_slug === "second-console-action" &&
        marker.revision === 1,
    ).human_requirement = "production-console";
    delete testCase.incidents.find(
      (incident) => incident.slug === "second-console-action",
    ).requires;
    const originalIncidents = structuredClone(testCase.incidents);

    const errors = assessConformance(testCase);
    assert.ok(errors.includes("invalid_incident_record:second-console-action"));
    assert.ok(errors.includes("recoverable_registry_lag:console-action-required"));
    assert.ok(
      !errors.includes("recoverable_registry_lag:second-console-action"),
    );

    const repaired = repairRegistryCrash(testCase);
    assert.equal(repaired.known_obligations[0].last_known_revision, 2);
    assert.equal(repaired.known_obligations[1].last_known_revision, 1);
    assert.deepEqual(repaired.incidents, originalIncidents);
    assert.throws(
      () => reconcileProjections(repaired),
      /obligation conflict blocks reconciliation/,
    );
  });

  it("never treats stale closure evidence as authority to delete a live projection", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) =>
        testCase.id === "stale-closure-cannot-clean-open-incident-projection",
    );
    const testCase = resolveCase(fixture, structuredClone(rawCase));
    const originalProjection = structuredClone(testCase.projections);

    assert.deepEqual(assessConformance(testCase), [
      "missing_obligation:console-action-required",
    ]);
    assert.throws(
      () => reconcileProjections(testCase),
      /obligation conflict blocks reconciliation/,
    );
    assert.deepEqual(testCase.projections, originalProjection);
  });

  it("isolates repair by canonical slug", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "multi-slug-repair-is-isolated",
    );
    const testCase = resolveCase(fixture, structuredClone(rawCase));
    const invalidHistory = structuredClone(
      testCase.obligations.filter(
        (marker) => marker.incident_slug === "second-console-action",
      ),
    );

    const repaired = repairRegistryCrash(testCase);
    assert.equal(repaired.known_obligations[0].last_known_revision, 2);
    assert.equal(repaired.known_obligations[1].last_known_revision, 1);
    assert.deepEqual(
      repaired.obligations.filter(
        (marker) => marker.incident_slug === "second-console-action",
      ),
      invalidHistory,
    );
    assert.deepEqual(assessConformance(repaired), [
      "invalid_obligation:second-console-action",
    ]);
  });

  it("repairs a later registry lag without losing history, metadata, or siblings", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "registry-lag-repairable",
    );
    const testCase = resolveCase(fixture, structuredClone(rawCase));
    const corruptSibling = {
      incident_slug: "corrupt-sibling",
      last_known_revision: "unknown",
      opaque: { retain: true },
    };
    testCase.known_obligations.push(corruptSibling);
    const originalMarkers = structuredClone(testCase.obligations);

    const repaired = repairRegistryCrash(testCase);
    assert.equal(repaired.known_obligations[0].last_known_revision, 2);
    assert.equal(repaired.known_obligations[0].retention_note, "preserve");
    assert.deepEqual(repaired.known_obligations[1], corruptSibling);
    assert.deepEqual(repaired.obligations, originalMarkers);
    assert.deepEqual(
      repairRegistryCrash(structuredClone(repaired)),
      repaired,
      "registry repair must be idempotent",
    );

    const withoutCorruptSibling = {
      ...repaired,
      known_obligations: [repaired.known_obligations[0]],
    };
    const reconciled = {
      ...withoutCorruptSibling,
      projections: reconcileProjections(withoutCorruptSibling),
    };
    assert.deepEqual(assessConformance(reconciled), []);
  });

  it("requires the exact known positive revision before registry catch-up", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "registry-lag-repairable",
    );

    const intact = resolveCase(fixture, structuredClone(rawCase));
    const intactHistory = structuredClone(intact.obligations);
    assert.deepEqual(assessConformance(intact), [
      "recoverable_registry_lag:console-action-required",
    ]);
    const repairedIntact = repairRegistryCrash(intact);
    assert.equal(repairedIntact.known_obligations[0].last_known_revision, 2);
    assert.deepEqual(repairedIntact.obligations, intactHistory);

    const missing = resolveCase(fixture, structuredClone(rawCase));
    missing.obligations = missing.obligations.filter(
      (marker) => marker.revision !== 1,
    );
    const missingOriginal = structuredClone(missing);
    assert.deepEqual(assessConformance(missing), [
      "missing_known_revision_history:console-action-required",
    ]);
    assert.deepEqual(repairRegistryCrash(missing), missingOriginal);

    const corrupt = resolveCase(fixture, structuredClone(rawCase));
    corrupt.obligations.unshift(structuredClone(corrupt.obligations[0]));
    const corruptOriginal = structuredClone(corrupt);
    assert.deepEqual(assessConformance(corrupt), [
      "corrupt_known_revision_history:console-action-required",
    ]);
    assert.deepEqual(repairRegistryCrash(corrupt), corruptOriginal);
  });

  it("does not repair registry-ahead state or mislabel failed markers as orphans", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const aheadRaw = fixture.cases.find(
      (testCase) => testCase.id === "registry-ahead-of-marker-fails",
    );
    const ahead = resolveCase(fixture, structuredClone(aheadRaw));
    assert.deepEqual(repairRegistryCrash(ahead), ahead);

    const mixedRaw = fixture.cases.find(
      (testCase) => testCase.id === "mixed-valid-invalid-markers-fail-closed",
    );
    const mixed = resolveCase(fixture, mixedRaw);
    const originalMixed = structuredClone(mixed);
    assert.deepEqual(assessConformance(mixed), [
      "invalid_obligation:console-action-required",
    ]);
    assert.deepEqual(repairRegistryCrash(mixed), originalMixed);
    assert.throws(
      () => reconcileProjections(mixed),
      /obligation conflict blocks reconciliation/,
    );

    const lagRaw = fixture.cases.find(
      (testCase) => testCase.id === "registry-lag-repairable",
    );
    const duplicateRegistry = resolveCase(fixture, structuredClone(lagRaw));
    duplicateRegistry.known_obligations.push({
      incident_slug: "console-action-required",
      last_known_revision: 0,
      duplicate_note: "preserve",
    });
    const duplicateOriginal = structuredClone(duplicateRegistry);
    assert.deepEqual(assessConformance(duplicateRegistry), [
      "duplicate_registry_record:console-action-required",
    ]);
    assert.doesNotMatch(
      assessConformance(duplicateRegistry).join("\n"),
      /recoverable_(?:first_marker_gap|registry_lag)/,
    );
    const repairedDuplicate = repairRegistryCrash(duplicateRegistry);
    assert.deepEqual(repairedDuplicate, duplicateOriginal);

    const unrepairableRaw = fixture.cases.find(
      (testCase) => testCase.id === "unrepairable-canonical-state-registry-lag",
    );
    const unrepairable = resolveCase(fixture, structuredClone(unrepairableRaw));
    assert.doesNotMatch(
      assessConformance(unrepairable).join("\n"),
      /recoverable_registry_lag/,
    );
    assert.deepEqual(repairRegistryCrash(unrepairable), unrepairable);
  });

  it("isolates duplicate registry ambiguity by canonical slug", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "multi-slug-repair-is-isolated",
    );
    const testCase = resolveCase(fixture, structuredClone(rawCase));
    testCase.obligations.find(
      (marker) =>
        marker.incident_slug === "second-console-action" &&
        marker.revision === 1,
    ).human_requirement = "production-console";
    testCase.known_obligations.push({
      incident_slug: "second-console-action",
      last_known_revision: 0,
      duplicate_note: "preserve",
    });
    const duplicateRecords = structuredClone(
      testCase.known_obligations.filter(
        (record) => record.incident_slug === "second-console-action",
      ),
    );

    const errors = assessConformance(testCase);
    assert.ok(
      errors.includes("duplicate_registry_record:second-console-action"),
    );
    assert.ok(
      errors.includes("recoverable_registry_lag:console-action-required"),
    );
    assert.ok(
      !errors.includes("recoverable_registry_lag:second-console-action"),
    );

    const repaired = repairRegistryCrash(testCase);
    assert.equal(repaired.known_obligations[0].last_known_revision, 2);
    assert.deepEqual(
      repaired.known_obligations.filter(
        (record) => record.incident_slug === "second-console-action",
      ),
      duplicateRecords,
    );
  });

  it("reports repeated duplicate registry records once per canonical slug", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "registry-lag-repairable",
    );
    const testCase = resolveCase(fixture, structuredClone(rawCase));
    const duplicate = {
      incident_slug: "console-action-required",
      last_known_revision: 0,
      duplicate_note: "preserve",
    };
    testCase.known_obligations.push(
      structuredClone(duplicate),
      { ...duplicate, duplicate_note: "also-preserve" },
    );

    assert.deepEqual(assessConformance(testCase), [
      "duplicate_registry_record:console-action-required",
    ]);
  });

  it("counts duplicate registry slugs even when a sibling record is malformed", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "multi-slug-repair-is-isolated",
    );
    const testCase = resolveCase(fixture, structuredClone(rawCase));
    const malformedDuplicate = {
      incident_slug: "second-console-action",
      last_known_revision: "invalid",
      duplicate_note: "preserve",
    };
    testCase.known_obligations.push(malformedDuplicate);
    const original = structuredClone(testCase);
    const duplicateRecords = original.known_obligations.filter(
      (record) => record.incident_slug === "second-console-action",
    );

    const errors = assessConformance(testCase);
    assert.equal(
      errors.filter(
        (error) =>
          error === "duplicate_registry_record:second-console-action",
      ).length,
      1,
    );
    assert.ok(
      errors.includes("invalid_registry_record:second-console-action"),
    );
    assert.ok(
      errors.includes("recoverable_registry_lag:console-action-required"),
    );
    assert.ok(
      !errors.includes("recoverable_registry_lag:second-console-action"),
    );
    const repaired = repairRegistryCrash(testCase);
    assert.equal(repaired.known_obligations[0].last_known_revision, 2);
    assert.deepEqual(
      repaired.known_obligations.filter(
        (record) => record.incident_slug === "second-console-action",
      ),
      duplicateRecords,
    );
    assert.deepEqual(repaired.obligations, original.obligations);
    assert.deepEqual(repaired.projections, original.projections);
  });

  it("does not mutate without a complete enabled profile declaration", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const rawCase = fixture.cases.find(
      (testCase) => testCase.id === "registry-lag-repairable",
    );
    const valid = resolveCase(fixture, structuredClone(rawCase));
    const invalidProfiles = [
      {
        ...structuredClone(valid.profile_config),
        enabled: false,
      },
      {
        ...structuredClone(valid.profile_config),
        authority: "",
      },
      {
        ...structuredClone(valid.profile_config),
        history_retention: null,
      },
    ];

    for (const profile_config of invalidProfiles) {
      const testCase = {
        ...structuredClone(valid),
        profile_config,
      };
      const original = structuredClone(testCase);
      assert.deepEqual(repairRegistryCrash(testCase), original);
      assert.deepEqual(reconcileProjections(testCase), original.projections);
      assert.deepEqual(testCase, original);
    }
  });

  it("treats malformed closure evidence as unusable without blocking safe repair diagnostics", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const closedRaw = fixture.cases.find(
      (testCase) => testCase.id === "verified-closure-permits-cleanup",
    );
    const closed = resolveCase(fixture, structuredClone(closedRaw));
    closed.closure_evidence = { malformed: true };
    assert.deepEqual(assessConformance(closed), [
      "missing_closure_evidence:console-action-required",
    ]);

    const repairRaw = fixture.cases.find(
      (testCase) => testCase.id === "registry-lag-repairable",
    );
    const repair = resolveCase(fixture, structuredClone(repairRaw));
    repair.closure_evidence = [null, "malformed"];
    assert.ok(
      assessConformance(repair).includes(
        "recoverable_registry_lag:console-action-required",
      ),
    );
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
