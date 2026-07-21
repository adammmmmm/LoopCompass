import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures", "evaluation", "cases.json");

function readFixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function runEvaluate(fixture) {
  return spawnSync(
    "node",
    ["scripts/evaluate.mjs", "--fixture", fixture],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
}

function runEvaluateWithDoc(doc) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "lc-eval-"));
  const tempFixture = path.join(tempDir, "cases.json");
  writeFileSync(tempFixture, `${JSON.stringify(doc, null, 2)}\n`);

  try {
    return runEvaluate(tempFixture);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("evaluation benchmark report", () => {
  it("generates deterministic Markdown metrics from recorded receipts", () => {
    const result = runEvaluate("fixtures/evaluation/cases.json");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /# LoopCompass benchmark report/);
    assert.match(result.stdout, /Synthetic fixtures only; not live host evidence/);
    assert.match(result.stdout, /Baseline commit \| d7879fec762322ae658603104c7c334ade6ba43f/);
    assert.match(result.stdout, /Cases \| 10/);
    assert.match(result.stdout, /Consultation recall \| 7\/9 \| 77\.8%/);
    assert.match(result.stdout, /Host enforcement quality \| 8\/10 \| 80\.0%/);
    assert.match(result.stdout, /Skill decision quality \| 7\/7 \| 100\.0%/);
    assert.match(result.stdout, /Classification accuracy when consulted \| 7\/7 \| 100\.0%/);
    assert.match(result.stdout, /Repeated-failure reduction \| 7\/9 \| 77\.8%/);
    assert.match(result.stdout, /Blind retry rate \| 2\/10 \| 20\.0%/);
    assert.match(result.stdout, /Time to verified normal path \| 7\/9 \| 77\.8%/);
    assert.match(result.stdout, /Terminal outcome compliance \| 8\/10 \| 80\.0%/);
    assert.match(result.stdout, /Live integration required \| false/);
    assert.match(result.stdout, /## Host versus skill breakdown/);
    assert.match(result.stdout, /codex-synthetic \| 4 \| 3\/4 \(75\.0%\) \| 3\/3 \(100\.0%\)/);
    assert.match(result.stdout, /lc-eval-008-subagent-readonly-handoff/);
    assert.match(result.stdout, /lc-eval-009-missing-skill-fallback/);
    assert.match(result.stdout, /lc-eval-010-missing-project-instructions/);
  });

  it("rejects incomplete fixtures before scoring missing values", () => {
    const doc = readFixture();
    delete doc.cases[0].receipt.classification;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /cases\[0\]\.receipt\.classification is required/,
    );
  });

  it("scores a consulted but wrong decision as a skill and classification failure", () => {
    const doc = readFixture();
    doc.cases[0].receipt.classification = "incident";

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Skill decision quality \| 6\/7 \| 85\.7%/);
    assert.match(result.stdout, /Classification accuracy when consulted \| 6\/7 \| 85\.7%/);
    assert.match(
      result.stdout,
      /lc-eval-001-known-recovery \| codex-synthetic \| pass \| fail \| fail/,
    );
  });

  it("does not credit unconsulted improvement to LoopCompass outcome metrics", () => {
    const doc = readFixture();
    doc.cases[4].receipt.repeated_failure_attempts_after = 0;
    doc.cases[4].receipt.steps_to_verified_normal_path = 2;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Repeated-failure reduction \| 7\/9 \| 77\.8%/);
    assert.match(result.stdout, /Time to verified normal path \| 7\/9 \| 77\.8%/);
  });

  it("reports false triggers from expected no-consultation cases", () => {
    const doc = readFixture();
    doc.cases[2].receipt.consulted = true;
    doc.cases[2].receipt.host_enforced = true;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /False trigger rate \| 1\/1 \| 100\.0%/);
  });
});
