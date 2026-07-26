#!/usr/bin/env node
/**
 * Read-only compatibility probe for schema-1 incident coordination and receipt action ownership.
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
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCapsuleText } from "./lib/capsule.mjs";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { validateTerminalReceipt } from "./lib/receipt.mjs";
import { normalizeSignature } from "./lib/signature.mjs";

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
const CASE_FIELDS = new Set(["id", "incident_path", "expected", "events"]);
const EXPECTED_FIELDS = new Set([
  "coordinator",
  "action_owners",
  "current_action_owner",
  "verification_owner",
  "closure_owner",
  "query_receipts_by_action_owner",
]);
const EVENT_FIELDS = new Set([
  "receipt_id",
  "action_owner",
  "action",
  "evidence",
]);

function fail(message) {
  throw new Error(`ownership probe: ${message}`);
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
  if (lstatSync(absolute).isSymbolicLink() || !statSync(absolute).isFile()) {
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
  const fixtureFields = new Set([
    "schema",
    "probe",
    "expected_consumer_state_sha256",
    "cases",
  ]);
  requireExactFields(fixture, fixtureFields, "fixture");
  if (fixture.schema !== 1) {
    fail(`fixture.schema must be 1, got ${fixture.schema}`);
  }
  if (fixture.probe !== "schema-1-ownership-compatibility") {
    fail("fixture.probe must be schema-1-ownership-compatibility");
  }
  if (!EXACT_SHA256.test(fixture.expected_consumer_state_sha256)) {
    fail("fixture.expected_consumer_state_sha256 must be 64 lowercase hex");
  }
  if (!Array.isArray(fixture.cases) || fixture.cases.length < 3) {
    fail("fixture.cases must contain at least three representative incidents");
  }
  return fixture;
}

function buildReceipt(fields, event) {
  return {
    receipt_schema: 1,
    receipt_id: event.receipt_id,
    signature: normalizeSignature(fields.signature),
    dedupe_key: `ownership-probe|${fields.id}|${event.receipt_id}`,
    classification: "incident",
    evidence: [event.evidence],
    task_outcome: "incomplete",
    mechanism_health: "broken",
    containment: {
      used: false,
      summary: null,
      verification_gate: null,
    },
    terminal_outcome: "persisted_artifact",
    artifact_ref: fields.id,
    no_artifact_reason: null,
    proposed_artifact: null,
    escalation: {
      requires: fields.requires,
      target: event.action_owner,
      action: event.action,
    },
  };
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
    fail(`${label}.incident_path is not a valid schema-1 incident: ${capsule.errors.join("; ")}`);
  }
  const { fields } = parseFrontmatter(source);
  if (fields.schema !== "1") {
    fail(`${label}.incident_path must use schema 1`);
  }
  requireStringArray(fields.requires, `${label}.incident.requires`);

  const expected = requireObject(scenario.expected, `${label}.expected`);
  requireExactFields(expected, EXPECTED_FIELDS, `${label}.expected`);
  const coordinator = requireNonemptyString(
    expected.coordinator,
    `${label}.expected.coordinator`,
  );
  requireNonemptyString(
    expected.current_action_owner,
    `${label}.expected.current_action_owner`,
  );
  requireNonemptyString(
    expected.verification_owner,
    `${label}.expected.verification_owner`,
  );
  requireNonemptyString(
    expected.closure_owner,
    `${label}.expected.closure_owner`,
  );
  if (fields.owner !== coordinator) {
    fail(`${label} expected coordinator does not match incident owner`);
  }
  if (
    expected.verification_owner !== coordinator
    || expected.closure_owner !== coordinator
  ) {
    fail(`${label} verification and closure responsibility must remain with the coordinator`);
  }

  if (!Array.isArray(scenario.events) || scenario.events.length < 2) {
    fail(`${label}.events must contain at least two action-owner observations`);
  }
  const receipts = scenario.events.map((eventValue, eventIndex) => {
    const eventLabel = `${label}.events[${eventIndex}]`;
    const event = requireObject(eventValue, eventLabel);
    requireExactFields(event, EVENT_FIELDS, eventLabel);
    if (!SAFE_ID.test(requireNonemptyString(event.receipt_id, `${eventLabel}.receipt_id`))) {
      fail(`${eventLabel}.receipt_id must be a lowercase mechanical identifier`);
    }
    requireNonemptyString(event.action_owner, `${eventLabel}.action_owner`);
    requireNonemptyString(event.action, `${eventLabel}.action`);
    requireNonemptyString(event.evidence, `${eventLabel}.evidence`);
    const receipt = buildReceipt(fields, event);
    validateTerminalReceipt(receipt, `${eventLabel}.receipt`);
    return receipt;
  });

  const actionOwners = receipts.map((receipt) => receipt.escalation.target);
  if (
    JSON.stringify(actionOwners)
    !== JSON.stringify(
      requireStringArray(
        expected.action_owners,
        `${label}.expected.action_owners`,
      ),
    )
  ) {
    fail(`${label} action-owner history does not match expected history`);
  }
  const currentActionOwner = actionOwners.at(-1);
  if (currentActionOwner !== expected.current_action_owner) {
    fail(`${label} current action owner does not match the final receipt`);
  }

  const queryIndex = {};
  for (const receipt of receipts) {
    const owner = receipt.escalation.target;
    queryIndex[owner] ??= [];
    queryIndex[owner].push(receipt.receipt_id);
  }
  requireObject(
    expected.query_receipts_by_action_owner,
    `${label}.expected.query_receipts_by_action_owner`,
  );
  if (
    JSON.stringify(queryIndex)
    !== JSON.stringify(expected.query_receipts_by_action_owner)
  ) {
    fail(`${label} action-owner receipt query does not match expected results`);
  }

  return {
    id: scenario.id,
    incident_path: resolved.relative,
    incident_id: fields.id,
    source_sha256: sha256(Buffer.from(source)),
    coordinator,
    action_owners: actionOwners,
    current_action_owner: currentActionOwner,
    verification_owner: expected.verification_owner,
    closure_owner: expected.closure_owner,
    query_receipts_by_action_owner: queryIndex,
    receipt_ids: receipts.map((receipt) => receipt.receipt_id),
  };
}

export function runOwnershipProbe(
  fixturePath = DEFAULT_FIXTURE,
) {
  const resolvedFixture = path.resolve(fixturePath);
  const fixture = parseFixture(resolvedFixture);
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
  const receiptIds = cases.flatMap((scenario) => scenario.receipt_ids);
  if (new Set(receiptIds).size !== receiptIds.length) {
    fail("fixture events must use globally unique receipt ids");
  }
  const after = snapshotConsumerState(incidentPaths);
  const unchanged =
    before.sha256 === after.sha256
    && JSON.stringify(before.files) === JSON.stringify(after.files);
  if (!unchanged) {
    fail("consumer state changed during the read-only probe");
  }

  const criteria = {
    representative_incidents: {
      pass: cases.length >= 3,
      observed: cases.length,
      required: 3,
    },
    coordinator_action_distinction: {
      pass: cases.every((scenario) =>
        scenario.action_owners.some((owner) => owner !== scenario.coordinator)),
    },
    action_owner_reassignment: {
      pass: cases.every(
        (scenario) => new Set(scenario.action_owners).size > 1,
      ),
    },
    exact_action_owner_queryability: {
      pass: cases.every(
        (scenario) =>
          scenario.query_receipts_by_action_owner[
            scenario.current_action_owner
          ]?.at(-1) === scenario.receipt_ids.at(-1),
      ),
    },
    coordinator_verification_and_closure: {
      pass: cases.every(
        (scenario) =>
          scenario.verification_owner === scenario.coordinator
          && scenario.closure_owner === scenario.coordinator,
      ),
    },
    consumer_state_byte_identity: {
      pass: unchanged,
    },
  };
  if (Object.values(criteria).some((criterion) => criterion.pass !== true)) {
    fail("one or more schema-1 sufficiency criteria failed");
  }

  return {
    schema: 1,
    probe: fixture.probe,
    decision: "schema_1_plus_receipts_sufficient",
    consumer_state: {
      before_sha256: before.sha256,
      after_sha256: after.sha256,
      unchanged,
      files: before.files,
    },
    criteria,
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
