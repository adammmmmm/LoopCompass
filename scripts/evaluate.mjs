#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  receiptPayloadDigest,
  validateSanitizedProse,
  validateParentReceipt,
  validateTerminalReceipt,
} from "./lib/receipt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const classifications = new Set(["recovery", "incident", "external", "none"]);
const expectedTerminalOutcomes = new Set([
  "persisted_artifact",
  "no_artifact",
  "proposed_artifact",
]);
const receiptTerminalOutcomes = new Set([...expectedTerminalOutcomes, "missing"]);
const agentRoles = new Set(["parent", "subagent-readonly"]);
const skillStates = new Set(["present", "missing"]);
const projectInstructionStates = new Set(["present", "inherited", "missing"]);
const receiptTypes = new Set(["synthetic", "recorded"]);
const candidateArtifactStatuses = new Set([
  "candidate",
  "verified",
  "stale",
  "superseded",
]);
const fixtureIdentifier = /^[a-z0-9][a-z0-9._:-]*$/;
const repositoryIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const fixtureLineBreakPattern = /[\r\n\u0085\u2028\u2029]/u;
const unsafeMarkdownPattern = /[\\`|<>\[\]]/u;
const allowedFixtureTokenPattern =
  /<(?:user-home|project-root|secret|id|hex|ts|path|email)>/gu;
const maximumFixtureIdentifierLength = 128;
const maximumFixtureProseLength = 512;
const maximumRepositoryIdentifierLength = 200;
const fixtureFields = new Set([
  "schema",
  "benchmark",
  "baseline",
  "live_integration_required",
  "description",
  "metrics",
  "cases",
]);
const baselineFields = new Set(["repository", "commit"]);
const caseFields = new Set(["id", "scenario", "scope", "receipt", "expected"]);
const scopeFields = new Set([
  "host",
  "agent_role",
  "skill_state",
  "project_instructions",
  "receipt_type",
]);
const receiptFields = new Set([
  "host",
  "consulted",
  "host_enforced",
  "failure",
  "classification",
  "applied_existing_artifact",
  "candidate_artifact_status",
  "stale_rejected",
  "repeated_failure_attempts_before",
  "repeated_failure_attempts_after",
  "steps_to_verified_normal_path",
  "blind_retry",
  "terminal_outcome",
  "terminal_receipt",
  "parent_receipt",
]);
const expectedFields = new Set([
  "consulted",
  "host_enforced",
  "classification",
  "false_trigger",
  "stale_rejected",
  "repeated_failure_reduced",
  "time_to_verified_normal_path_max_steps",
  "blind_retry",
  "terminal_outcome",
  "terminal_receipt_required",
  "terminal_receipt_semantics",
  "parent_receipt_required",
  "parent_receipt_semantics",
]);
const terminalSemanticsFields = new Set([
  "signature",
  "dedupe_key",
  "evidence",
  "task_outcome",
  "mechanism_health",
  "containment",
  "artifact_ref",
  "no_artifact_reason",
  "proposed_artifact",
  "escalation",
]);
const parentSemanticsFields = new Set([
  "terminal_action",
  "artifact_ref",
  "no_artifact_reason",
  "proposed_artifact",
  "escalation",
  "forwards_child_receipt",
]);
const requiredCorpusDigests = new Map([
  ["lc-eval-001-known-recovery", "73a64c059b72ccf21036cb4d03c0169d996876193ef60c239d87624d3417da14"],
  ["lc-eval-002-repairable-defect", "1e3cffd871579ccfff229649a3b8d9b236533be7041c0c8a726dee6ba92458bd"],
  ["lc-eval-003-expected-negative", "7285f3af4fd8d2ddb21c3dd5dd8c91ed0cc7ef4a469b5e4b089c57d4c7b771f7"],
  ["lc-eval-004-stale-recovery", "e8ea698fa6794c0b9794c1ec29043f07838c245509e76e6f0717f5a3417ef9d4"],
  ["lc-eval-005-blind-retry-regression", "c76021aeb04e594a571d1eeec616dc2757d627cd5629e98c4e3adddff9e44c5b"],
  ["lc-eval-006-external-limit", "a8dfa28d9db464948fb8a9b86461622a5c451c4edc6bf4f381a6fbc5fcc8f55d"],
  ["lc-eval-007-parent-policy", "14496d743e6d3ae289445df4b4d90a7c78428d0368748a12bf0851c59bbef631"],
  ["lc-eval-008-subagent-readonly-handoff", "2bfd43f85e6a96e55d468c672ca60381162af76d392cb208ad1b3bd175c952ea"],
  ["lc-eval-009-missing-skill-fallback", "d8915b6b8563e6c2ca0d79e3d74dc3f37137f9a0a7327cfd9c9cded1950c2236"],
  ["lc-eval-010-missing-project-instructions", "b3cfcb0393b900c9026a2ddd308b22175ebf145e301d2ebc4310b76b8fa7f198"],
  ["lc-eval-011-workaround-erases-classification", "c471bf5b8a1357d544234194ffffe4d4f0221f2f95b859ed6501a82630d8c97a"],
  ["lc-eval-012-workaround-is-containment", "e44ba5e440e5f3f448f6b3903d3a780c239c53551213e82d940aafc45dfc4390"],
  ["lc-eval-013-parent-without-store-propagates", "92c8c5b35ed038cd9452c3294ec6292774af52607f0f5f67d1cd09c01ad1b644"],
  ["lc-eval-014-parent-no-artifact", "018d5c692c9d763fc48c627f3020e0d7fe051069be5d2128b19738ccdfa32b60"],
  ["lc-eval-015-missing-parent-receipt", "e6dd54dee2702475d950955d14ca003d3f14764041c589e3cc9af7a75118d2ed"],
]);

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function corpusSemanticDigest(c) {
  const projection = {
    id: c.id,
    scope: {
      agent_role: c.scope.agent_role,
      skill_state: c.scope.skill_state,
      project_instructions: c.scope.project_instructions,
    },
    expected: c.expected,
  };
  return createHash("sha256").update(canonicalJson(projection)).digest("hex");
}

function usage() {
  return [
    "Usage: node scripts/evaluate.mjs --fixture <path>",
    "",
    "Generates a deterministic Markdown benchmark report from synthetic or recorded LoopCompass receipts.",
  ].join("\n");
}

function parseArgs(argv) {
  const fixtureIndex = argv.indexOf("--fixture");
  if (fixtureIndex === -1 || !argv[fixtureIndex + 1]) {
    throw new Error(usage());
  }
  return {
    fixture: argv[fixtureIndex + 1],
  };
}

function rejectDuplicateJsonKeys(source) {
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/u.test(source[index] ?? "")) {
      index += 1;
    }
  };
  const scanString = () => {
    const start = index;
    index += 1;
    let escaped = false;
    while (index < source.length) {
      const character = source[index];
      index += 1;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        return JSON.parse(source.slice(start, index));
      }
    }
    throw new Error("fixture JSON contains an unterminated string");
  };
  const scanValue = () => {
    skipWhitespace();
    if (source[index] === "{") {
      scanObject();
      return;
    }
    if (source[index] === "[") {
      index += 1;
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      while (index < source.length) {
        scanValue();
        skipWhitespace();
        if (source[index] === "]") {
          index += 1;
          return;
        }
        if (source[index] !== ",") {
          throw new Error("fixture JSON array is malformed");
        }
        index += 1;
      }
      throw new Error("fixture JSON array is unterminated");
    }
    if (source[index] === '"') {
      scanString();
      return;
    }
    const start = index;
    while (
      index < source.length
      && !/[\s,\]}]/u.test(source[index])
    ) {
      index += 1;
    }
    if (index === start) {
      throw new Error("fixture JSON value is malformed");
    }
  };
  const scanObject = () => {
    index += 1;
    const keys = new Set();
    skipWhitespace();
    if (source[index] === "}") {
      index += 1;
      return;
    }
    while (index < source.length) {
      skipWhitespace();
      if (source[index] !== '"') {
        throw new Error("fixture JSON object key must be a string");
      }
      const key = scanString();
      if (keys.has(key)) {
        throw new Error("fixture JSON contains a duplicate object key");
      }
      keys.add(key);
      skipWhitespace();
      if (source[index] !== ":") {
        throw new Error("fixture JSON object is missing a colon");
      }
      index += 1;
      scanValue();
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      if (source[index] !== ",") {
        throw new Error("fixture JSON object is malformed");
      }
      index += 1;
    }
    throw new Error("fixture JSON object is unterminated");
  };

  scanValue();
  skipWhitespace();
  if (index !== source.length) {
    throw new Error("fixture JSON has trailing content");
  }
}

function percent(numerator, denominator) {
  if (denominator === 0) {
    return "N/A";
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function ratio(numerator, denominator) {
  return `${numerator}/${denominator}`;
}

function countMatches(cases, field) {
  return cases.filter((c) => c.receipt?.[field] === c.expected?.[field]).length;
}

function observedTerminalOutcome(c) {
  return c.receipt?.terminal_receipt?.terminal_outcome
    ?? c.receipt?.terminal_outcome
    ?? "missing";
}

function terminalOutcomeMatches(c) {
  return observedTerminalOutcome(c) === c.expected?.terminal_outcome;
}

function countMatchesWhenConsulted(cases, field) {
  const consulted = cases.filter((c) => c.receipt?.consulted === true);
  const matched = consulted.filter((c) => c.receipt?.[field] === c.expected?.[field]);
  return [matched.length, consulted.length];
}

function hostName(c) {
  return c.receipt?.host ?? c.scope?.host ?? "unknown";
}

function consultationRecall(cases) {
  const expected = cases.filter((c) => c.expected?.consulted === true);
  const matched = expected.filter((c) => c.receipt?.consulted === true);
  return [matched.length, expected.length];
}

function hostEnforcementQuality(cases) {
  const matched = countMatches(cases, "host_enforced");
  return [matched, cases.length];
}

function falseTriggerRate(cases) {
  const expectedNoConsult = cases.filter((c) => c.expected?.consulted === false);
  const triggered = expectedNoConsult.filter((c) => c.receipt?.consulted === true);
  return [triggered.length, expectedNoConsult.length];
}

function blindRetryRate(cases) {
  const blindRetries = cases.filter((c) => c.receipt?.blind_retry === true);
  return [blindRetries.length, cases.length];
}

function staleRejectionRate(cases) {
  const expected = cases.filter((c) => c.expected?.stale_rejected === true);
  const matched = expected.filter((c) => c.receipt?.stale_rejected === true);
  return [matched.length, expected.length];
}

function repeatedFailureReduction(cases) {
  const expected = cases.filter((c) => c.expected?.repeated_failure_reduced === true);
  const matched = expected.filter((c) => {
    const before = c.receipt?.repeated_failure_attempts_before;
    const after = c.receipt?.repeated_failure_attempts_after;
    return (
      c.receipt?.consulted === true
      && Number.isFinite(before)
      && Number.isFinite(after)
      && after < before
    );
  });
  return [matched.length, expected.length];
}

function timeToVerifiedNormalPath(cases) {
  const expected = cases.filter((c) =>
    Number.isFinite(c.expected?.time_to_verified_normal_path_max_steps),
  );
  const matched = expected.filter((c) => {
    const steps = c.receipt?.steps_to_verified_normal_path;
    const maxSteps = c.expected?.time_to_verified_normal_path_max_steps;
    return (
      c.receipt?.consulted === true
      && Number.isFinite(steps)
      && steps <= maxSteps
    );
  });
  return [matched.length, expected.length];
}

function classificationPass(c) {
  if (c.receipt?.consulted !== true) {
    return "n/a";
  }
  return c.receipt?.classification === c.expected?.classification ? "pass" : "fail";
}

function skillDecisionPass(c) {
  if (c.receipt?.consulted !== true) {
    return null;
  }
  const classification =
    c.receipt?.classification === c.expected?.classification;
  const terminal = terminalOutcomeMatches(c);
  const stale =
    (c.receipt?.stale_rejected === true) === (c.expected?.stale_rejected === true);
  const receiptSemantics = terminalReceiptSemanticsPass(c);
  const parentSemantics = parentReceiptSemanticsPass(c);
  return classification
    && terminal
    && stale
    && receiptSemantics !== false
    && parentSemantics !== false;
}

function terminalSemanticProjection(receipt) {
  return {
    signature: receipt.signature,
    dedupe_key: receipt.dedupe_key,
    evidence: receipt.evidence,
    task_outcome: receipt.task_outcome,
    mechanism_health: receipt.mechanism_health,
    containment: receipt.containment,
    artifact_ref: receipt.artifact_ref,
    no_artifact_reason: receipt.no_artifact_reason,
    proposed_artifact: receipt.proposed_artifact,
    escalation: receipt.escalation,
  };
}

function terminalReceiptSemanticsPass(c) {
  const expected = c.expected?.terminal_receipt_semantics;
  if (!expected) {
    return null;
  }
  const actual = c.receipt?.terminal_receipt;
  if (!actual) {
    return false;
  }
  return isDeepStrictEqual(terminalSemanticProjection(actual), expected);
}

function parentSemanticProjection(receipt) {
  return {
    terminal_action: receipt.terminal_action,
    artifact_ref: receipt.artifact_ref,
    no_artifact_reason: receipt.no_artifact_reason,
    proposed_artifact: receipt.proposed_artifact,
    escalation: receipt.escalation,
    forwards_child_receipt: receipt.forwarded_receipt !== null,
  };
}

function parentReceiptSemanticsPass(c) {
  const expected = c.expected?.parent_receipt_semantics;
  if (!expected) {
    return null;
  }
  const actual = c.receipt?.parent_receipt;
  if (!actual) {
    return false;
  }
  return isDeepStrictEqual(parentSemanticProjection(actual), expected);
}

function receiptCompleteness(cases) {
  const required = cases.filter((c) => c.expected?.terminal_receipt_required === true);
  const complete = required.filter(
    (c) => c.receipt?.terminal_receipt !== null
      && typeof c.receipt?.terminal_receipt === "object",
  );
  return [complete.length, required.length];
}

function receiptSemantics(cases) {
  const required = cases.filter((c) => c.expected?.terminal_receipt_semantics);
  const matched = required.filter((c) => terminalReceiptSemanticsPass(c) === true);
  return [matched.length, required.length];
}

function parentClosure(cases) {
  const required = cases.filter((c) => c.expected?.parent_receipt_required === true);
  const matched = required.filter((c) => parentReceiptSemanticsPass(c) === true);
  return [matched.length, required.length];
}

function skillDecisionQuality(cases) {
  const decisions = cases.map(skillDecisionPass).filter((v) => v !== null);
  const matched = decisions.filter(Boolean);
  return [matched.length, decisions.length];
}

function terminalOutcomeCompliance(cases) {
  return [cases.filter(terminalOutcomeMatches).length, cases.length];
}

const metricRegistry = Object.freeze([
  ["consultation_recall", "Consultation recall", consultationRecall],
  ["host_enforcement_quality", "Host enforcement quality", hostEnforcementQuality],
  ["skill_decision_quality", "Skill decision quality", skillDecisionQuality],
  [
    "classification_accuracy_when_consulted",
    "Classification accuracy when consulted",
    (cases) => countMatchesWhenConsulted(cases, "classification"),
  ],
  ["false_trigger_rate", "False trigger rate", falseTriggerRate],
  ["stale_rejection_rate", "Stale rejection rate", staleRejectionRate],
  ["repeated_failure_reduction", "Repeated-failure reduction", repeatedFailureReduction],
  ["blind_retry_rate", "Blind retry rate", blindRetryRate],
  ["time_to_verified_normal_path", "Time to verified normal path", timeToVerifiedNormalPath],
  [
    "terminal_outcome_compliance",
    "Terminal outcome compliance",
    terminalOutcomeCompliance,
  ],
  ["terminal_receipt_completeness", "Terminal receipt completeness", receiptCompleteness],
  [
    "terminal_receipt_semantic_accuracy",
    "Terminal receipt semantic accuracy",
    receiptSemantics,
  ],
  ["worker_to_parent_closure", "Worker-to-parent closure", parentClosure],
]);

function metricRow(name, numerator, denominator) {
  return `| ${name} | ${ratio(numerator, denominator)} | ${percent(numerator, denominator)} |`;
}

function hostRows(cases) {
  const byHost = new Map();
  for (const c of cases) {
    const host = hostName(c);
    byHost.set(host, [...(byHost.get(host) ?? []), c]);
  }
  return [...byHost.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, hostCases]) => {
      const [hostMatched, hostTotal] = hostEnforcementQuality(hostCases);
      const [skillMatched, skillTotal] = skillDecisionQuality(hostCases);
      return `| ${host} | ${hostCases.length} | ${ratio(hostMatched, hostTotal)} (${percent(hostMatched, hostTotal)}) | ${ratio(skillMatched, skillTotal)} (${percent(skillMatched, skillTotal)}) |`;
    });
}

function receiptTypeWatermark(cases) {
  const present = ["synthetic", "recorded"].filter((type) =>
    cases.some((c) => c.scope?.receipt_type === type),
  );
  const types = present.length === 0 ? "none" : present.join(" and ");
  return `> Receipt types: ${types}. Not live-host evidence absent an explicit live-run protocol.`;
}

function hasField(obj, field) {
  return Object.prototype.hasOwnProperty.call(obj, field);
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireExactFields(value, label, allowed) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error(`${label}.${field} is not allowed`);
    }
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

function requireObjectOrNull(obj, field, label) {
  const value = requireField(obj, field, label);
  if (value === null) {
    return null;
  }
  return requireObject(value, `${label}.${field}`);
}

function requireField(obj, field, label) {
  if (!hasField(obj, field)) {
    throw new Error(`${label}.${field} is required`);
  }
  return obj[field];
}

function requireString(obj, field, label) {
  const value = requireField(obj, field, label);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${field} must be a non-empty string`);
  }
  return value;
}

