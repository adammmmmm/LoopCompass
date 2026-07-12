import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertLaneNotContradicted,
  assistClassify,
} from "../scripts/lib/classify-assist.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cases = JSON.parse(
  readFileSync(
    path.join(root, "fixtures", "classification", "cases.json"),
    "utf8",
  ),
).cases;

describe("classification assist gates", () => {
  it("no fixture lane contradicts hard rules", () => {
    for (const c of cases) {
      const errors = assertLaneNotContradicted(c.failure, c.lane);
      assert.deepEqual(errors, [], `${c.id}: ${errors.join("; ")}`);
    }
  });

  it("assistClassify matches hard fixture cases when non-null", () => {
    for (const c of cases) {
      const suggested = assistClassify(c.failure);
      if (suggested != null) {
        assert.equal(
          suggested,
          c.lane,
          `${c.id}: assist=${suggested} fixture=${c.lane}`,
        );
      }
    }
  });

  it("rejects bypass labeled as recovery", () => {
    const errors = assertLaneNotContradicted(
      "permission error; agent ran chmod 777 as workaround",
      "recovery",
    );
    assert.ok(errors.length > 0);
  });
});
