#!/usr/bin/env node
/**
 * Read-only inventory of schema-1 ownership evidence and its limits.
 *
 * Usage:
 *   node scripts/ownership-probe.mjs
 *   node scripts/ownership-probe.mjs --fixture <cases.json>
 */

import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCapsuleText } from "./lib/capsule.mjs";
import { parseFrontmatter } from "./lib/frontmatter.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_REAL = realpathSync(ROOT);
const DEFAULT_FIXTURE = path.join(
  ROOT,
  "fixtures",
  "ownership-probe",
  "cases.json",
);
const EXACT_SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIXTURE_FIELDS = new Set([
  "schema",
  "probe",
  "expected_consumer_state_sha256",
  "cases",
]);
const CASE_FIELDS = new Set(["id", "incident_path"]);

function fail(message) {
  throw new Error(`ownership evidence probe: ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function requireExactFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      fail(`${label}.${field} is not allowed`);
    }
  }
}

function requireNonemptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value, label) {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    fail(`${label} must be a non-empty string array`);
  }
  return value;
}

function resolveRepositoryFile(relativePath, label) {
  requireNonemptyString(relativePath, label);
  if (path.isAbsolute(relativePath)) {
    fail(`${label} must be repository-relative`);
  }
  const absolute = path.resolve(ROOT, relativePath);
  const relative = path.relative(ROOT, absolute);
  if (
    relative === ""
    || relative.startsWith("..")
    || path.isAbsolute(relative)
  ) {
    fail(`${label} escapes the repository`);
  }
  const metadata = lstatSync(absolute);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(`${label} must resolve to a regular file`);
  }
  const real = realpathSync(absolute);
  const realRelative = path.relative(ROOT_REAL, real);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    fail(`${label} resolves outside the repository`);
  }
  return { absolute, relative: relative.split(path.sep).join("/") };
}

function snapshotConsumerState(relativePaths) {
  const files = [...new Set(relativePaths)].sort().map((relativePath) => {
    const resolved = resolveRepositoryFile(relativePath, "incident_path");
    const bytes = readFileSync(resolved.absolute);
    return {
      path: resolved.relative,
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  });
  const inventory = files
    .map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`)
    .join("");
  return {
    sha256: sha256(inventory),
    files,
  };
}

function parseFixture(fixturePath) {
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch (error) {
    fail(`cannot parse fixture: ${error.message}`);
  }
  requireObject(fixture, "fixture");
  requireExactFields(fixture, FIXTURE_FIELDS, "fixture");
  if (fixture.schema !== 1) {
    fail(`fixture.schema must be 1, got ${fixture.schema}`);
  }
  if (fixture.probe !== "schema-1-ownership-evidence") {
    fail("fixture.probe must be schema-1-ownership-evidence");
  }
  if (!EXACT_SHA256.test(fixture.expected_consumer_state_sha256)) {
    fail("fixture.expected_consumer_state_sha256 must be 64 lowercase hex");
  }
  if (!Array.isArray(fixture.cases) || fixture.cases.length < 3) {
    fail("fixture.cases must contain at least three representative incidents");
  }
  return fixture;
}

