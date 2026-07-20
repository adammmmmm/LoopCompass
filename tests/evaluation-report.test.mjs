import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("evaluation benchmark report", () => {
  it("generates deterministic Markdown metrics from recorded receipts", () => {
    const result = spawnSync(
      "node",
      ["scripts/evaluate.mjs", "--fixture", "fixtures/evaluation/cases.json"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /# LoopCompass benchmark report/);
    assert.match(result.stdout, /Baseline commit \| d7879fec762322ae658603104c7c334ade6ba43f/);
    assert.match(result.stdout, /Cases \| 10/);
    assert.match(result.stdout, /Consultation recall \| 7\/9 \| 77\.8%/);
    assert.match(result.stdout, /Host enforcement quality \| 8\/10 \| 80\.0%/);
    assert.match(result.stdout, /Skill decision quality \| 7\/7 \| 100\.0%/);
    assert.match(result.stdout, /Classification accuracy \| 10\/10 \| 100\.0%/);
    assert.match(result.stdout, /Repeated-failure reduction \| 7\/9 \| 77\.8%/);
    assert.match(result.stdout, /Blind retry rate \| 1\/10 \| 10\.0%/);
    assert.match(result.stdout, /Time to verified normal path \| 7\/9 \| 77\.8%/);
    assert.match(result.stdout, /Terminal outcome compliance \| 8\/10 \| 80\.0%/);
    assert.match(result.stdout, /Live integration required \| false/);
    assert.match(result.stdout, /## Host versus skill breakdown/);
    assert.match(result.stdout, /codex-synthetic \| 4 \| 3\/4 \(75\.0%\) \| 3\/3 \(100\.0%\)/);
    assert.match(result.stdout, /lc-eval-008-subagent-readonly-handoff/);
    assert.match(result.stdout, /lc-eval-009-missing-skill-fallback/);
    assert.match(result.stdout, /lc-eval-010-missing-project-instructions/);
  });
});
