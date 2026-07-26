#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  receiptPayloadDigest,
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
const terminalSemanticsFields = new Set([
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
  const required = cases.filter((c) => c.expected?.parent_receipt_semantics);
  const matched = required.filter((c) => parentReceiptSemanticsPass(c) === true);
  return [matched.length, required.length];
}

function skillDecisionQuality(cases) {
  const decisions = cases.map(skillDecisionPass).filter((v) => v !== null);
  const matched = decisions.filter(Boolean);
  return [matched.length, decisions.length];
}

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
}

function expectedTerminalReceipt(c, semantics) {
  return {
    receipt_schema: 1,
    receipt_id: "expected-terminal-receipt",
    signature: "Expected sanitized benchmark signature.",
    dedupe_key: "expected|benchmark|signature",
    classification: c.expected.classification,
    evidence: ["Expected sanitized benchmark evidence."],
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
  if (doc.schema !== 1) {
    throw new Error("fixture.schema must be 1");
  }
  requireString(doc, "benchmark", "fixture");
  requireObject(requireField(doc, "baseline", "fixture"), "fixture.baseline");
  requireString(doc.baseline, "repository", "fixture.baseline");
  requireString(doc.baseline, "commit", "fixture.baseline");
  requireBoolean(doc, "live_integration_required", "fixture");
  requireArray(requireField(doc, "cases", "fixture"), "fixture.cases");
  const receiptIds = new Map();

  doc.cases.forEach((c, index) => {
    const label = `cases[${index}]`;
    requireObject(c, label);
    requireString(c, "id", label);
    requireString(c, "scenario", label);

    const scope = requireField(c, "scope", label);
    requireObject(scope, `${label}.scope`);
    requireString(scope, "host", `${label}.scope`);
    requireEnum(scope, "agent_role", `${label}.scope`, agentRoles);
    requireEnum(scope, "skill_state", `${label}.scope`, skillStates);
    requireEnum(scope, "project_instructions", `${label}.scope`, projectInstructionStates);
    requireEnum(scope, "receipt_type", `${label}.scope`, receiptTypes);

    const receipt = requireField(c, "receipt", label);
    requireObject(receipt, `${label}.receipt`);
    requireString(receipt, "host", `${label}.receipt`);
    if (receipt.host !== scope.host) {
      throw new Error(`${label}.receipt.host must match ${label}.scope.host`);
    }
    requireBoolean(receipt, "consulted", `${label}.receipt`);
    requireBoolean(receipt, "host_enforced", `${label}.receipt`);
    requireString(receipt, "failure", `${label}.receipt`);
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
    requireBoolean(expected, "consulted", `${label}.expected`);
    requireBoolean(expected, "host_enforced", `${label}.expected`);
    requireEnum(expected, "classification", `${label}.expected`, classifications);
    requireBoolean(expected, "false_trigger", `${label}.expected`);
    requireBoolean(expected, "stale_rejected", `${label}.expected`);
    requireBoolean(expected, "repeated_failure_reduced", `${label}.expected`);
    if (hasField(expected, "time_to_verified_normal_path_max_steps")) {
      requireNonnegativeInteger(expected, "time_to_verified_normal_path_max_steps", `${label}.expected`);
    }
    requireBoolean(expected, "blind_retry", `${label}.expected`);
    requireEnum(expected, "terminal_outcome", `${label}.expected`, expectedTerminalOutcomes);
    if (hasField(expected, "terminal_receipt_required")) {
      requireBoolean(expected, "terminal_receipt_required", `${label}.expected`);
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
    }
  });
}

function renderReport(doc) {
  const cases = doc.cases ?? [];
  const [consulted, expectedConsulted] = consultationRecall(cases);
  const [hostMatched, hostTotal] = hostEnforcementQuality(cases);
  const [classificationMatches, classificationTotal] = countMatchesWhenConsulted(cases, "classification");
  const [falseTriggers, expectedNoConsult] = falseTriggerRate(cases);
  const [staleRejected, staleExpected] = staleRejectionRate(cases);
  const [reduced, reductionExpected] = repeatedFailureReduction(cases);
  const [blindRetries, totalCases] = blindRetryRate(cases);
  const [normalPath, normalPathExpected] = timeToVerifiedNormalPath(cases);
  const terminalMatches = cases.filter(terminalOutcomeMatches).length;
  const [skillMatched, skillTotal] = skillDecisionQuality(cases);
  const [completeReceipts, requiredReceipts] = receiptCompleteness(cases);
  const [correctReceiptSemantics, expectedReceiptSemantics] = receiptSemantics(cases);
  const [closedParentReceipts, requiredParentReceipts] = parentClosure(cases);

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
    metricRow("Consultation recall", consulted, expectedConsulted),
    metricRow("Host enforcement quality", hostMatched, hostTotal),
    metricRow("Skill decision quality", skillMatched, skillTotal),
    metricRow("Classification accuracy when consulted", classificationMatches, classificationTotal),
    metricRow("False trigger rate", falseTriggers, expectedNoConsult),
    metricRow("Stale rejection rate", staleRejected, staleExpected),
    metricRow("Repeated-failure reduction", reduced, reductionExpected),
    metricRow("Blind retry rate", blindRetries, totalCases),
    metricRow("Time to verified normal path", normalPath, normalPathExpected),
    metricRow("Terminal outcome compliance", terminalMatches, cases.length),
    metricRow("Terminal receipt completeness", completeReceipts, requiredReceipts),
    metricRow(
      "Terminal receipt semantic accuracy",
      correctReceiptSemantics,
      expectedReceiptSemantics,
    ),
    metricRow("Worker-to-parent closure", closedParentReceipts, requiredParentReceipts),
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
