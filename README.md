<img src="docs/assets/logo.svg" alt="LoopCompass" width="280"/>

**Agents remember the right path and repair the broken one.**

A portable skill for agent workflows. No daemon, no CLI, no database, no model API, no hosted
service. Small Markdown files. Full fleet memory.

![0.1.0](https://img.shields.io/badge/version-0.1.0-1f2328?style=flat-square&labelColor=21262d&color=58a6ff)
![MIT](https://img.shields.io/badge/license-MIT-1f2328?style=flat-square&labelColor=21262d&color=3fb950)
![No runtime](https://img.shields.io/badge/runtime-none-1f2328?style=flat-square&labelColor=21262d&color=8b949e)
![Provider neutral](https://img.shields.io/badge/host-provider--neutral-1f2328?style=flat-square&labelColor=21262d&color=a371f7)

[How it works](#how-it-works) · [What it stores](#what-it-stores) · [Install](#install) · [Update](#update) · [Design](#design)

---

## Why it exists

Agents hit the same environment, tool, permission, API, CI, and workflow failures over and over.

Useful recoveries die in transcripts. Clever workarounds harden into folklore. The next agent pays
the same tax.

| | Without LoopCompass | With LoopCompass |
| --- | --- | --- |
| Failure appears | Blind retry | Consult once before retrying |
| Recovery works | Lost with the transcript | Verified, then preserved |
| Workaround sticks | Becomes folklore | Classified: keep or repair |
| Same wall next week | Circles | Needle past it |

Every recurring failure becomes one of two outcomes:

1. **Verified operational knowledge** when the path is correct tool use or a real constraint.
2. **Root-cause repair** when a mechanism should not stay broken.

---

## How it works

Consult once. Retrieve first. Classify before preserving anything.

<p align="center">
  <img src="docs/assets/flowchart-classification.svg" alt="Classification gate: failure, retrieve, classify, then recovery, incident, external, or nothing" width="720"/>
</p>

| Reality | Action | What survives |
| --- | --- | --- |
| Correct operating behavior | Verify and keep a concise recovery | Recovery |
| Repairable defect | Escalate, repair, verify the normal path, close | Closed incident |
| External defect | Track expiring containment until upstream repair | Expiring incident |
| Bypass or coincidence | Preserve nothing | Nothing |

### Two lanes

<p align="center">
  <img src="docs/assets/flowchart-two-lanes.svg" alt="Recovery and incident lifecycles" width="720"/>
</p>

| Lane | When | Where |
| --- | --- | --- |
| **Recovery** | The successful path is correct behavior | `.loopcompass/recoveries/` |
| **Incident** | The normal path is broken and should be fixed | `.loopcompass/incidents/` (deleted on close) |

A workaround is not a recovery just because it unblocked the task.

### Agent flow

Policy-triggered for parents and delegated agents. Fail open if the learning layer is unavailable.

<p align="center">
  <img src="docs/assets/flowchart-agent-flow.svg" alt="Agent flow: failure, consult once, retrieve, act, verify" width="720"/>
</p>

Skill preloading helps where the host supports it. Direct `.loopcompass` search is the fallback.
See [integration](skills/loop-compass/references/integration.md).

> [!NOTE]
> **Automatic consultation is not automatic persistence.** Agents consult, classify, repair, and
> escalate on their own. New recoveries still require operator approval by default. Repository
> policy can authorize verified agents to save once you trust the verification gate.

---

## What it stores

Repository-local Markdown. Human-reviewable. Never loaded wholesale into context.

```text
.loopcompass/
├── recoveries/   # verified operational knowledge
└── incidents/    # open repair obligations
```

Agents search first, then read only the top one to three matches.

---

## Install

Prefer an **immutable GitHub release** over floating `main`. Each release ships `VERSION`, the
skill tree (`manifest.yaml` included), docs, and a separate `SHA256SUMS` asset.

1. Copy [`skills/loop-compass`](skills/loop-compass) into your host skill directory (`personal`) or
   this repository (`project-local`).
2. Merge the **entire marked** block from
   [`project-policy.md`](skills/loop-compass/assets/project-policy.md) into `AGENTS.md`,
   `CLAUDE.md`, or the host equivalent. Keep
   `<!-- loopcompass:start policy=N -->` … `<!-- loopcompass:end -->` intact.
3. Confirm `manifest.yaml` is present. Create `.loopcompass/recoveries` and
   `.loopcompass/incidents` now, or let normal use create them.

Ordinary consultation is offline. It does not check for software updates.

```text
Install LoopCompass version 0.1.0 as a project-local installation from the matching commit-pinned
GitHub release at https://github.com/adammmmmm/LoopCompass. Follow docs/update-strategy-v1.md;
install the canonical managed policy block for this host. Validate skill discovery and the direct
.loopcompass fallback, then report the installed version, scope, and release commit. Do not add
hooks or a runtime CLI.
```

---

## Update

**Explicit and agent-assisted.** Replace the skill as one validated unit, update only the managed
policy block for project scope, preserve `.loopcompass/recoveries` and `.loopcompass/incidents`
byte-for-byte.

Contract: [docs/update-strategy-v1.md](docs/update-strategy-v1.md).

<details>
<summary><b>Agent prompts</b></summary>

**One project**

```text
Update the project-local LoopCompass installation in this project from the latest stable release at
https://github.com/adammmmmm/LoopCompass. Follow docs/update-strategy-v1.md: replace the installed
skill as one validated unit, update only the managed LoopCompass policy block, preserve
.loopcompass/recoveries and .loopcompass/incidents byte-for-byte, stop on compatibility or
local-modification conflicts, and report the old and new versions plus validation evidence.
```

**Personal skill**

```text
Update my personal LoopCompass skill from the latest stable release at
https://github.com/adammmmmm/LoopCompass. Follow docs/update-strategy-v1.md, verify the release
manifest, preserve project state, validate host discovery, and inspect policy versions only in the
current project and additional repository roots I explicitly provide. Do not search for or modify
other projects without separate authorization.
```

**Check only (non-mutating)**

```text
Without modifying any files, report whether the installed LoopCompass skill is behind the latest
stable GitHub release at https://github.com/adammmmmm/LoopCompass. Compare installed
manifest.yaml version/commit/policy_version to the release manifest. If behind, print old and new
versions and the update one-liner. Do not install or rewrite policy.
```

</details>

Maintainer tooling (not required for consumers):

```text
node scripts/release.mjs generate   # write skills/loop-compass/manifest.yaml
node scripts/release.mjs validate   # digests and policy markers
node scripts/release.mjs package    # dist archive + SHA256SUMS
```

---

## Try it

Normal use is policy-triggered. Explicit invocation for checks and diagnosis:

```text
Use LoopCompass to classify this Git permission failure and coordinate the correct repair.
```

```text
Use LoopCompass to check whether this CLI behavior is already known before retrying it.
```

---

## Design

| Principle | Meaning |
| --- | --- |
| Repair mechanisms | Not symptoms |
| Preserve correct knowledge | Not clever bypasses |
| Evidence before verified | Confidence is not proof |
| Repository-local state | Small, reviewable files |
| Narrow retrieval | Lean briefs; top 1–3 matches |
| Fail open | Missing skill never blocks the task |
| Automation is earned | Only after measured failure modes |
| Updates are explicit | Never during ordinary consultation |

<details>
<summary><b>Planned optional hooks</b></summary>

Hooks are a future lever for hosts that need stronger enforcement or measurement. Not required for
core behavior. Deferred unless cross-host tests show material missed consultations or blind retries.
Any hook must be bounded, privacy-safe, fail-open, and removable without disabling the skill or
`.loopcompass` fallback.

</details>

| Doc | Contents |
| --- | --- |
| [docs/design.md](docs/design.md) | Architecture and decisions |
| [docs/update-strategy-v1.md](docs/update-strategy-v1.md) | Install, update, check, rollback |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |
| [skills/loop-compass/SKILL.md](skills/loop-compass/SKILL.md) | Portable skill |

---

## Status

Early design and skill implementation. Near-term goal: validate the two-lane workflow and
policy-triggered consultation across agent hosts. V1 updates are release-based and explicit.
Silent update checks during ordinary use remain deferred.

## License

[MIT](LICENSE)
