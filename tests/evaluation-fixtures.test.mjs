import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures", "evaluation", "cases.json");

describe("evaluation benchmark fixtures", () => {
  it("provides versioned deterministic cases with a recorded baseline", () => {
    assert.ok(existsSync(fixturePath), "missing fixtures/evaluation/cases.json");

    const doc = JSON.parse(readFileSync(fixturePath, "utf8"));
    assert.equal(doc.schema, 1);
    assert.equal(doc.baseline.commit, "d7879fec762322ae658603104c7c334ade6ba43f");
    assert.equal(doc.live_integration_required, false);
    assert.ok(Array.isArray(doc.cases));
    assert.ok(doc.cases.length >= 6);
  });
});
