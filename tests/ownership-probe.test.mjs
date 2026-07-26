import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runOwnershipProbe } from "../scripts/ownership-probe.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(
  root,
  "fixtures",
  "ownership-probe",
  "cases.json",
);
const probePath = path.join(root, "scripts", "ownership-probe.mjs");
const decisionPath = path.join(
  root,
  "docs",
  "decisions",
  "schema-v2-ownership.md",
);

function fixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

describe("schema-1 ownership evidence probe", () => {
  it("defers schema 2 without authorizing implementation", () => {
    const report = runOwnershipProbe();
    assert.equal(report.decision, "defer_schema_2_insufficient_evidence");
    assert.equal(report.schema_v2_implementation_authorized, false);
    assert.equal(report.consumer_state.unchanged, true);
    assert.equal(
      report.consumer_state.before_sha256,
      report.consumer_state.after_sha256,
    );
    assert.equal(report.observed_evidence.representative_incidents, 3);
    assert.equal(report.observed_evidence.schema_1_incidents, 3);
    assert.equal(report.observed_evidence.coordinator_fields, 3);
    assert.equal(report.observed_evidence.requires_lists, 3);
    assert.equal(report.observed_evidence.structured_action_owner_fields, 0);
  });

  it("keeps unsupported ownership conclusions explicit as evidence gaps", () => {
    const report = runOwnershipProbe();
    assert.deepEqual(
      Object.keys(report.evidence_gaps),
      [
        "representative_receipt_provenance",
        "authoritative_reassignment_order",
        "current_action_owner_authority",
        "verification_and_closure_actor_observation",
      ],
    );
    for (const gap of Object.values(report.evidence_gaps)) {
      assert.equal(gap.proven, false);
      assert.ok(gap.reason.length > 40);
    }
    for (const scenario of report.cases) {
      assert.equal(Object.hasOwn(scenario, "action_owners"), false);
      assert.equal(Object.hasOwn(scenario, "current_action_owner"), false);
      assert.equal(Object.hasOwn(scenario, "receipt_ids"), false);
    }
  });

  it("rejects unsupported affirmative sufficiency assertions", () => {
    const reportText = JSON.stringify(runOwnershipProbe());
    const fixtureText = readFileSync(fixturePath, "utf8");
    const decisionText = readFileSync(decisionPath, "utf8");
    for (const text of [reportText, fixtureText, decisionText]) {
      assert.doesNotMatch(text, /schema_1_plus_receipts_sufficient/i);
      assert.doesNotMatch(text, /schema 1(?: plus receipts)? is sufficient/i);
    }

    const temp = mkdtempSync(path.join(os.tmpdir(), "lc-ownership-probe-"));
    try {
      const unsupported = fixture();
      unsupported.schema_1_sufficient = true;
      const unsupportedPath = path.join(temp, "unsupported.json");
      writeFileSync(
        unsupportedPath,
        `${JSON.stringify(unsupported, null, 2)}\n`,
      );
      assert.throws(
        () => runOwnershipProbe(unsupportedPath),
        /schema_1_sufficient is not allowed/,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("emits deterministic JSON and preserves consumer bytes", () => {
    const first = spawnSync(process.execPath, [probePath], {
      cwd: root,
      encoding: "utf8",
    });
    const second = spawnSync(process.execPath, [probePath], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(first.stdout, second.stdout);
    assert.equal(JSON.parse(first.stdout).consumer_state.unchanged, true);
  });

  it("fails closed on baseline drift, unsafe paths, and schema-v2 input", () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "lc-ownership-probe-"));
    try {
      const drifted = fixture();
      drifted.expected_consumer_state_sha256 = "0".repeat(64);
      const driftedPath = path.join(temp, "drifted.json");
      writeFileSync(driftedPath, `${JSON.stringify(drifted, null, 2)}\n`);
      assert.throws(
        () => runOwnershipProbe(driftedPath),
        /consumer-state baseline drifted/,
      );

      const escaped = fixture();
      escaped.cases[0].incident_path = "../outside.md";
      const escapedPath = path.join(temp, "escaped.json");
      writeFileSync(escapedPath, `${JSON.stringify(escaped, null, 2)}\n`);
      assert.throws(
        () => runOwnershipProbe(escapedPath),
        /incident_path escapes the repository/,
      );

      const schemaTwo = fixture();
      schemaTwo.schema = 2;
      const schemaTwoPath = path.join(temp, "schema-two.json");
      writeFileSync(schemaTwoPath, `${JSON.stringify(schemaTwo, null, 2)}\n`);
      assert.throws(
        () => runOwnershipProbe(schemaTwoPath),
        /fixture\.schema must be 1/,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
