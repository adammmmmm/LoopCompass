# Evaluation benchmark

LoopCompass evaluation is intentionally host-agnostic. The first benchmark uses deterministic
fixtures and synthetic or recorded receipts, so it can run in CI without credentials, live agent
sessions, or provider budgets.

## Run

```sh
node scripts/evaluate.mjs --fixture fixtures/evaluation/cases.json
```

The command prints a Markdown report. It records the exact baseline commit in the fixture:

```text
d7879fec762322ae658603104c7c334ade6ba43f
```

## Metrics

| Metric | Meaning |
| --- | --- |
| Consultation recall | Expected consultations that actually happened before retry or classification. |
| Classification accuracy | Recorded lane matches expected lane. |
| False trigger rate | Cases that should not consult but did. Lower is better. |
| Stale rejection rate | Expected stale artifacts rejected by current evidence. |
| Blind retry rate | Recorded blind retries across all cases. Lower is better. |
| Terminal outcome compliance | Final state is persisted artifact, no artifact, or proposed artifact as expected. |

## Fixture contract

`fixtures/evaluation/cases.json` is the versioned benchmark input. Each case has:

| Field | Purpose |
| --- | --- |
| `scenario` | Human-readable behavior being measured. |
| `receipt` | Synthetic or recorded host result. |
| `expected` | Deterministic expected result for scoring. |

The fixture does not claim live host performance. Add real Codex, Claude, Grok, Gemini, or other
host receipts only when the host version, run protocol, and budget are explicit.