function requireFixtureIdentifier(obj, field, label) {
  const value = requireString(obj, field, label);
  validateSanitizedProse(value, `${label}.${field}`);
  if (
    value.length > maximumFixtureIdentifierLength
    || !fixtureIdentifier.test(value)
  ) {
    throw new Error(
      `${label}.${field} must be a lowercase host-neutral identifier of at most ${maximumFixtureIdentifierLength} characters`,
    );
  }
  return value;
}

function requireFixtureProse(obj, field, label) {
  const value = requireString(obj, field, label);
  validateSanitizedProse(value, `${label}.${field}`);
  const markdownProbe = value.replace(allowedFixtureTokenPattern, "");
  if (
    value.length > maximumFixtureProseLength
    || fixtureLineBreakPattern.test(value)
    || unsafeMarkdownPattern.test(markdownProbe)
  ) {
    throw new Error(
      `${label}.${field} must be one non-Markdown line of at most ${maximumFixtureProseLength} characters`,
    );
  }
  return value;
}

function requireRepositoryIdentifier(obj, field, label) {
  const value = requireString(obj, field, label);
  validateSanitizedProse(value, `${label}.${field}`);
  if (
    value.length > maximumRepositoryIdentifierLength
    || !repositoryIdentifier.test(value)
  ) {
    throw new Error(
      `${label}.${field} must be an owner/repository identifier of at most ${maximumRepositoryIdentifierLength} characters`,
    );
  }
  return value;
}

