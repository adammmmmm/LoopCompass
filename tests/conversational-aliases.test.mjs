import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reference = readFileSync(
  path.join(
    root,
    "skills",
    "loop-compass",
    "references",
    "conversational-aliases.md",
  ),
  "utf8",
);
const cases = JSON.parse(
  readFileSync(
    path.join(root, "fixtures", "conversational-aliases", "cases.json"),
    "utf8",
  ),
).cases;

function evaluateAlias(candidate) {
  if (candidate.ambiguous) return "clarify";
  if (candidate.durable_target) return "reject";
  if (
    candidate.context !== "current_conversation" ||
    (!candidate.introduced_together && !candidate.mapping_established)
  ) {
    return "reject";
  }
  return candidate.canonical_slug ? "accept" : "reject";
}

describe("conversational incident aliases", () => {
  it("evaluates dual display, ambiguity, compaction, durable, and namespaced cases", () => {
    assert.ok(cases.length >= 7);
    for (const candidate of cases) {
      assert.equal(evaluateAlias(candidate), candidate.expected, candidate.id);
    }
  });

  it("keeps aliases conversation-local and canonical slugs durable", () => {
    assert.match(reference, /local to that conversation/i);
    assert.match(reference, /Introduce the alias and canonical slug together/i);
    assert.match(reference, /after context compaction/i);
    assert.match(reference, /Git, pull requests, tasks, artifacts, receipts/i);
    assert.match(reference, /never guess/i);
    assert.match(reference, /`LC-B1` and `LC-G1`/);
  });

  it("keeps aliases out of artifact and receipt schemas", () => {
    for (const relative of [
      "skills/loop-compass/assets/incident-template.md",
      "skills/loop-compass/assets/recovery-template.md",
      "skills/loop-compass/references/terminal-receipts.md",
    ]) {
      const text = readFileSync(path.join(root, relative), "utf8");
      assert.doesNotMatch(text, /^\s*alias\s*:/m, relative);
    }
    assert.match(reference, /must not appear as an identity field/i);
  });

  it("documents concise human presentation affordances", () => {
    for (const phrase of [
      "requested action",
      "recommendation",
      "action blast radius",
      "consequence of inaction",
      "verification promise",
      "LC-1 breakdown",
      "LC-1 simple",
    ]) {
      assert.match(reference, new RegExp(phrase, "i"));
    }
  });
});
