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
    assert.match(result.stdout, /Consultation recall \| 4\/5 \| 80\.0%/);
    assert.match(result.stdout, /Classification accuracy \| 6\/6 \| 100\.0%/);
    assert.match(result.stdout, /Blind retry rate \| 1\/6 \| 16\.7%/);
    assert.match(result.stdout, /Terminal outcome compliance \| 5\/6 \| 83\.3%/);
    assert.match(result.stdout, /Live integration required \| false/);
  });
});