function requireCommitDigest(obj, field, label) {
  const value = requireString(obj, field, label);
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${label}.${field} must be a lowercase 40-character Git commit`);
  }
  return value;
}

function requireBoolean(obj, field, label) {
  const value = requireField(obj, field, label);
  if (typeof value !== "boolean") {
    throw new Error(`${label}.${field} must be boolean`);
  }
  return value;
}

function requireNullableBoolean(obj, field, label) {
  const value = requireField(obj, field, label);
  if (value !== null && typeof value !== "boolean") {
    throw new Error(`${label}.${field} must be boolean or null`);
  }
  return value;
}

function requireNonnegativeInteger(obj, field, label) {
  const value = requireField(obj, field, label);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label}.${field} must be a nonnegative integer`);
  }
}

function requireNonnegativeIntegerOrNull(obj, field, label) {
  const value = requireField(obj, field, label);
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`${label}.${field} must be a nonnegative integer or null`);
  }
}

function requireEnum(obj, field, label, allowed) {
  const value = requireField(obj, field, label);
  if (!allowed.has(value)) {
    throw new Error(`${label}.${field} must be one of ${[...allowed].join(", ")}`);
  }
  return value;
}

function requireNullableEnum(obj, field, label, allowed) {
  const value = requireField(obj, field, label);
  if (value !== null && !allowed.has(value)) {
    throw new Error(
      `${label}.${field} must be null or one of ${[...allowed].join(", ")}`,
    );
  }
  return value;
}

