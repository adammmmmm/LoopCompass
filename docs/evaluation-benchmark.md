# Evaluation benchmark

LoopCompass evaluation is intentionally host-agnostic. The first benchmark uses deterministic
fixtures and synthetic or recorded receipts, so it can run in CI without credentials, live agent
sessions, or provider budgets. It separates two questions:

1. Did the host enforce consultation at the right time?
2. When consultation happened, did the LoopCompass decision classify and terminate correctly?

## Run

```sh
node scripts/evaluate.mjs --fixture fixtures/evaluation/cases.json
```

The command prints a Markdown report. It records the exact baseline commit in the fixture:

```text
d7879fec762322ae658603104c7c334ade6ba43f
```

## Metrics

The generated report watermark lists the receipt types actually present: synthetic, recorded, or
both. Schema 1 has no explicit live-run protocol contract, so every generated report also states
that its receipts are not live-host evidence absent such a protocol. A `recorded` label alone does
not establish a live run. Live host results should only be added when host versions, run protocol,
and budget are explicit.

| Metric | Meaning |
| --- | --- |
| Consultation recall | Expected consultations that actually happened before retry or classification. |
| Host enforcement quality | Whether the host triggered or skipped consultation as expected. |
| Skill decision quality | Classification, stale rejection, terminal outcome, structured receipt semantics, and required parent closure for consulted cases. |
| Classification accuracy when consulted | Recorded lane matches expected lane only for rows where consultation actually happened. |
| False trigger rate | Cases that should not consult but did. Lower is better. |
| Stale rejection rate | Expected stale artifacts rejected by current evidence. |
| Repeated-failure reduction | Expected repeated failures where recorded attempts fell after actual consultation. |
| Blind retry rate | Recorded blind retries across all cases. Lower is better. |
| Time to verified normal path | Actually consulted cases that reached the expected normal-path step budget. |
| Terminal outcome compliance | Final state is persisted artifact, no artifact, or proposed artifact as expected. |
| Terminal receipt completeness | Cases requiring a structured handoff that include a complete, valid receipt. |
| Terminal receipt semantic accuracy | Every expected modeled semantic value exactly matches the terminal receipt. |
| Worker-to-parent closure | Required parent handoffs have an exact linked ingestion and authoritative payload. |

## Fixture contract

`fixtures/evaluation/cases.json` is the versioned benchmark input. Each case has:

| Field | Purpose |
| --- | --- |
| `scenario` | Human-readable behavior being measured. |
| `scope` | Host, parent/subagent role, skill state, project-instruction state, and receipt type. |
| `receipt` | Synthetic or recorded host result. |
| `expected` | Deterministic expected result for scoring. |

Attempt counts, step counts, and step budgets must be nonnegative integers (with `null` allowed
only for `receipt.steps_to_verified_normal_path`). Invalid values stop evaluation before scoring.
Each `receipt.host` must exactly match its declared `scope.host`; schema 1 has no mismatch override
or justification field, so mismatches fail closed before the report is generated. The benchmark
name, case ids, and scope/receipt hosts are sanitized lowercase host-neutral identifiers of at most
128 characters. Their grammar excludes Markdown table delimiters. The fixture, baseline, case,
scope, receipt, and expected-result objects are closed schemas; unknown fields fail validation
rather than silently changing a metric denominator. Scenario text and recorded failure text follow
the receipt sanitation boundary. Each is a non-Markdown single line of at most 512 characters and
is rejected when it contains unsafe Unicode/control characters or a high-confidence personal home
path, email, or secret shape.
Case ids are unique. Every observed receipt object includes explicit `terminal_receipt` and
`parent_receipt` properties whose values are either complete objects or `null`; omission is not an
alternate representation of a miss.
The evaluator also owns a minimum required corpus inventory. Fixtures that erase the classified
positive, expected-negative, read-only proposal-and-closure, or missing-parent negative partitions
fail before scoring. Each mandatory id is bound to its expected classification, terminal outcome,
receipt requirements, and relevant observed closure shape, so preserving a name while replacing
its scenario does not preserve the partition. A fixture cannot redefine those denominators by
deleting or relabeling its own cases.

