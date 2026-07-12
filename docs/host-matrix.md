# Host matrix (LoopCompass)

Portable core is skill + Markdown + repository policy. Hosts differ in skill discovery and
instruction inheritance. This matrix is the verification checklist for multi-host confidence.

## Scopes

| Scope | Skill location | Policy location | State |
| --- | --- | --- | --- |
| **Project** | `skills/loop-compass/` (or host project skill dir) | Marked block in project `AGENTS.md` / `CLAUDE.md` / equivalent | `.loopcompass/` in repo |
| **Global** | Host user skill directory (this machine's agent host) | Only projects that opt in with markers | Per-project `.loopcompass/` |

## Host checklist

Run after install and after each skill update. Mark Pass / Fail / N/A.

| Host | Skill discovery | Policy inheritance to subagents | Direct `.loopcompass` fallback | Fail-open when skill missing | Notes |
| --- | --- | --- | --- | --- | --- |
| OpenAI Codex / compatible | | | | | Uses `agents/openai.yaml` metadata |
| Claude Code / compatible | | | | | Merge policy into `CLAUDE.md` |
| Cursor / other SKILL.md hosts | | | | | Confirm path conventions |

## Required scenarios (per host)

1. **Skill present, policy present** - distinctive deterministic failure consults before equivalent retry.
2. **Skill missing, policy present** - agent searches `.loopcompass` directly, reads ≤3 matches, continues.
3. **Neither store exists** - task continues; no forced artifact creation.
4. **Verified recovery in scope** - applied only after trust evaluation of current evidence.
5. **Repairable defect** - escalates as incident; no permanent workaround recovery.
6. **Update dry-run** - `node scripts/release.mjs check --installed <dir> --release-manifest <manifest>` matches expectations.

## Recording results

When completing a matrix pass, copy [host-results/TEMPLATE.md](host-results/TEMPLATE.md) to
`docs/host-results/YYYY-MM-DD-<host-slug>.md` and fill:

- date, host version, LoopCompass `manifest.yaml` version + commit;
- Pass/Fail per scenario;
- any miss (skipped consultation) with short evidence.

Scaffold note: [host-results/2026-07-12-scaffold.md](host-results/2026-07-12-scaffold.md) documents
that behavioral host passes are still pending while mechanical CI is green.

Do not claim cross-host enforcement. Project instructions are best-effort automatic behavior.