function expectedTerminalReceipt(c, semantics) {
  return {
    receipt_schema: 1,
    receipt_id: "expected-terminal-receipt",
    signature: semantics.signature,
    dedupe_key: semantics.dedupe_key,
    classification: c.expected.classification,
    evidence: structuredClone(semantics.evidence),
    ...structuredClone(semantics),
    terminal_outcome: c.expected.terminal_outcome,
  };
}

function validateExpectedTerminalSemantics(c, semantics, label) {
  requireExactFields(semantics, label, terminalSemanticsFields);
  validateTerminalReceipt(expectedTerminalReceipt(c, semantics), label);
}

function validateExpectedParentSemantics(c, semantics, label) {
  requireExactFields(semantics, label, parentSemanticsFields);
  if (!c.expected.terminal_receipt_semantics) {
    throw new Error(`${label} requires expected terminal_receipt_semantics`);
  }
  const child = expectedTerminalReceipt(c, c.expected.terminal_receipt_semantics);
  if (child.terminal_outcome !== "proposed_artifact") {
    throw new Error(`${label} requires expected terminal_outcome proposed_artifact`);
  }
  requireBoolean(semantics, "forwards_child_receipt", label);
  const parent = {
    receipt_schema: 1,
    receipt_id: "expected-parent-receipt",
    child_receipt_id: child.receipt_id,
    child_payload_sha256: receiptPayloadDigest(child),
    ingested: true,
    terminal_action: semantics.terminal_action,
    artifact_ref: semantics.artifact_ref,
    no_artifact_reason: semantics.no_artifact_reason,
    proposed_artifact: structuredClone(semantics.proposed_artifact),
    escalation: structuredClone(semantics.escalation),
    forwarded_receipt: semantics.forwards_child_receipt ? structuredClone(child) : null,
  };
  validateParentReceipt(parent, child, label);
}

