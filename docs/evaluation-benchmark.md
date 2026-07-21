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

The generated report includes a direct notice that the bundled rows are synthetic fixtures, not
live host evidence. Live host results should only be added when host versions, run protocol, and
budget are explicit.

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

## Fixture contract

`fixtures/evaluation/cases.json` is the versioned benchmark input. Each case has:

| Field | Purpose |
| --- | --- |
| `scenario` | Human-readable behavior being measured. |
| `scope` | Host, parent/subagent role, skill state, project-instruction state, and receipt type. |
| `receipt` | Synthetic or recorded host result. |
| `expected` | Deterministic expected result for scoring. |

The fixture includes synthetic Codex, Claude, and Grok CLI host rows, plus parent, read-only
subagent, missing-skill fallback, and missing-project-instruction scenarios. These are measurement
cases, not provider claims.

The fixture does not claim live host performance. Add real Codex, Claude, Grok, Gemini, or other
host receipts only when the host version, run protocol, and budget are explicit.
