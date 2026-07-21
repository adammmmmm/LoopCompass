#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const terminal =
    c.receipt?.terminal_outcome === c.expected?.terminal_outcome;
  const stale =
    (c.receipt?.stale_rejected === true) === (c.expected?.stale_rejected === true);
  return classification && terminal && stale;
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
  const terminalMatches = countMatches(cases, "terminal_outcome");
  const [skillMatched, skillTotal] = skillDecisionQuality(cases);

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
    "",
    "## Host versus skill breakdown",
    "",
    "| Host | Cases | Host enforcement | Skill decision quality when consulted |",
    "| --- | --- | --- | --- |",
    ...hostRows(cases),
    "",
    "## Case outcomes",
    "",
    "| Case | Host | Host enforced | Skill decision | Classification | Terminal outcome | Consulted | Blind retry |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...cases.map((c) => {
      const hostEnforced =
        c.receipt?.host_enforced === c.expected?.host_enforced ? "pass" : "fail";
      const skillDecision = skillDecisionPass(c);
      const skill = skillDecision === null ? "n/a" : skillDecision ? "pass" : "fail";
      const classification = classificationPass(c);
      const terminal =
        c.receipt?.terminal_outcome === c.expected?.terminal_outcome ? "pass" : "fail";
      const consulted = c.receipt?.consulted === c.expected?.consulted ? "pass" : "fail";
      const blindRetry = c.receipt?.blind_retry === c.expected?.blind_retry ? "pass" : "fail";
      return `| ${c.id} | ${hostName(c)} | ${hostEnforced} | ${skill} | ${classification} | ${terminal} | ${consulted} | ${blindRetry} |`;
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