function validateFixture(doc) {
  requireObject(doc, "fixture");
  requireExactFields(doc, "fixture", fixtureFields);
  if (doc.schema !== 1) {
    throw new Error("fixture.schema must be 1");
  }
  requireFixtureIdentifier(doc, "benchmark", "fixture");
  requireObject(requireField(doc, "baseline", "fixture"), "fixture.baseline");
  requireExactFields(doc.baseline, "fixture.baseline", baselineFields);
  requireRepositoryIdentifier(doc.baseline, "repository", "fixture.baseline");
  requireCommitDigest(doc.baseline, "commit", "fixture.baseline");
  requireBoolean(doc, "live_integration_required", "fixture");
  requireFixtureProse(doc, "description", "fixture");
  const metrics = requireField(doc, "metrics", "fixture");
  requireArray(metrics, "fixture.metrics");
  const expectedMetricIds = metricRegistry.map(([id]) => id);
  if (
    metrics.length !== expectedMetricIds.length
    || metrics.some((metric, index) => metric !== expectedMetricIds[index])
  ) {
    throw new Error(
      `fixture.metrics must exactly match the ordered metric registry: ${expectedMetricIds.join(", ")}`,
    );
  }
  requireArray(requireField(doc, "cases", "fixture"), "fixture.cases");
  const receiptIds = new Map();
  const caseIds = new Map();
  const casesById = new Map();

  doc.cases.forEach((c, index) => {
    const label = `cases[${index}]`;
    requireObject(c, label);
    requireExactFields(c, label, caseFields);
    const caseId = requireFixtureIdentifier(c, "id", label);
    if (caseIds.has(caseId)) {
      throw new Error(`${label}.id duplicates ${caseIds.get(caseId)}`);
    }
    caseIds.set(caseId, `${label}.id`);
    casesById.set(caseId, c);
    requireFixtureProse(c, "scenario", label);

    const scope = requireField(c, "scope", label);
    requireObject(scope, `${label}.scope`);
    requireExactFields(scope, `${label}.scope`, scopeFields);
    requireFixtureIdentifier(scope, "host", `${label}.scope`);
    requireEnum(scope, "agent_role", `${label}.scope`, agentRoles);
    requireEnum(scope, "skill_state", `${label}.scope`, skillStates);
    requireEnum(scope, "project_instructions", `${label}.scope`, projectInstructionStates);
    requireEnum(scope, "receipt_type", `${label}.scope`, receiptTypes);

    const receipt = requireField(c, "receipt", label);
    requireObject(receipt, `${label}.receipt`);
    requireExactFields(receipt, `${label}.receipt`, receiptFields);
    requireFixtureIdentifier(receipt, "host", `${label}.receipt`);
    if (receipt.host !== scope.host) {
      throw new Error(`${label}.receipt.host must match ${label}.scope.host`);
    }
    requireBoolean(receipt, "consulted", `${label}.receipt`);
    requireBoolean(receipt, "host_enforced", `${label}.receipt`);
    requireFixtureProse(receipt, "failure", `${label}.receipt`);
    requireEnum(receipt, "classification", `${label}.receipt`, classifications);
    if (hasField(receipt, "applied_existing_artifact")) {
      requireNullableBoolean(
        receipt,
        "applied_existing_artifact",
        `${label}.receipt`,
      );
    }
    const candidateArtifactStatus = hasField(receipt, "candidate_artifact_status")
      ? requireNullableEnum(
        receipt,
        "candidate_artifact_status",
        `${label}.receipt`,
        candidateArtifactStatuses,
      )
      : null;
    const staleRejected = requireBoolean(
      receipt,
      "stale_rejected",
      `${label}.receipt`,
    );
    if (staleRejected && candidateArtifactStatus !== "stale") {
      throw new Error(
        `${label}.receipt.stale_rejected true requires candidate_artifact_status stale`,
      );
    }
    requireNonnegativeInteger(receipt, "repeated_failure_attempts_before", `${label}.receipt`);
    requireNonnegativeInteger(receipt, "repeated_failure_attempts_after", `${label}.receipt`);
    requireNonnegativeIntegerOrNull(receipt, "steps_to_verified_normal_path", `${label}.receipt`);
    requireBoolean(receipt, "blind_retry", `${label}.receipt`);
    requireEnum(receipt, "terminal_outcome", `${label}.receipt`, receiptTerminalOutcomes);
    const terminalReceipt = requireObjectOrNull(
      receipt,
      "terminal_receipt",
      `${label}.receipt`,
    );
    const parentReceipt = requireObjectOrNull(
      receipt,
      "parent_receipt",
      `${label}.receipt`,
    );
    if (terminalReceipt !== null) {
      validateTerminalReceipt(terminalReceipt, `${label}.receipt.terminal_receipt`);
      if (terminalReceipt.classification !== receipt.classification) {
        throw new Error(
          `${label}.receipt.terminal_receipt.classification must match ${label}.receipt.classification`,
        );
      }
      if (terminalReceipt.terminal_outcome !== receipt.terminal_outcome) {
        throw new Error(
          `${label}.receipt.terminal_receipt.terminal_outcome must match ${label}.receipt.terminal_outcome`,
        );
      }
      const childId = terminalReceipt.receipt_id;
      if (receiptIds.has(childId)) {
        throw new Error(
          `${label}.receipt.terminal_receipt.receipt_id duplicates ${receiptIds.get(childId)}`,
        );
      }
      receiptIds.set(childId, `${label}.receipt.terminal_receipt.receipt_id`);
    }
    if (parentReceipt !== null) {
      if (terminalReceipt === null) {
        throw new Error(`${label}.receipt.parent_receipt requires terminal_receipt`);
      }
      if (terminalReceipt.terminal_outcome !== "proposed_artifact") {
        throw new Error(
          `${label}.receipt.parent_receipt requires a proposed_artifact terminal_receipt`,
        );
      }
      validateParentReceipt(
        parentReceipt,
        terminalReceipt,
        `${label}.receipt.parent_receipt`,
      );
      const parentId = parentReceipt.receipt_id;
      if (receiptIds.has(parentId)) {
        throw new Error(
          `${label}.receipt.parent_receipt.receipt_id duplicates ${receiptIds.get(parentId)}`,
        );
      }
      receiptIds.set(parentId, `${label}.receipt.parent_receipt.receipt_id`);
    }

    const expected = requireField(c, "expected", label);
    requireObject(expected, `${label}.expected`);
    requireExactFields(expected, `${label}.expected`, expectedFields);
    requireBoolean(expected, "consulted", `${label}.expected`);
    requireBoolean(expected, "host_enforced", `${label}.expected`);
    const expectedClassification = requireEnum(
      expected,
      "classification",
      `${label}.expected`,
      classifications,
    );
    const expectedFalseTrigger = requireBoolean(
      expected,
      "false_trigger",
      `${label}.expected`,
    );
    if (
      expectedFalseTrigger
      && !(expected.consulted === false && receipt.consulted === true)
    ) {
      throw new Error(
        `${label}.expected.false_trigger true requires consultation when consultation was not expected`,
      );
    }
    const expectedStaleRejected = requireBoolean(
      expected,
      "stale_rejected",
      `${label}.expected`,
    );
    if (expectedStaleRejected !== (candidateArtifactStatus === "stale")) {
      throw new Error(
        `${label}.expected.stale_rejected must match candidate_artifact_status stale`,
      );
    }
    requireBoolean(expected, "repeated_failure_reduced", `${label}.expected`);
    if (hasField(expected, "time_to_verified_normal_path_max_steps")) {
      requireNonnegativeInteger(expected, "time_to_verified_normal_path_max_steps", `${label}.expected`);
    }
    requireBoolean(expected, "blind_retry", `${label}.expected`);
    const expectedOutcome = requireEnum(
      expected,
      "terminal_outcome",
      `${label}.expected`,
      expectedTerminalOutcomes,
    );
    if (
      (expectedClassification === "none")
      !== (expectedOutcome === "no_artifact")
    ) {
      throw new Error(
        `${label}.expected classification none and terminal_outcome no_artifact must occur together`,
      );
    }
    requireBoolean(expected, "terminal_receipt_required", `${label}.expected`);
    requireBoolean(expected, "parent_receipt_required", `${label}.expected`);
    const classificationRequiresReceipt = expected.classification !== "none";
    if (expected.terminal_receipt_required !== classificationRequiresReceipt) {
      throw new Error(
        `${label}.expected.terminal_receipt_required must be ${classificationRequiresReceipt} for classification ${expected.classification}`,
      );
    }
    if (
      receipt.terminal_receipt !== null
      && typeof receipt.terminal_receipt === "object"
      && expected.terminal_receipt_required !== true
    ) {
      throw new Error(
        `${label}.expected.terminal_receipt_required must be true when terminal_receipt is present`,
      );
    }
    if (
      expected.terminal_receipt_required === true
      && !hasField(expected, "terminal_receipt_semantics")
    ) {
      throw new Error(
        `${label}.expected.terminal_receipt_semantics is required when terminal_receipt_required is true`,
      );
    }
    if (hasField(expected, "terminal_receipt_semantics")) {
      const semantics = expected.terminal_receipt_semantics;
      requireObject(semantics, `${label}.expected.terminal_receipt_semantics`);
      validateExpectedTerminalSemantics(
        c,
        semantics,
        `${label}.expected.terminal_receipt_semantics`,
      );
      if (expected.terminal_receipt_required !== true) {
        throw new Error(
          `${label}.expected.terminal_receipt_semantics requires terminal_receipt_required: true`,
        );
      }
    }
    if (
      receipt.parent_receipt !== null
      && typeof receipt.parent_receipt === "object"
      && !hasField(expected, "parent_receipt_semantics")
    ) {
      throw new Error(
        `${label}.expected.parent_receipt_semantics is required when parent_receipt is present`,
      );
    }
    if (hasField(expected, "parent_receipt_semantics")) {
      const parentSemantics = expected.parent_receipt_semantics;
      requireObject(parentSemantics, `${label}.expected.parent_receipt_semantics`);
      validateExpectedParentSemantics(
        c,
        parentSemantics,
        `${label}.expected.parent_receipt_semantics`,
      );
      if (expected.parent_receipt_required !== true) {
        throw new Error(
          `${label}.expected.parent_receipt_semantics requires parent_receipt_required: true`,
        );
      }
    }
    if (
      expected.parent_receipt_required === true
      && !hasField(expected, "parent_receipt_semantics")
    ) {
      throw new Error(
        `${label}.expected.parent_receipt_semantics is required when parent_receipt_required is true`,
      );
    }
    if (
      receipt.parent_receipt !== null
      && typeof receipt.parent_receipt === "object"
      && expected.parent_receipt_required !== true
    ) {
      throw new Error(
        `${label}.expected.parent_receipt_required must be true when parent_receipt is present`,
      );
    }
    if (expected.terminal_outcome === "proposed_artifact") {
      if (
        expected.terminal_receipt_required !== true
        || expected.parent_receipt_required !== true
      ) {
        throw new Error(
          `${label}.expected proposed_artifact requires terminal_receipt_required and parent_receipt_required`,
        );
      }
    }
    if (
      scope.agent_role === "subagent-readonly"
      && (
        expectedOutcome !== "proposed_artifact"
        || expected.terminal_receipt_required !== true
        || !hasField(expected, "terminal_receipt_semantics")
        || expected.parent_receipt_required !== true
        || !hasField(expected, "parent_receipt_semantics")
      )
    ) {
      throw new Error(
        `${label}.scope.agent_role subagent-readonly requires expected proposed_artifact, terminal semantics, and parent closure`,
      );
    }
  });
  if (caseIds.size !== requiredCorpusDigests.size) {
    throw new Error(
      `fixture.cases must contain exactly the ${requiredCorpusDigests.size} evaluator-owned cases`,
    );
  }
  for (const [caseId, expectedDigest] of requiredCorpusDigests) {
    const corpusCase = casesById.get(caseId);
    if (!corpusCase) {
      throw new Error(
        `fixture.cases is missing required evaluator-owned case ${caseId}`,
      );
    }
    if (corpusSemanticDigest(corpusCase) !== expectedDigest) {
      throw new Error(
        `fixture.cases case ${caseId} does not match evaluator-owned semantic ground truth`,
      );
    }
  }
}

