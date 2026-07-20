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

function consultationRecall(cases) {
  const expected = cases.filter((c) => c.expected?.consulted === true);
  const matched = expected.filter((c) => c.receipt?.consulted === true);
  return [matched.length, expected.length];
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

function metricRow(name, numerator, denominator) {
  return `| ${name} | ${ratio(numerator, denominator)} | ${percent(numerator, denominator)} |`;
}

function renderReport(doc) {
  const cases = doc.cases ?? [];
  const [consulted, expectedConsulted] = consultationRecall(cases);
  const classificationMatches = countMatches(cases, "classification");
  const [falseTriggers, expectedNoConsult] = falseTriggerRate(cases);
  const [staleRejected, staleExpected] = staleRejectionRate(cases);
  const [blindRetries, totalCases] = blindRetryRate(cases);
  const terminalMatches = countMatches(cases, "terminal_outcome");

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
    metricRow("Classification accuracy", classificationMatches, cases.length),
    metricRow("False trigger rate", falseTriggers, expectedNoConsult),
    metricRow("Stale rejection rate", staleRejected, staleExpected),
    metricRow("Blind retry rate", blindRetries, totalCases),
    metricRow("Terminal outcome compliance", terminalMatches, cases.length),
    "",
    "## Case outcomes",
    "",
    "| Case | Classification | Terminal outcome | Consulted | Blind retry |",
    "| --- | --- | --- | --- | --- |",
    ...cases.map((c) => {
      const classification =
        c.receipt?.classification === c.expected?.classification ? "pass" : "fail";
      const terminal =
        c.receipt?.terminal_outcome === c.expected?.terminal_outcome ? "pass" : "fail";
      const consulted = c.receipt?.consulted === c.expected?.consulted ? "pass" : "fail";
      const blindRetry = c.receipt?.blind_retry === c.expected?.blind_retry ? "pass" : "fail";
      return `| ${c.id} | ${classification} | ${terminal} | ${consulted} | ${blindRetry} |`;
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