function analyzeCase(caseValue, index) {
  const label = `fixture.cases[${index}]`;
  const scenario = requireObject(caseValue, label);
  requireExactFields(scenario, CASE_FIELDS, label);
  if (!SAFE_ID.test(requireNonemptyString(scenario.id, `${label}.id`))) {
    fail(`${label}.id must be a lowercase mechanical identifier`);
  }
  const resolved = resolveRepositoryFile(
    scenario.incident_path,
    `${label}.incident_path`,
  );
  const source = readFileSync(resolved.absolute, "utf8");
  const capsule = validateCapsuleText(source, {
    kind: "incident",
    filename: path.basename(resolved.absolute),
    today: new Date("2026-07-26T00:00:00.000Z"),
  });
  if (capsule.errors.length > 0) {
    fail(
      `${label}.incident_path is not a valid schema-1 incident: ${capsule.errors.join("; ")}`,
    );
  }
  const { fields } = parseFrontmatter(source);
  if (fields.schema !== "1") {
    fail(`${label}.incident_path must use schema 1`);
  }
  const coordinator = requireNonemptyString(
    fields.owner,
    `${label}.incident.owner`,
  );
  const requires = requireStringArray(
    fields.requires,
    `${label}.incident.requires`,
  );
  return {
    id: scenario.id,
    incident_path: resolved.relative,
    incident_id: fields.id,
    source_sha256: sha256(Buffer.from(source)),
    observed_schema: 1,
    observed_coordinator: coordinator,
    observed_requires: requires,
    structured_action_owner_present:
      Object.hasOwn(fields, "action_owner")
      || Object.hasOwn(fields, "coordinator"),
  };
}

export function runOwnershipProbe(fixturePath = DEFAULT_FIXTURE) {
  const fixture = parseFixture(path.resolve(fixturePath));
  const incidentPaths = fixture.cases.map((scenario) => scenario.incident_path);
  if (new Set(incidentPaths).size !== incidentPaths.length) {
    fail("fixture.cases must reference distinct representative incidents");
  }
  const caseIds = fixture.cases.map((scenario) => scenario.id);
  if (new Set(caseIds).size !== caseIds.length) {
    fail("fixture.cases must use unique ids");
  }

  const before = snapshotConsumerState(incidentPaths);
  if (before.sha256 !== fixture.expected_consumer_state_sha256) {
    fail(
      `consumer-state baseline drifted: expected ${fixture.expected_consumer_state_sha256}, got ${before.sha256}`,
    );
  }
  const cases = fixture.cases.map(analyzeCase);
  const after = snapshotConsumerState(incidentPaths);
  const unchanged =
    before.sha256 === after.sha256
    && JSON.stringify(before.files) === JSON.stringify(after.files);
  if (!unchanged) {
    fail("consumer state changed during the read-only probe");
  }

  return {
    schema: 1,
    probe: fixture.probe,
    decision: "defer_schema_2_insufficient_evidence",
    schema_v2_implementation_authorized: false,
    consumer_state: {
      before_sha256: before.sha256,
      after_sha256: after.sha256,
      unchanged,
      files: before.files,
    },
    observed_evidence: {
      representative_incidents: cases.length,
      schema_1_incidents: cases.filter(
        (scenario) => scenario.observed_schema === 1,
      ).length,
      coordinator_fields: cases.filter(
        (scenario) => scenario.observed_coordinator.length > 0,
      ).length,
      requires_lists: cases.filter(
        (scenario) => scenario.observed_requires.length > 0,
      ).length,
      structured_action_owner_fields: cases.filter(
        (scenario) => scenario.structured_action_owner_present,
      ).length,
    },
    evidence_gaps: {
      representative_receipt_provenance: {
        proven: false,
        reason:
          "The representative consumer artifacts include no authorized receipt history.",
      },
      authoritative_reassignment_order: {
        proven: false,
        reason:
          "No trusted receipt generation or host task order is present in the corpus.",
      },
      current_action_owner_authority: {
        proven: false,
        reason:
          "No representative evidence binds a current action actor to an authoritative assignment.",
      },
      verification_and_closure_actor_observation: {
        proven: false,
        reason:
          "The artifacts state coordinator responsibility but contain no observed actor history.",
      },
    },
    cases,
  };
}

function fixtureArgument(args) {
  const fixtureIndex = args.indexOf("--fixture");
  if (fixtureIndex === -1) return DEFAULT_FIXTURE;
  if (!args[fixtureIndex + 1]) fail("--fixture requires a path");
  return path.resolve(args[fixtureIndex + 1]);
}

function main() {
  const report = runOwnershipProbe(fixtureArgument(process.argv.slice(2)));
  console.log(JSON.stringify(report, null, 2));
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
