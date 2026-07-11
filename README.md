<div align="center">

# 🧭 LoopCompass

**Agents remember the right path and repair the broken one.**

A lightweight, provider-neutral skill for agent workflows.<br>
No daemon, no CLI, no database, no model API, no hosted service. Just small, reviewable files.

[How it works](#the-classification-gate) · [What it stores](#what-lives-in-your-repository) · [Install](#install) · [Update](#update) · [Design](#design-principles)

</div>

---

## Every agent is lost in the same forest

Agents repeatedly hit the same environment, tool, permission, API, CI, and workflow failures.
Useful recoveries disappear into transcripts, while clever workarounds harden into folklore.

|                        | 🌲 Without a compass             | 🧭 With LoopCompass                            |
| ---------------------- | -------------------------------- | ---------------------------------------------- |
| A failure appears      | Blind retry, again               | Consult once before retrying                   |
| A recovery works       | Vanishes with the transcript     | Verified, then preserved                       |
| A workaround sticks    | Hardens into folklore            | Classified: keep it, or fix the root cause     |
| Same wall, next week   | Walk in circles                  | Follow the needle straight past it             |

LoopCompass turns recurring failures into one of two outcomes:

1. **Verified operational knowledge** when the recovery is the correct way to use a tool or respect
   a legitimate constraint.
2. **Root-cause repair** when a permission, configuration, wrapper, workflow, or other mechanism
   should not remain broken.

## The classification gate

```text
failure
  -> retrieve relevant repository knowledge
  -> classify
     -> correct operating behavior -> verify and preserve a concise recovery
     -> repairable defect -> escalate, repair, verify the normal path, close
     -> external defect -> track expiring containment until repair
     -> bypass or coincidence -> preserve nothing
```

| The failure was really…        | LoopCompass…                                          | What survives           |
| ------------------------------ | ----------------------------------------------------- | ----------------------- |
| **Correct operating behavior** | verifies the recovery and keeps it concise            | 🧠 a recovery           |
| **Repairable defect**          | escalates, repairs, verifies the normal path, closes  | 🔧 a closed incident    |
| **External defect**            | tracks expiring containment until upstream repair     | ⏳ an expiring incident |
| **Bypass or coincidence**      | preserves nothing                                     | 🚫 nothing              |

## What lives in your repository

Projects using LoopCompass keep small, reviewable Markdown artifacts:

```text
.loopcompass/
├── recoveries/
│   └── <verified-operational-knowledge>.md
└── incidents/
    └── <open-repair-obligation>.md
```

Agents search first, then read only the top one to three matches. The corpus is never loaded into
context wholesale.

## Automatic agent flow

LoopCompass is designed to activate through repository policy, including for delegated agents:

```text
unexpected operational failure
  -> consult once for this failure signature before a blind retry
  -> use the installed skill or search .loopcompass directly
  -> apply a verified in-scope recovery, or repair and escalate by capability
  -> verify the intended path and resume the task
```

Project instructions provide best-effort automatic behavior across agent hosts. Skill preloading
improves availability where supported, while direct `.loopcompass` search provides a fail-open
fallback. See [project integration](skills/loop-compass/references/integration.md).

> [!NOTE]
> **"Automatic" means agents consult, classify, repair, and escalate on their own.** Saving a new
> recovery still asks for your approval by default, so nothing unverified sneaks into shared
> knowledge. Once you trust the verification, repository policy can turn on automatic saves too.

## Install

Prefer an **immutable GitHub release** over floating `main`. Each release ships `VERSION`, the
skill tree (including `manifest.yaml`), docs, and a separate `SHA256SUMS` asset.

1. Install or copy [`skills/loop-compass`](skills/loop-compass) into the skill directory supported
   by your agent host (`personal`) or into this repository (`project-local`).
2. Merge the **entire marked** canonical policy from
   [`project-policy.md`](skills/loop-compass/assets/project-policy.md) into the repository's
   inherited project instructions (`AGENTS.md`, `CLAUDE.md`, or host equivalent). Keep the
   `<!-- loopcompass:start policy=N -->` and `<!-- loopcompass:end -->` markers intact.
3. Confirm the installed skill includes `manifest.yaml` and that `.loopcompass/recoveries` plus
   `.loopcompass/incidents` exist or can be created later by normal use.

The core uses the open `SKILL.md` format and ordinary file operations. Ordinary failure
consultation stays offline and does not check for software updates.

You can ask a capable agent to handle install:

```text
Install LoopCompass version 0.1.0 as a project-local installation from the matching commit-pinned
GitHub release at https://github.com/adammmmmm/LoopCompass. Follow docs/update-strategy-v1.md;
install the canonical managed policy block for this host. Validate skill discovery and the direct
.loopcompass fallback, then report the installed version, scope, and release commit. Do not add
hooks or a runtime CLI.
```

Host-specific plugin packaging may improve installation later, but the portable skill remains the
source of behavior.

## Update

Updates are **explicit and agent-assisted**. They replace the installed skill as one validated unit,
update only the managed policy block for project scope, and preserve
`.loopcompass/recoveries` and `.loopcompass/incidents` byte-for-byte. Full contract:
[docs/update-strategy-v1.md](docs/update-strategy-v1.md).

### Update one project

```text
Update the project-local LoopCompass installation in this project from the latest stable release at
https://github.com/adammmmmm/LoopCompass. Follow docs/update-strategy-v1.md: replace the installed
skill as one validated unit, update only the managed LoopCompass policy block, preserve
.loopcompass/recoveries and .loopcompass/incidents byte-for-byte, stop on compatibility or
local-modification conflicts, and report the old and new versions plus validation evidence.
```

### Update a personal skill

```text
Update my personal LoopCompass skill from the latest stable release at
https://github.com/adammmmmm/LoopCompass. Follow docs/update-strategy-v1.md, verify the release
manifest, preserve project state, validate host discovery, and inspect policy versions only in the
current project and additional repository roots I explicitly provide. Do not search for or modify
other projects without separate authorization.
```

### Check for an update (non-mutating)

```text
Without modifying any files, report whether the installed LoopCompass skill is behind the latest
stable GitHub release at https://github.com/adammmmmm/LoopCompass. Compare installed
manifest.yaml version/commit/policy_version to the release manifest. If behind, print old and new
versions and the update one-liner. Do not install or rewrite policy.
```

Maintainer tooling in this repository (not required for consumers):

```text
node scripts/release.mjs generate   # write skills/loop-compass/manifest.yaml
node scripts/release.mjs validate   # verify digests and policy markers
node scripts/release.mjs package    # dist archive + SHA256SUMS
```

## Manual conformance test

Normal use is policy-triggered. Explicit invocation is useful for installation checks and ad hoc
diagnosis:

```text
Use LoopCompass to classify this Git permission failure and coordinate the correct repair.
```

```text
Use LoopCompass to check whether this CLI behavior is already known before retrying it.
```

## Design principles

- Repair mechanisms, not symptoms.
- Preserve correct operating knowledge, not clever bypasses.
- Require evidence before calling a recovery verified.
- Keep all live state repository-local, small, and human-reviewable.
- Retrieve narrowly and keep agent briefs lean.
- Fail open if the learning layer is unavailable.
- Add automation only when measured failure modes justify it.
- Update software explicitly; never during ordinary failure consultation.

<details>
<summary><b>Planned optional hooks</b></summary>
<br>

Hooks are a future optional lever for hosts that need stronger enforcement or measurement. They are
not required for core behavior and will remain deferred unless cross-host tests show materially
unacceptable missed consultations or repeated blind retries. Any hook must be bounded, privacy-safe,
fail-open, and removable without disabling the skill or `.loopcompass` fallback.

</details>

See [docs/design.md](docs/design.md) for the architecture and decision record.
See [docs/update-strategy-v1.md](docs/update-strategy-v1.md) for the explicit v1 installation,
update, check, and rollback contract.
See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Status

> [!IMPORTANT]
> LoopCompass is an early design and skill implementation. The first milestone is to validate the
> two-lane workflow and policy-triggered consultation across multiple agent hosts. V1 software
> updates are explicit and release-based; silent update checks during ordinary use remain deferred.

## License

[MIT](LICENSE)

---

<div align="center">
<sub>Lost in the loop? Follow the needle. 🧭</sub>
</div>
