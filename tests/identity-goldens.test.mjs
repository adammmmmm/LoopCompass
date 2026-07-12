import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  normalizeSignature,
  slugFromSignature,
} from "../scripts/lib/signature.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const goldens = JSON.parse(
  readFileSync(path.join(root, "fixtures", "identity", "goldens.json"), "utf8"),
);

describe("identity goldens (single source of truth)", () => {
  it("has schema and cases", () => {
    assert.equal(goldens.schema, 1);
    assert.ok(goldens.cases.length >= 5);
  });

  for (const c of goldens.cases) {
    it(`case ${c.id}`, () => {
      if (c.expect_equal_normalized) {
        assert.equal(
          normalizeSignature(c.raw_a),
          normalizeSignature(c.raw_b),
        );
        return;
      }
      if (c.slug != null && c.normalized != null) {
        assert.equal(slugFromSignature(c.normalized), c.slug);
        return;
      }
      if (c.raw) {
        const n = normalizeSignature(c.raw);
        for (const frag of c.normalized_contains || []) {
          assert.ok(
            n.toLowerCase().includes(String(frag).toLowerCase()) ||
              n.includes(frag),
            `${c.id}: expected contains ${frag} in ${n}`,
          );
        }
        for (const frag of c.normalized_excludes || []) {
          assert.equal(
            n.includes(frag),
            false,
            `${c.id}: expected exclude ${frag} from ${n}`,
          );
        }
      }
    });
  }

  it("SKILL.md points agents at mechanical identity rules", () => {
    const skill = readFileSync(
      path.join(root, "skills", "loop-compass", "SKILL.md"),
      "utf8",
    );
    assert.match(skill, /Normalize the signature/i);
    assert.match(skill, /96 characters/i);
    assert.match(skill, /failure/i);
  });
});