function renderReport(doc) {
  const cases = doc.cases ?? [];

  return [
    "# LoopCompass benchmark report",
    "",
    receiptTypeWatermark(cases),
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Benchmark | ${doc.benchmark} |`,
    `| Baseline commit | ${doc.baseline?.commit ?? ""} |`,
    `| Cases | ${cases.length} |`,
    `| Live integration required | ${String(doc.live_integration_required)} |`,
    "",
    "| Metric | Result | Percent |",
    "| --- | --- | --- |",
    ...metricRegistry.map(([, label, measure]) => {
      const [numerator, denominator] = measure(cases);
      return metricRow(label, numerator, denominator);
    }),
    "",
    "## Host versus skill breakdown",
    "",
    "| Host | Cases | Host enforcement | Skill decision quality when consulted |",
    "| --- | --- | --- | --- |",
    ...hostRows(cases),
    "",
    "## Case outcomes",
    "",
    "| Case | Host | Host enforced | Skill decision | Classification | Terminal outcome | Receipt | Receipt semantics | Parent closure | Consulted | Blind retry |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...cases.map((c) => {
      const hostEnforced =
        c.receipt?.host_enforced === c.expected?.host_enforced ? "pass" : "fail";
      const skillDecision = skillDecisionPass(c);
      const skill = skillDecision === null ? "n/a" : skillDecision ? "pass" : "fail";
      const classification = classificationPass(c);
      const terminal = terminalOutcomeMatches(c) ? "pass" : "fail";
      const receipt = c.expected?.terminal_receipt_required === true
        ? c.receipt?.terminal_receipt !== null
          && typeof c.receipt?.terminal_receipt === "object"
          ? "pass"
          : "fail"
        : "n/a";
      const semantics = terminalReceiptSemanticsPass(c);
      const receiptSemantics = semantics === null ? "n/a" : semantics ? "pass" : "fail";
      const parentSemantics = parentReceiptSemanticsPass(c);
      const parent = parentSemantics === null ? "n/a" : parentSemantics ? "pass" : "fail";
      const consulted = c.receipt?.consulted === c.expected?.consulted ? "pass" : "fail";
      const blindRetry = c.receipt?.blind_retry === c.expected?.blind_retry ? "pass" : "fail";
      return `| ${c.id} | ${hostName(c)} | ${hostEnforced} | ${skill} | ${classification} | ${terminal} | ${receipt} | ${receiptSemantics} | ${parent} | ${consulted} | ${blindRetry} |`;
    }),
    "",
  ].join("\n");
}

try {
  const { fixture } = parseArgs(args);
  const fixturePath = path.resolve(root, fixture);
  const fixtureSource = readFileSync(fixturePath, "utf8");
  rejectDuplicateJsonKeys(fixtureSource);
  const doc = JSON.parse(fixtureSource);
  validateFixture(doc);
  process.stdout.write(renderReport(doc));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
