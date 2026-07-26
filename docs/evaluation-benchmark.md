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
| Skill decision quality | Classification, stale rejection, and terminal outcome quality only for consulted cases. |
| Classification accuracy when consulted | Recorded lane matches expected lane only for rows where consultation actually happened. |
| False trigger rate | Cases that should not consult but did. Lower is better. |
| Stale rejection rate | Expected stale artifacts rejected by current evidence. |
| Repeated-failure reduction | Expected repeated failures where recorded attempts fell after actual consultation. |
| Blind retry rate | Recorded blind retries across all cases. Lower is better. |
| Time to verified normal path | Actually consulted cases that reached the expected normal-path step budget. |
| Terminal outcome compliance | Final state is persisted artifact, no artifact, or proposed artifact as expected. |
| Terminal receipt completeness | Cases requiring a structured handoff that include a complete, valid receipt. |
| Terminal receipt semantic accuracy | Expected task outcome, mechanism health, and containment use all match the receipt. |
| Worker-to-parent closure | Required parent handoffs with a linked ingestion receipt and expected terminal action. |

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
or justification field, so mismatches fail closed before the report is generated.

Cases that exercise cross-actor coordination add `receipt.terminal_receipt` and optionally
`receipt.parent_receipt`, following the shipped
[terminal receipt contract](../skills/loop-compass/references/terminal-receipts.md). A deliberate
`terminal_receipt: null` represents an observed missed receipt and scores as incomplete when
`expected.terminal_receipt_required` is true. A present receipt is validated strictly: missing,
blank, malformed, or outcome-inconsistent fields stop evaluation rather than being scored as
partial success. `expected.parent_terminal_action` requires a linked parent receipt with that
action. `expected.terminal_receipt_semantics` separately scores `task_outcome`,
`mechanism_health`, and `containment.used`; it is required whenever
`expected.terminal_receipt_required` is true, so a fixture cannot opt out of semantic scoring.
Structural validity alone does not earn semantic credit.

The paired validator-workaround cases distinguish task completion from mechanism health. Passing
validation in an unrelated runtime is containment while the documented runtime remains broken;
success without consultation and terminal classification fails. The read-only-worker cases cover
both authoritative parent persistence and full-payload propagation by a parent that also lacks a
project store.

The fixture includes synthetic Codex, Claude, and Grok CLI host rows, plus parent, read-only
subagent, missing-skill fallback, and missing-project-instruction scenarios. These are measurement
cases, not provider claims.

The fixture does not claim live host performance. Add real Codex, Claude, Grok, Gemini, or other
host receipts only when the host version, run protocol, and budget are explicit.
