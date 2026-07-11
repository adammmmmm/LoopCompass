import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseFrontmatter,
  validateIncidentFields,
  validateRecoveryFields,
} from "../scripts/lib/frontmatter.mjs";
import { slugFromSignature } from "../scripts/lib/signature.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "skills", "loop-compass");

describe("artifact templates", () => {
  it("recovery template documents required frontmatter keys", () => {
    const text = readFileSync(
      path.join(skill, "assets", "recovery-template.md"),
      "utf8",
    );
    const { fields } = parseFrontmatter(text);
    for (const key of ["id", "schema", "signature", "status", "scope"]) {
      assert.ok(key in fields || text.includes(`${key}:`), `missing ${key}`);
    }
    assert.match(text, /status:\s*candidate/);
    assert.match(text, /id:\s*<slug-from-normalized-signature>/);
  });

  it("incident template documents required frontmatter keys", () => {
    const text = readFileSync(
      path.join(skill, "assets", "incident-template.md"),
      "utf8",
    );
    assert.match(text, /id:\s*<slug-from-normalized-signature>/);
    assert.match(text, /status:\s*detected/);
    assert.match(text, /blocked is metadata/);
  });

  it("validateRecoveryFields accepts a mechanical verified recovery", () => {
    const signature = "git push permission denied for protected branch";
    const id = slugFromSignature(signature);
    const errors = validateRecoveryFields({
      id,
      schema: "1",
      signature,
      status: "verified",
    });
    assert.deepEqual(errors, []);
  });

  it("validateRecoveryFields rejects descriptive non-slug ids", () => {
    const errors = validateRecoveryFields({
      id: "Fix Git Permissions",
      schema: "1",
      signature: "x",
      status: "verified",
    });
    assert.ok(errors.some((e) => e.includes("mechanical slug")));
  });

  it("validateIncidentFields accepts a minimal open incident", () => {
    const signature = "sequence gap without reseed";
    const errors = validateIncidentFields({
      id: slugFromSignature(signature),
      schema: "1",
      signature,
      status: "escalated",
      owner: "operator",
      opened: "2026-07-11",
    });
    assert.deepEqual(errors, []);
  });
});
