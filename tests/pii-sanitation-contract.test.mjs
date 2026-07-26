import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  resolveSlugCollision,
  slugFromSignature,
} from "../scripts/lib/signature.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "skills", "loop-compass");
const contract = readFileSync(
  path.join(skill, "references", "pii-sanitation.md"),
  "utf8",
);
const coreSkill = readFileSync(path.join(skill, "SKILL.md"), "utf8");
const projectPolicy = readFileSync(
  path.join(skill, "assets", "project-policy.md"),
  "utf8",
);
const artifactCases = JSON.parse(
  readFileSync(
    path.join(root, "fixtures", "sanitation", "proposed-artifact-cases.json"),
    "utf8",
  ),
);

function validateProposedArtifactFacts(contentFacts) {
  const diagnosticCodes = [];
  if (contentFacts.contains_private_payload) {
    diagnosticCodes.push("private_payload");
  }
  if (contentFacts.contains_raw_log) {
    diagnosticCodes.push("raw_log");
  }
  return {
    valid: diagnosticCodes.length === 0,
    diagnosticCodes,
    diagnostic: diagnosticCodes.map((code) => `unsafe durable content: ${code}`).join("\n"),
  };
}

describe("PII sanitation contract", () => {
  it("sanitizes every durable surface before identity derivation", () => {
    const sanitation = contract.indexOf("Replace unnecessary identities");
    const normalization = contract.indexOf("Only then normalize");
    assert.ok(sanitation >= 0);
    assert.ok(normalization > sanitation);

    for (const surface of [
      "prose",
      "commands",
      "evidence",
      "frontmatter",
      "filenames",
      "terminal receipts",
      "human-attention projections",
      "obligation markers",
      "known-obligation registries",
      "requested_action",
      "diagnostics",
    ]) {
      assert.match(contract, new RegExp(surface, "i"));
    }
    assert.match(contract, /dedupe key, artifact ID, or filename/i);
    assert.match(
      coreSkill,
      /\[pii-sanitation\.md\]\(references\/pii-sanitation\.md\)/,
    );
    assert.match(coreSkill, /before normalizing the signature or deriving a dedupe key/i);
    assert.match(
      projectPolicy,
      /Before writing LoopCompass state, receipts, human-attention projections, obligation markers,[\s\S]*known-obligation registry entries, `requested_action` prose, or diagnostics/i,
    );
    assert.match(projectPolicy, /Sanitize before signature[\s\S]*normalization/i);
  });

  it("requires role substitution and covers prohibited identity-bearing material", () => {
    for (const category of [
      "personal names",
      "emails",
      "handles",
      "home-directory usernames",
      "customer",
      "account",
      "private organization",
      "secrets",
      "private payloads",
      "raw logs",
    ]) {
      assert.match(contract, new RegExp(category, "i"));
    }
    for (const role of ["Operator", "User", "Customer", "Reviewer", "Worker"]) {
      assert.match(contract, new RegExp(`\\b${role}\\b`));
    }
    assert.match(contract, /non-sensitive record ID/i);
    assert.match(contract, /without\s+printing the matched value/i);
    assert.match(
      contract,
      /private payload or raw log, reject it for persistence/i,
    );
  });

  it("deduplicates identity-only differences before resolving slug collisions", () => {
    const generalizeSyntheticRole = (value) =>
      value.replace(/Customer (?:Alpha|Beta)/g, "Customer");
    const first = generalizeSyntheticRole(
      "api request for Customer Alpha returns authorization denied",
    );
    const second = generalizeSyntheticRole(
      "api request for Customer Beta returns authorization denied",
    );

    assert.equal(first, second);
    const slug = slugFromSignature(first);
    assert.equal(slugFromSignature(second), slug);
    assert.match(contract, /exact sanitized signature matches/i);

    const distinctSignatureWithSameSlug =
      "api request for Customer: returns authorization denied";
    assert.notEqual(distinctSignatureWithSameSlug, first);
    assert.equal(slugFromSignature(distinctSignatureWithSameSlug), slug);
    assert.equal(
      resolveSlugCollision(slug, (candidate) => candidate === slug),
      `${slug}-2`,
    );
    assert.match(contract, /lowest available integer suffix beginning with `-2`/i);
    assert.match(contract, /Do not reintroduce/i);
  });

  it("marks automated checks as defense in depth rather than certification", () => {
    assert.match(contract, /defense in depth, not proof/i);
    assert.match(contract, /does not require Git-history rewriting/i);
    assert.match(contract, /scanner daemon or hook/i);
    assert.match(contract, /comprehensive\s+privacy certification/i);
  });

  it("rejects unsafe proposed artifacts without echoing source content", () => {
    assert.equal(artifactCases.schema, 1);
    assert.ok(artifactCases.cases.length >= 3);

    for (const fixture of artifactCases.cases) {
      const result = validateProposedArtifactFacts(fixture.content_facts);
      assert.equal(result.valid, fixture.expected.valid, fixture.id);
      assert.deepEqual(
        result.diagnosticCodes,
        fixture.expected.diagnostic_codes,
        fixture.id,
      );
      for (const value of Object.values(fixture.proposed_artifact)) {
        assert.equal(
          result.diagnostic.includes(value),
          false,
          `${fixture.id}: diagnostic echoed proposed artifact content`,
        );
      }
    }

    assert.equal(
      artifactCases.cases.find((fixture) => fixture.id === "sanitized-role-based-evidence")
        .expected.valid,
      true,
    );
    assert.equal(
      artifactCases.cases.find((fixture) => fixture.id === "unsafe-private-payload")
        .expected.valid,
      false,
    );
    assert.equal(
      artifactCases.cases.find((fixture) => fixture.id === "unsafe-raw-log").expected.valid,
      false,
    );
  });
});

describe("artifact templates", () => {
  for (const template of ["incident-template.md", "recovery-template.md"]) {
    it(`${template} requires pre-identity sanitation`, () => {
      const text = readFileSync(path.join(skill, "assets", template), "utf8");
      assert.match(
        text,
        /sanitize every field and section before deriving signature, id, or filename/i,
      );
      assert.match(text, /Sanitized[^>\n]*evidence|Evidence:\s*<Sanitized/i);
    });
  }
});
