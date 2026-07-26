import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures", "evaluation", "cases.json");

function readFixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function runEvaluate(fixture) {
  return spawnSync(
    "node",
    ["scripts/evaluate.mjs", "--fixture", fixture],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
}

function runEvaluateWithDoc(doc) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "lc-eval-"));
  const tempFixture = path.join(tempDir, "cases.json");
  writeFileSync(tempFixture, `${JSON.stringify(doc, null, 2)}\n`);

  try {
    return runEvaluate(tempFixture);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runEvaluateWithSource(source) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "lc-eval-"));
  const tempFixture = path.join(tempDir, "cases.json");
  writeFileSync(tempFixture, source);
  try {
    return runEvaluate(tempFixture);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("evaluation benchmark report", () => {
  it("generates deterministic Markdown metrics from bundled receipts", () => {
    const result = runEvaluate("fixtures/evaluation/cases.json");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /# LoopCompass benchmark report/);
    assert.match(
      result.stdout,
      /Receipt types: synthetic\. Not live-host evidence absent an explicit live-run protocol\./,
    );
    assert.match(result.stdout, /Baseline commit \| d7879fec762322ae658603104c7c334ade6ba43f/);
    assert.match(result.stdout, /Cases \| 15/);
    assert.match(result.stdout, /Consultation recall \| 11\/14 \| 78\.6%/);
    assert.match(result.stdout, /Host enforcement quality \| 12\/15 \| 80\.0%/);
    assert.match(result.stdout, /Skill decision quality \| 10\/11 \| 90\.9%/);
    assert.match(result.stdout, /Classification accuracy when consulted \| 11\/11 \| 100\.0%/);
    assert.match(result.stdout, /Repeated-failure reduction \| 7\/10 \| 70\.0%/);
    assert.match(result.stdout, /Blind retry rate \| 3\/15 \| 20\.0%/);
    assert.match(result.stdout, /Time to verified normal path \| 7\/10 \| 70\.0%/);
    assert.match(result.stdout, /Terminal outcome compliance \| 12\/15 \| 80\.0%/);
    assert.match(result.stdout, /Terminal receipt completeness \| 11\/14 \| 78\.6%/);
    assert.match(result.stdout, /Terminal receipt semantic accuracy \| 11\/14 \| 78\.6%/);
    assert.match(result.stdout, /Worker-to-parent closure \| 3\/4 \| 75\.0%/);
    assert.match(result.stdout, /Live integration required \| false/);
    assert.match(result.stdout, /## Host versus skill breakdown/);
    assert.match(result.stdout, /codex-synthetic \| 7 \| 5\/7 \(71\.4%\) \| 4\/5 \(80\.0%\)/);
    assert.match(result.stdout, /lc-eval-008-subagent-readonly-handoff/);
    assert.match(result.stdout, /lc-eval-009-missing-skill-fallback/);
    assert.match(result.stdout, /lc-eval-010-missing-project-instructions/);
    assert.match(
      result.stdout,
      /lc-eval-011-workaround-erases-classification .* fail \| n\/a \| fail \| fail/,
    );
    assert.match(
      result.stdout,
      /lc-eval-012-workaround-is-containment .* pass \| n\/a \| pass \| pass/,
    );
    assert.match(
      result.stdout,
      /lc-eval-013-parent-without-store-propagates .* pass \| pass \| pass \| pass/,
    );
    assert.match(
      result.stdout,
      /lc-eval-014-parent-no-artifact .* pass \| pass \| pass \| pass/,
    );
    assert.match(
      result.stdout,
      /lc-eval-015-missing-parent-receipt .* pass \| pass \| fail \| pass/,
    );
  });

  it("labels recorded receipts without presenting them as live-host evidence", () => {
    const doc = readFixture();
    for (const c of doc.cases) {
      c.scope.receipt_type = "recorded";
    }

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      /Receipt types: recorded\. Not live-host evidence absent an explicit live-run protocol\./,
    );
  });

  it("labels mixed synthetic and recorded receipts without presenting them as live-host evidence", () => {
    const doc = readFixture();
    doc.cases[0].scope.receipt_type = "recorded";

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      /Receipt types: synthetic and recorded\. Not live-host evidence absent an explicit live-run protocol\./,
    );
  });

  it("rejects incomplete fixtures before scoring missing values", () => {
    const doc = readFixture();
    delete doc.cases[0].receipt.classification;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /cases\[0\]\.receipt\.classification is required/,
    );
  });

  it("rejects missing, duplicate, unknown, or reordered metric inventory entries", () => {
    const mutations = [
      (doc) => {
        doc.metrics.splice(2, 1);
      },
      (doc) => {
        doc.metrics[2] = doc.metrics[1];
      },
      (doc) => {
        doc.metrics[2] = "unknown_metric";
      },
      (doc) => {
        [doc.metrics[1], doc.metrics[2]] = [doc.metrics[2], doc.metrics[1]];
      },
    ];

    for (const mutate of mutations) {
      const doc = readFixture();
      mutate(doc);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /must exactly match the ordered metric registry/);
    }
  });

  it("rejects unknown fields in every fixture object layer", () => {
    const mutations = [
      (doc) => {
        doc.typo = true;
      },
      (doc) => {
        doc.baseline.typo = true;
      },
      (doc) => {
        doc.cases[0].typo = true;
      },
      (doc) => {
        doc.cases[0].scope.typo = true;
      },
      (doc) => {
        doc.cases[0].receipt.typo = true;
      },
      (doc) => {
        doc.cases[0].expected.typo = true;
      },
    ];

    for (const mutate of mutations) {
      const doc = readFixture();
      mutate(doc);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /\.typo is not allowed/);
    }
  });

  it("rejects duplicate JSON keys at every object depth before scoring", () => {
    const source = readFileSync(fixturePath, "utf8");
    const mutations = [
      source.replace('"schema": 1,', '"schema": 1,\n  "schema": 1,'),
      source.replace(
        '"consulted": true,',
        '"consulted": true,\n        "consulted": true,',
      ),
      source.replace(
        '"consulted": true,',
        '"consulted": true,\n        "consulted": false,',
      ),
      source.replace(
        '"containment": {\n            "used": false,',
        '"containment": {\n            "used": false,\n            "used": false,',
      ),
      source.replace(
        '"parent_receipt": {\n          "receipt_schema": 1,',
        '"parent_receipt": {\n          "receipt_schema": 1,\n          "receipt_schema": 1,',
      ),
    ];
    for (const duplicate of mutations) {
      const result = runEvaluateWithSource(duplicate);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /fixture JSON contains a duplicate object key/);
      assert.equal(result.stdout, "");
    }
  });

  it("requires terminal and parent receipt properties as object or null", () => {
    const mutations = [
      [(doc) => {
        delete doc.cases[0].receipt.terminal_receipt;
      }, /terminal_receipt is required/],
      [(doc) => {
        doc.cases[0].receipt.terminal_receipt = [];
      }, /terminal_receipt must be an object/],
      [(doc) => {
        delete doc.cases[0].receipt.parent_receipt;
      }, /parent_receipt is required/],
      [(doc) => {
        doc.cases[0].receipt.parent_receipt = "missing";
      }, /parent_receipt must be an object/],
    ];

    for (const [mutate, expectedError] of mutations) {
      const doc = readFixture();
      mutate(doc);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, expectedError);
    }
  });

  it("requires unique case ids", () => {
    const doc = readFixture();
    doc.cases[1].id = doc.cases[0].id;
    const result = runEvaluateWithDoc(doc);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /cases\[1\]\.id duplicates cases\[0\]\.id/);
  });

  it("rejects an empty corpus or deletion of any evaluator-owned case", () => {
    const requiredIds = readFixture().cases.map((c) => c.id);
    const empty = readFixture();
    empty.cases = [];
    const emptyResult = runEvaluateWithDoc(empty);
    assert.equal(emptyResult.status, 1);
    assert.match(emptyResult.stderr, /must contain exactly the 15 evaluator-owned cases/);

    for (const id of requiredIds) {
      const doc = readFixture();
      doc.cases = doc.cases.filter((c) => c.id !== id);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /must contain exactly the 15 evaluator-owned cases/);
    }
  });

  it("binds every corpus id to evaluator-owned semantic ground truth", () => {
    const requiredIds = readFixture().cases.map((c) => c.id);
    assert.ok(requiredIds.includes("lc-eval-005-blind-retry-regression"));
    assert.ok(requiredIds.includes("lc-eval-010-missing-project-instructions"));
    assert.ok(requiredIds.includes("lc-eval-011-workaround-erases-classification"));

    for (const targetId of requiredIds) {
      const doc = readFixture();
      const target = doc.cases.find((c) => c.id === targetId);
      target.expected.blind_retry = !target.expected.blind_retry;
      target.receipt.blind_retry = target.expected.blind_retry;
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        new RegExp(
          `case ${targetId} does not match evaluator-owned semantic ground truth`,
        ),
      );
    }
  });

  it("rejects a receipt whose host does not match its declared scope", () => {
    const doc = readFixture();
    doc.cases[0].receipt.host = "different-host";

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1, result.stdout);
    assert.match(
      result.stderr,
      /cases\[0\]\.receipt\.host must match cases\[0\]\.scope\.host/,
    );
  });

  it("sanitizes fixture scenario and failure prose without echoing matches", () => {
    const mutations = [
      (doc) => {
        doc.cases[0].scenario =
          "The failure occurred at file:///Users/PrivateUser/private-project.";
      },
      (doc) => {
        doc.cases[0].receipt.failure =
          "The command failed under (/home/PrivateUser/private-project).";
      },
    ];

    for (const mutate of mutations) {
      const doc = readFixture();
      mutate(doc);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /contains a high-confidence sensitive value/);
      assert.equal(result.stderr.includes("PrivateUser"), false);
    }
  });

  it("rejects character references before evaluator scoring", () => {
    const mutations = [
      (doc) => {
        doc.cases[0].scenario = "Contact private&#64;example.com.";
      },
      (doc) => {
        doc.cases[0].receipt.failure = "&#x54;he intended path failed.";
      },
      (doc) => {
        doc.description = "Benchmark &colon; encoded separator.";
      },
      (doc) => {
        doc.cases[0].scenario = "Contact private&#64example.com.";
      },
      (doc) => {
        doc.cases[0].receipt.failure = "&#x40g encoded failure.";
      },
      (doc) => {
        doc.description = "Benchmark &lt encoded boundary.";
      },
      (doc) => {
        doc.cases[0].scenario = "Copyright marker &copy";
      },
      (doc) => {
        doc.cases[0].receipt.failure = "Soft hyphen marker &shy concealed.";
      },
      (doc) => {
        doc.cases[0].scenario = "Currency markers &cent and &pound.";
      },
      (doc) => {
        doc.description = "Legacy uppercase marker &AElig";
      },
    ];
    for (const mutate of mutations) {
      const doc = readFixture();
      mutate(doc);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /contains character-reference syntax/);
      assert.equal(result.stdout, "");
    }

    const safe = readFixture();
    safe.cases[0].scenario = "AT&T, R&D2;, and A&Bogus; launcher behavior.";
    const safeResult = runEvaluateWithDoc(safe);
    assert.equal(safeResult.status, 0, safeResult.stderr || safeResult.stdout);
  });

  it("rejects unsafe Unicode and controls in fixture prose without echoing them", () => {
    for (const character of ["\u202E", "\0", "\v", "\f"]) {
      const mutations = [
        (doc) => {
          doc.cases[0].scenario = `Safe scenario ${character} injected.`;
        },
        (doc) => {
          doc.cases[0].receipt.failure = `Safe failure ${character} injected.`;
        },
      ];
      for (const mutate of mutations) {
        const doc = readFixture();
        mutate(doc);
        const result = runEvaluateWithDoc(doc);
        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /unsafe Unicode or control character/);
        assert.equal(result.stderr.includes(character), false);
      }
    }
  });

  it("sanitizes case and host identifiers without echoing matches", () => {
    const mutations = [
      (doc) => {
        doc.cases[0].id = "private.user@example.com";
      },
      (doc) => {
        doc.cases[0].scope.host = "private.user@example.com";
      },
      (doc) => {
        doc.cases[0].receipt.host = "private.user@example.com";
      },
    ];

    for (const mutate of mutations) {
      const doc = readFixture();
      mutate(doc);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /contains a high-confidence sensitive value/);
      assert.equal(result.stderr.includes("private.user@example.com"), false);
    }
  });

  it("validates and sanitizes stored and rendered benchmark metadata", () => {
    const sensitiveMutations = [
      (doc) => {
        doc.benchmark = "private.user@example.com";
      },
      (doc) => {
        doc.description = "Contact private.user@example.com for benchmark details.";
      },
      (doc) => {
        doc.baseline.repository = "private.user@example.com";
      },
    ];
    for (const mutate of sensitiveMutations) {
      const doc = readFixture();
      mutate(doc);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /contains a high-confidence sensitive value/);
      assert.equal(result.stderr.includes("private.user@example.com"), false);
    }

    const invalidMetadata = [
      [(doc) => {
        doc.description = "x".repeat(513);
      }, /description must be one non-Markdown line of at most 512 characters/],
      [(doc) => {
        doc.description = "Safe text\u2028Injected heading";
      }, /description contains an unsafe Unicode or control character/],
      [(doc) => {
        doc.description = "Safe text | injected table cell";
      }, /description must be one non-Markdown line/],
      [(doc) => {
        doc.baseline.repository = "owner/repository/extra";
      }, /repository must be an owner\/repository identifier/],
      [(doc) => {
        doc.baseline.commit = "ABCDEF";
      }, /commit must be a lowercase 40-character Git commit/],
    ];
    for (const [mutate, expectedError] of invalidMetadata) {
      const doc = readFixture();
      mutate(doc);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, expectedError);
    }
  });

  it("bounds every rendered identifier and rejects table-cell injection", () => {
    const exact = readFixture();
    exact.benchmark = "b".repeat(128);
    exact.cases[0].scope.host = "h".repeat(128);
    exact.cases[0].receipt.host = "h".repeat(128);
    let result = runEvaluateWithDoc(exact);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const mutations = [
      (doc) => {
        doc.benchmark = "b".repeat(129);
      },
      (doc) => {
        doc.cases[1].id = "c".repeat(129);
      },
      (doc) => {
        doc.cases[0].scope.host = "h".repeat(129);
        doc.cases[0].receipt.host = "h".repeat(129);
      },
      (doc) => {
        doc.benchmark = "benchmark|injected";
      },
      (doc) => {
        doc.cases[1].id = "case|injected";
      },
      (doc) => {
        doc.cases[0].scope.host = "host|injected";
        doc.cases[0].receipt.host = "host|injected";
      },
    ];
    for (const mutate of mutations) {
      const doc = readFixture();
      mutate(doc);
      result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1, result.stdout);
      assert.match(
        result.stderr,
        /must be a lowercase host-neutral identifier of at most 128 characters/,
      );
    }
  });

  it("bounds and de-structures every stored fixture prose field", () => {
    const exact = readFixture();
    exact.description = "d".repeat(512);
    exact.cases[0].scenario = "s".repeat(512);
    exact.cases[0].receipt.failure = "f".repeat(512);
    let result = runEvaluateWithDoc(exact);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const mutations = [
      (doc) => {
        doc.cases[0].scenario = "s".repeat(513);
      },
      (doc) => {
        doc.cases[0].receipt.failure = "f".repeat(513);
      },
      (doc) => {
        doc.cases[0].scenario = "Safe\u2029Injected";
      },
      (doc) => {
        doc.cases[0].receipt.failure = "Safe | injected";
      },
      (doc) => {
        doc.cases[0].scenario = "Safe [link](target)";
      },
      (doc) => {
        doc.cases[0].receipt.failure = "Safe `code`";
      },
    ];
    for (const mutate of mutations) {
      const doc = readFixture();
      mutate(doc);
      result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1, result.stdout);
      assert.match(
        result.stderr,
        /must be one non-Markdown line of at most 512 characters|unsafe Unicode or control character/,
      );
    }
  });

  it("bounds the baseline repository identifier", () => {
    const exact = readFixture();
    exact.baseline.repository = `${"a".repeat(99)}/${"b".repeat(100)}`;
    let result = runEvaluateWithDoc(exact);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const oversized = readFixture();
    oversized.baseline.repository = `${"a".repeat(100)}/${"b".repeat(100)}`;
    result = runEvaluateWithDoc(oversized);
    assert.equal(result.status, 1, result.stdout);
    assert.match(
      result.stderr,
      /repository must be an owner\/repository identifier of at most 200 characters/,
    );
  });

  it("validates optional artifact-observation fields when present", () => {
    const accepted = readFixture();
    accepted.cases[0].receipt.applied_existing_artifact = null;
    accepted.cases[0].receipt.candidate_artifact_status = null;
    let result = runEvaluateWithDoc(accepted);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const invalidApplied = readFixture();
    invalidApplied.cases[0].receipt.applied_existing_artifact = "true";
    result = runEvaluateWithDoc(invalidApplied);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /applied_existing_artifact must be boolean or null/);

    for (const value of ["unknown", 42]) {
      const invalidStatus = readFixture();
      invalidStatus.cases[0].receipt.candidate_artifact_status = value;
      result = runEvaluateWithDoc(invalidStatus);
      assert.equal(result.status, 1, result.stdout);
      assert.match(
        result.stderr,
        /candidate_artifact_status must be null or one of candidate, verified, stale, superseded/,
      );
    }
  });

  it("enforces false-trigger and stale-candidate consistency", () => {
    const impossibleFalseTrigger = readFixture();
    impossibleFalseTrigger.cases[0].expected.false_trigger = true;
    let result = runEvaluateWithDoc(impossibleFalseTrigger);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /false_trigger true requires consultation when consultation was not expected/,
    );

    const unobservedFalseTrigger = readFixture();
    unobservedFalseTrigger.cases[2].expected.false_trigger = true;
    result = runEvaluateWithDoc(unobservedFalseTrigger);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /false_trigger true requires consultation when consultation was not expected/,
    );

    const rejectedWithoutStale = readFixture();
    rejectedWithoutStale.cases[0].receipt.stale_rejected = true;
    result = runEvaluateWithDoc(rejectedWithoutStale);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /stale_rejected true requires candidate_artifact_status stale/,
    );

    const expectedWithoutStale = readFixture();
    expectedWithoutStale.cases[0].expected.stale_rejected = true;
    result = runEvaluateWithDoc(expectedWithoutStale);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /expected\.stale_rejected must match candidate_artifact_status stale/,
    );
  });

  it("requires read-only subagents to expect proposal and parent closure", () => {
    const doc = readFixture();
    doc.cases[0].scope.agent_role = "subagent-readonly";
    const result = runEvaluateWithDoc(doc);
    assert.equal(result.status, 1, result.stdout);
    assert.match(
      result.stderr,
      /subagent-readonly requires expected proposed_artifact, terminal semantics, and parent closure/,
    );
  });

  it("requires classification none and no_artifact to occur together", () => {
    const expectedMismatch = readFixture();
    expectedMismatch.cases[2].expected.terminal_outcome = "persisted_artifact";
    const result = runEvaluateWithDoc(expectedMismatch);
    assert.equal(result.status, 1, result.stdout);
    assert.match(
      result.stderr,
      /expected classification none and terminal_outcome no_artifact must occur together/,
    );
  });

  it("rejects negative attempt and step counts before scoring", () => {
    const invalidCounts = [
      ["receipt.repeated_failure_attempts_before", (doc) => {
        doc.cases[0].receipt.repeated_failure_attempts_before = -1;
      }],
      ["receipt.repeated_failure_attempts_after", (doc) => {
        doc.cases[0].receipt.repeated_failure_attempts_after = -1;
      }],
      ["receipt.steps_to_verified_normal_path", (doc) => {
        doc.cases[0].receipt.steps_to_verified_normal_path = -1;
      }],
      ["expected.time_to_verified_normal_path_max_steps", (doc) => {
        doc.cases[0].expected.time_to_verified_normal_path_max_steps = -1;
      }],
    ];

    for (const [field, mutate] of invalidCounts) {
      const doc = readFixture();
      mutate(doc);

      const result = runEvaluateWithDoc(doc);

      assert.equal(result.status, 1, `${field} was accepted:\n${result.stdout}`);
      assert.match(result.stderr, /must be a nonnegative integer(?: or null)?/);
    }
  });

  it("rejects fractional attempt and step counts before scoring", () => {
    const invalidCounts = [
      ["receipt.repeated_failure_attempts_before", (doc) => {
        doc.cases[0].receipt.repeated_failure_attempts_before = 1.5;
      }],
      ["receipt.repeated_failure_attempts_after", (doc) => {
        doc.cases[0].receipt.repeated_failure_attempts_after = 0.5;
      }],
      ["receipt.steps_to_verified_normal_path", (doc) => {
        doc.cases[0].receipt.steps_to_verified_normal_path = 1.5;
      }],
      ["expected.time_to_verified_normal_path_max_steps", (doc) => {
        doc.cases[0].expected.time_to_verified_normal_path_max_steps = 1.5;
      }],
    ];

    for (const [field, mutate] of invalidCounts) {
      const doc = readFixture();
      mutate(doc);

      const result = runEvaluateWithDoc(doc);

      assert.equal(result.status, 1, `${field} was accepted:\n${result.stdout}`);
      assert.match(result.stderr, /must be a nonnegative integer(?: or null)?/);
    }
  });

  it("scores a consulted but wrong decision as a skill and classification failure", () => {
    const doc = readFixture();
    const receiptCase = doc.cases.find(
      (item) => item.id === "lc-eval-012-workaround-is-containment",
    );
    receiptCase.receipt.classification = "external";
    receiptCase.receipt.terminal_receipt.classification = "external";

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Skill decision quality \| 9\/11 \| 81\.8%/);
    assert.match(result.stdout, /Classification accuracy when consulted \| 10\/11 \| 90\.9%/);
    assert.match(
      result.stdout,
      /lc-eval-012-workaround-is-containment \| codex-synthetic \| pass \| fail \| fail/,
    );
  });

  it("does not credit unconsulted improvement to LoopCompass outcome metrics", () => {
    const doc = readFixture();
    doc.cases[4].receipt.repeated_failure_attempts_after = 0;
    doc.cases[4].receipt.steps_to_verified_normal_path = 2;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Repeated-failure reduction \| 7\/10 \| 70\.0%/);
    assert.match(result.stdout, /Time to verified normal path \| 7\/10 \| 70\.0%/);
  });

  it("reports false triggers from expected no-consultation cases", () => {
    const doc = readFixture();
    doc.cases[2].receipt.consulted = true;
    doc.cases[2].receipt.host_enforced = true;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /False trigger rate \| 1\/1 \| 100\.0%/);
  });

  it("rejects an incomplete structured receipt before scoring", () => {
    const doc = readFixture();
    const receiptCase = doc.cases.find(
      (c) => c.id === "lc-eval-012-workaround-is-containment",
    );
    delete receiptCase.receipt.terminal_receipt.mechanism_health;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /terminal_receipt\.mechanism_health is required/,
    );
  });

  it("requires semantic expectations for every required terminal receipt", () => {
    const doc = readFixture();
    const receiptCase = doc.cases.find(
      (c) => c.id === "lc-eval-012-workaround-is-containment",
    );
    delete receiptCase.expected.terminal_receipt_semantics;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /terminal_receipt_semantics is required when terminal_receipt_required is true/,
    );
  });

  it("rejects incomplete, unknown, or classification-inconsistent semantic expectations", () => {
    const mutations = [
      (semantics) => {
        delete semantics.no_artifact_reason;
      },
      (semantics) => {
        semantics.raw_log = "unmodeled expectation";
      },
      (semantics) => {
        semantics.proposed_artifact.kind = "recovery";
      },
    ];

    for (const mutate of mutations) {
      const doc = readFixture();
      const receiptCase = doc.cases.find(
        (c) => c.id === "lc-eval-015-missing-parent-receipt",
      );
      mutate(receiptCase.expected.terminal_receipt_semantics);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 1);
    }
  });

  it("does not allow a present receipt to opt out of semantic scoring", () => {
    const doc = readFixture();
    const receiptCase = doc.cases.find(
      (c) => c.id === "lc-eval-012-workaround-is-containment",
    );
    receiptCase.expected.terminal_receipt_required = false;
    delete receiptCase.expected.terminal_receipt_semantics;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /terminal_receipt_required must be true for classification incident/,
    );
  });

  it("derives terminal receipt requiredness from every classified expectation", () => {
    const doc = readFixture();
    const receiptCase = doc.cases.find(
      (c) => c.id === "lc-eval-011-workaround-erases-classification",
    );
    receiptCase.expected.terminal_receipt_required = false;
    delete receiptCase.expected.terminal_receipt_semantics;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /terminal_receipt_required must be true for classification incident/,
    );
  });

  it("does not allow proposed-artifact cases to shrink the parent denominator", () => {
    const doc = readFixture();
    const receiptCase = doc.cases.find(
      (c) => c.id === "lc-eval-013-parent-without-store-propagates",
    );
    receiptCase.receipt.parent_receipt = null;
    receiptCase.expected.parent_receipt_required = false;
    delete receiptCase.expected.parent_receipt_semantics;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /proposed_artifact requires terminal_receipt_required and parent_receipt_required/,
    );
  });

  it("rejects parent semantics without terminal semantics explicitly", () => {
    const doc = readFixture();
    const receiptCase = doc.cases.find(
      (c) => c.id === "lc-eval-003-expected-negative",
    );
    receiptCase.expected.parent_receipt_semantics = structuredClone(
      doc.cases.find((c) => c.id === "lc-eval-015-missing-parent-receipt")
        .expected.parent_receipt_semantics,
    );

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /parent_receipt_semantics requires expected terminal_receipt_semantics/,
    );
  });

  it("requires parent semantic expectations whenever a parent receipt is present", () => {
    const doc = readFixture();
    const receiptCase = doc.cases.find(
      (c) => c.id === "lc-eval-014-parent-no-artifact",
    );
    delete receiptCase.expected.parent_receipt_semantics;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /parent_receipt_semantics is required when parent_receipt is present/,
    );
  });

  it("rejects receipt-id reuse across cases", () => {
    const doc = readFixture();
    const first = doc.cases.find(
      (c) => c.id === "lc-eval-008-subagent-readonly-handoff",
    );
    const second = doc.cases.find(
      (c) => c.id === "lc-eval-014-parent-no-artifact",
    );
    second.receipt.terminal_receipt.receipt_id =
      first.receipt.terminal_receipt.receipt_id;

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /receipt_id duplicates cases\[7\]/);
  });

  it("rejects a parent receipt that does not preserve a propagated payload", () => {
    const doc = readFixture();
    const receiptCase = doc.cases.find(
      (c) => c.id === "lc-eval-013-parent-without-store-propagates",
    );
    receiptCase.receipt.parent_receipt.forwarded_receipt.evidence.pop();

    const result = runEvaluateWithDoc(doc);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /forwarded_receipt must preserve the complete child receipt unchanged/,
    );
  });

  it("scores structurally valid but semantically wrong receipt fields as failures", () => {
    const mutations = [
      (terminal) => {
        terminal.task_outcome = "incomplete";
      },
      (terminal) => {
        terminal.mechanism_health = "healthy";
      },
      (terminal) => {
        terminal.containment = {
          used: false,
          summary: null,
          verification_gate: null,
        };
      },
    ];

    for (const mutate of mutations) {
      const doc = readFixture();
      const receiptCase = doc.cases.find(
        (c) => c.id === "lc-eval-012-workaround-is-containment",
      );
      mutate(receiptCase.receipt.terminal_receipt);

      const result = runEvaluateWithDoc(doc);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(
        result.stdout,
        /Terminal receipt semantic accuracy \| 10\/14 \| 71\.4%/,
      );
      assert.match(result.stdout, /Skill decision quality \| 9\/11 \| 81\.8%/);
      assert.match(
        result.stdout,
        /lc-eval-012-workaround-is-containment \| codex-synthetic \| pass \| fail \| pass \| pass \| pass \| fail \| n\/a/,
      );
    }
  });

  it("scores every nested terminal semantic value, not only shape", () => {
    const mutations = [
      (terminal) => {
        terminal.containment.summary = "Use a different bounded containment.";
      },
      (terminal) => {
        terminal.containment.verification_gate = "Use a different verification gate.";
      },
      (terminal) => {
        terminal.artifact_ref = `${terminal.artifact_ref}-2`;
      },
      (terminal) => {
        terminal.escalation.requires = ["process_control"];
      },
      (terminal) => {
        terminal.escalation.target = "different repair owner";
      },
      (terminal) => {
        terminal.escalation.action = "Perform a different exact action.";
      },
    ];

    for (const mutate of mutations) {
      const doc = readFixture();
      const receiptCase = doc.cases.find(
        (c) => c.id === "lc-eval-012-workaround-is-containment",
      );
      mutate(receiptCase.receipt.terminal_receipt);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Terminal receipt semantic accuracy \| 10\/14 \| 71\.4%/);
    }

    const proposedDoc = readFixture();
    const proposedCase = proposedDoc.cases.find(
      (c) => c.id === "lc-eval-015-missing-parent-receipt",
    );
    proposedCase.receipt.terminal_receipt.proposed_artifact.content =
      proposedCase.receipt.terminal_receipt.proposed_artifact.content.replace(
        "Correct the wrapper configuration contract and its authoritative tests.",
        "Correct the documented wrapper configuration and its authoritative tests.",
      );
    const proposedResult = runEvaluateWithDoc(proposedDoc);
    assert.equal(proposedResult.status, 0, proposedResult.stderr || proposedResult.stdout);
    assert.match(proposedResult.stdout, /Terminal receipt semantic accuracy \| 10\/14 \| 71\.4%/);
  });

  it("scores exact signature, dedupe key, and minimal evidence semantics", () => {
    const mutations = [
      (terminal) => {
        terminal.signature =
          "Skill validator exits before validation at import yaml in documented Python runtimes!";
      },
      (terminal) => {
        terminal.dedupe_key = "different|validator|identity";
      },
      (terminal) => {
        terminal.evidence = ["Different but structurally valid sanitized evidence."];
      },
    ];

    for (const mutate of mutations) {
      const doc = readFixture();
      const receiptCase = doc.cases.find(
        (c) => c.id === "lc-eval-012-workaround-is-containment",
      );
      mutate(receiptCase.receipt.terminal_receipt);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Terminal receipt semantic accuracy \| 10\/14 \| 71\.4%/);
      assert.match(result.stdout, /Skill decision quality \| 9\/11 \| 81\.8%/);
    }
  });

  it("scores exact authoritative parent payloads and no-artifact reasons", () => {
    const mutations = [
      ["lc-eval-008-subagent-readonly-handoff", (parent) => {
        parent.artifact_ref = `${parent.artifact_ref}-2`;
      }],
      ["lc-eval-008-subagent-readonly-handoff", (parent) => {
        parent.escalation.action = "Perform a different repair action.";
      }],
      ["lc-eval-014-parent-no-artifact", (parent) => {
        parent.no_artifact_reason = "A different sanitized no-artifact reason.";
      }],
    ];

    for (const [id, mutate] of mutations) {
      const doc = readFixture();
      const receiptCase = doc.cases.find((c) => c.id === id);
      mutate(receiptCase.receipt.parent_receipt);
      const result = runEvaluateWithDoc(doc);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Worker-to-parent closure \| 2\/4 \| 50\.0%/);
    }
  });
});
