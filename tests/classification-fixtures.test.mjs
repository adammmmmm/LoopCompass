import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { LANES } from "../scripts/lib/frontmatter.mjs";
import { signatureIdentity } from "../scripts/lib/signature.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures", "classification", "cases.json");

describe("classification fixtures", () => {
  const doc = JSON.parse(readFileSync(fixturePath, "utf8"));

  it("has schema and non-empty cases", () => {
    assert.equal(doc.schema, 1);
    assert.ok(Array.isArray(doc.cases));
    assert.ok(doc.cases.length >= 10);
  });

  it("every case has unique id, valid lane, and mechanical identity", () => {
    const seen = new Set();
    for (const c of doc.cases) {
      assert.ok(c.id, "missing id");
      assert.equal(seen.has(c.id), false, `duplicate id ${c.id}`);
      seen.add(c.id);
      assert.ok(LANES.has(c.lane), `invalid lane ${c.lane} on ${c.id}`);
      assert.ok(c.failure && c.failure.length > 10, `weak failure on ${c.id}`);
      assert.ok(c.rationale && c.rationale.length > 10, `weak rationale on ${c.id}`);

      const { normalized, slug } = signatureIdentity(c.failure);
      assert.ok(normalized.length > 0, `empty normalized on ${c.id}`);
      assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(slug.length <= 96);
      // Secrets and raw emails must not survive normalization.
      assert.equal(/\bBearer\s+\S+/i.test(normalized), false, c.id);
      assert.equal(/ghp_[A-Za-z0-9]+/.test(normalized), false, c.id);
      assert.equal(/@example\.com/i.test(normalized), false, c.id);
    }
  });

  it("covers all four lanes", () => {
    const lanes = new Set(doc.cases.map((c) => c.lane));
    for (const lane of LANES) {
      assert.ok(lanes.has(lane), `missing lane coverage: ${lane}`);
    }
  });

  it("volatile noise does not fork identity for uuid-path case", () => {
    const base = doc.cases.find((c) => c.id === "uuid-path-collision-shape");
    assert.ok(base);
    const a = signatureIdentity(base.failure);
    const b = signatureIdentity(
      base.failure
        .replace(/550e8400-e29b-41d4-a716-446655440000/, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
        .replace(/TASK-042-abc/, "TASK-099-zzz"),
    );
    assert.equal(a.slug, b.slug);
  });
});
