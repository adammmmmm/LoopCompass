# Host matrix result

Copy this file to `docs/host-results/YYYY-MM-DD-<host-slug>.md` after a real pass.

| Field | Value |
| --- | --- |
| Date | YYYY-MM-DD |
| Host | e.g. Claude Code / Codex |
| Host version | |
| LoopCompass version | from installed `manifest.yaml` |
| LoopCompass commit | manifest.commit |
| Operator | |
| Project under test | |

## Scenario results

Use scenarios from [host-matrix.md](../host-matrix.md).

| # | Scenario | Result (Pass/Fail/N/A) | Evidence (one line) |
| --- | --- | --- | --- |
| 1 | Skill + policy present | | |
| 2 | Skill missing, policy present | | |
| 3 | Neither store exists | | |
| 4 | Verified recovery in scope | | |
| 5 | Repairable defect escalates | | |
| 6 | No-artifact classification | | |
| 7 | Delegated read-only handoff | | |
| 8 | Update dry-run | | |

## Misses

List skipped consultations or false triggers with short evidence. Empty if none.

## Notes

Optional host quirks.
