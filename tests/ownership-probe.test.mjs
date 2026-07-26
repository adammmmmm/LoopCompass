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

function fixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

describe("schema-1 ownership compatibility probe", () => {
  it("preserves representative consumer incidents byte-for-byte", () => {
    const report = runOwnershipProbe();
    assert.equal(report.decision, "schema_1_plus_receipts_sufficient");
    assert.equal(report.consumer_state.unchanged, true);
    assert.equal(
      report.consumer_state.before_sha256,
      report.consumer_state.after_sha256,
    );
    assert.equal(report.consumer_state.files.length, 3);
    for (const criterion of Object.values(report.criteria)) {
      assert.equal(criterion.pass, true);
    }
  });

  it("keeps coordination stable while action owners remain queryable across reassignment", () => {
    const report = runOwnershipProbe();
    for (const scenario of report.cases) {
      assert.ok(
        scenario.action_owners.some(
          (actionOwner) => actionOwner !== scenario.coordinator,
        ),
      );
      assert.ok(new Set(scenario.action_owners).size > 1);
      assert.equal(
        scenario.query_receipts_by_action_owner[
          scenario.current_action_owner
        ].at(-1),
        scenario.receipt_ids.at(-1),
      );
      assert.equal(scenario.verification_owner, scenario.coordinator);
      assert.equal(scenario.closure_owner, scenario.coordinator);
    }
  });

  it("emits deterministic JSON closure evidence", () => {
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
    const report = JSON.parse(first.stdout);
    assert.equal(report.consumer_state.unchanged, true);
  });

  it("fails closed on baseline drift and unsafe consumer paths", () => {
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
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("rejects schema-v2 probe input and ambiguous action ownership", () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "lc-ownership-probe-"));
    try {
      const schemaTwo = fixture();
      schemaTwo.schema = 2;
      const schemaTwoPath = path.join(temp, "schema-two.json");
      writeFileSync(schemaTwoPath, `${JSON.stringify(schemaTwo, null, 2)}\n`);
      assert.throws(
        () => runOwnershipProbe(schemaTwoPath),
        /fixture\.schema must be 1/,
      );

      const blankOwner = fixture();
      blankOwner.cases[0].events[1].action_owner = "";
      const blankOwnerPath = path.join(temp, "blank-owner.json");
      writeFileSync(blankOwnerPath, `${JSON.stringify(blankOwner, null, 2)}\n`);
      assert.throws(
        () => runOwnershipProbe(blankOwnerPath),
        /action_owner must be a non-empty string/,
      );

      const duplicateReceipt = fixture();
      duplicateReceipt.cases[1].events[0].receipt_id =
        duplicateReceipt.cases[0].events[0].receipt_id;
      duplicateReceipt.cases[1].expected.query_receipts_by_action_owner[
        "client-maintainer"
      ][0] = duplicateReceipt.cases[0].events[0].receipt_id;
      const duplicateReceiptPath = path.join(temp, "duplicate-receipt.json");
      writeFileSync(
        duplicateReceiptPath,
        `${JSON.stringify(duplicateReceipt, null, 2)}\n`,
      );
      assert.throws(
        () => runOwnershipProbe(duplicateReceiptPath),
        /events must use globally unique receipt ids/,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