`fixture.metrics` must exactly match the evaluator's single ordered metric registry. Missing,
duplicate, unknown, or reordered entries fail validation. The same registry drives report
rendering, including `skill_decision_quality`, so inventory and output cannot drift independently.
Baseline repository and commit values use a strict `owner/repository` shape of at most 200
characters and a lowercase 40-character Git commit shape. The stored description is a sanitized,
non-Markdown single line of at most 512 characters, preventing report or fixture metadata from
injecting extra structure. The functional tokens `<user-home>`, `<project-root>`, `<secret>`,
`<id>`, `<hex>`, `<ts>`, `<path>`, and `<email>` are allowed inside fixture prose; other angle
brackets and Markdown metacharacters are rejected. When present,
`receipt.applied_existing_artifact` is boolean or null, and
`receipt.candidate_artifact_status` is null or a recovery lifecycle status.

Cases that exercise cross-actor coordination populate `receipt.terminal_receipt` and, when
observed, `receipt.parent_receipt`, following the shipped
[terminal receipt contract](../skills/loop-compass/references/terminal-receipts.md). A deliberate
`terminal_receipt: null` represents an observed missed receipt and scores as incomplete when
`expected.terminal_receipt_required` is true. Every case whose expected classification is
`recovery`, `incident`, or `external` must set that flag to true and provide terminal semantic
expectations; only an expected `none` classification may opt out. A present receipt is validated
strictly: missing,
blank, malformed, or outcome-inconsistent fields stop evaluation rather than being scored as
partial success. `expected.terminal_receipt_semantics` separately scores exact signature, dedupe
key, minimal evidence, `task_outcome`, `mechanism_health`, the complete containment values,
artifact/no-artifact payload, proposed artifact, and exact escalation; it is required whenever
`expected.terminal_receipt_required` is true, so a fixture cannot opt out of semantic scoring.
If a receipt is present, `terminal_receipt_required` must be true. Structural validity alone does
not earn semantic credit, and a missing receipt remains in the denominator instead of erasing the
unfinished classification obligation.

Expected `classification: none` and `terminal_outcome: no_artifact` must occur together. A fixture
cannot combine `none` with a persisted outcome to escape receipt validation or scoring.

`expected.parent_receipt_required` independently defines the worker-to-parent denominator, and
`expected.parent_receipt_semantics` scores the complete authoritative action: terminal action,
artifact reference or no-artifact reason, proposed content, escalation, and whether the complete
child receipt is forwarded. Every expected `proposed_artifact` outcome requires both a complete
terminal receipt and parent closure expectation. A present parent receipt cannot omit those
expectations. A required
parent receipt may be deliberately absent in a negative fixture, where it scores as failed closure.
Receipt ids must be unique across a fixture, and every parent links both the child id and canonical
child-payload SHA-256 digest.

Every `subagent-readonly` scope expects `proposed_artifact`, complete terminal semantics, and parent
closure semantics. The observed parent may remain absent in a deliberate negative fixture, but the
expected contract cannot downgrade or omit the worker-to-parent obligation.

The paired validator-workaround cases distinguish task completion from mechanism health. Passing
validation in an unrelated runtime is containment while the documented runtime remains broken;
success without consultation and terminal classification fails. The read-only-worker cases cover
both authoritative parent persistence and full-payload propagation by a parent that also lacks a
project store. Additional cases cover authoritative `no_artifact` and a missing parent receipt.

The fixture includes synthetic Codex, Claude, and Grok CLI host rows, plus parent, read-only
subagent, missing-skill fallback, and missing-project-instruction scenarios. These are measurement
cases, not provider claims.

The fixture does not claim live host performance. Add real Codex, Claude, Grok, Gemini, or other
host receipts only when the host version, run protocol, and budget are explicit.
