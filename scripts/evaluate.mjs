#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function usage() {
  return [
    "Usage: node scripts/evaluate.mjs --fixture <path>",
    "",
    "Generates a deterministic Markdown benchmark report from recorded LoopCompass receipts.",
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
    return Number.isFinite(before) && Number.isFinite(after) && after < before;
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
    return Number.isFinite(steps) && steps <= maxSteps;
  });
  return [matched.length, expected.length];
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

function renderReport(doc) {
  const cases = doc.cases ?? [];
  const [consulted, expectedConsulted] = consultationRecall(cases);
  const [hostMatched, hostTotal] = hostEnforcementQuality(cases);
  const classificationMatches = countMatches(cases, "classification");
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
    metricRow("Classification accuracy", classificationMatches, cases.length),
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
      const classification =
        c.receipt?.classification === c.expected?.classification ? "pass" : "fail";
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
  process.stdout.write(renderReport(doc));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
