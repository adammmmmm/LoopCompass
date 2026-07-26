#!/usr/bin/env node
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
const fixtureIdentifier = /^[a-z0-9][a-z0-9._:|-]*$/;
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
  if (!fixtureIdentifier.test(value)) {
    throw new Error(`${label}.${field} must be a lowercase host-neutral identifier`);
  }
  return value;
}

function requireBoolean(obj, field, label) {
  const value = requireField(obj, field, label);
  if (typeof value !== "boolean") {
    throw new Error(`${label}.${field} must be boolean`);
  }
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
  requireString(doc, "benchmark", "fixture");
  requireObject(requireField(doc, "baseline", "fixture"), "fixture.baseline");
  requireExactFields(doc.baseline, "fixture.baseline", baselineFields);
  requireString(doc.baseline, "repository", "fixture.baseline");
  requireString(doc.baseline, "commit", "fixture.baseline");
  requireBoolean(doc, "live_integration_required", "fixture");
  requireString(doc, "description", "fixture");
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

  doc.cases.forEach((c, index) => {
    const label = `cases[${index}]`;
    requireObject(c, label);
    requireExactFields(c, label, caseFields);
    requireFixtureIdentifier(c, "id", label);
    requireString(c, "scenario", label);
    validateSanitizedProse(c.scenario, `${label}.scenario`);

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
    requireString(receipt, "failure", `${label}.receipt`);
    validateSanitizedProse(receipt.failure, `${label}.receipt.failure`);
    requireEnum(receipt, "classification", `${label}.receipt`, classifications);
    requireBoolean(receipt, "stale_rejected", `${label}.receipt`);
    requireNonnegativeInteger(receipt, "repeated_failure_attempts_before", `${label}.receipt`);
    requireNonnegativeInteger(receipt, "repeated_failure_attempts_after", `${label}.receipt`);
    requireNonnegativeIntegerOrNull(receipt, "steps_to_verified_normal_path", `${label}.receipt`);
    requireBoolean(receipt, "blind_retry", `${label}.receipt`);
    requireEnum(receipt, "terminal_outcome", `${label}.receipt`, receiptTerminalOutcomes);
    if (hasField(receipt, "terminal_receipt")) {
      if (receipt.terminal_receipt !== null) {
        validateTerminalReceipt(receipt.terminal_receipt, `${label}.receipt.terminal_receipt`);
        if (receipt.terminal_receipt.classification !== receipt.classification) {
          throw new Error(
            `${label}.receipt.terminal_receipt.classification must match ${label}.receipt.classification`,
          );
        }
        if (receipt.terminal_receipt.terminal_outcome !== receipt.terminal_outcome) {
          throw new Error(
            `${label}.receipt.terminal_receipt.terminal_outcome must match ${label}.receipt.terminal_outcome`,
          );
        }
        const childId = receipt.terminal_receipt.receipt_id;
        if (receiptIds.has(childId)) {
          throw new Error(
            `${label}.receipt.terminal_receipt.receipt_id duplicates ${receiptIds.get(childId)}`,
          );
        }
        receiptIds.set(childId, `${label}.receipt.terminal_receipt.receipt_id`);
      }
    }
    if (hasField(receipt, "parent_receipt") && receipt.parent_receipt !== null) {
      if (!receipt.terminal_receipt) {
        throw new Error(`${label}.receipt.parent_receipt requires terminal_receipt`);
      }
      if (receipt.terminal_receipt.terminal_outcome !== "proposed_artifact") {
        throw new Error(
          `${label}.receipt.parent_receipt requires a proposed_artifact terminal_receipt`,
        );
      }
      validateParentReceipt(
        receipt.parent_receipt,
        receipt.terminal_receipt,
        `${label}.receipt.parent_receipt`,
      );
      const parentId = receipt.parent_receipt.receipt_id;
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
    requireBoolean(expected, "false_trigger", `${label}.expected`);
    requireBoolean(expected, "stale_rejected", `${label}.expected`);
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
  });
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
  const doc = JSON.parse(readFileSync(fixturePath, "utf8"));
  validateFixture(doc);
  process.stdout.write(renderReport(doc));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
