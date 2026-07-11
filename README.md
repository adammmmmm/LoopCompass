<div align="center">

# 🧭 LoopCompass

**Agents remember the right path and repair the broken one.**

A lightweight, provider-neutral skill for agent workflows.<br>
No daemon, no CLI, no database, no model API, no hosted service. Just small, reviewable files.

[How it works](#the-classification-gate) · [What it stores](#what-lives-in-your-repository) · [Install](#install) · [Design](#design-principles)

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

1. Install or copy [`skills/loop-compass`](skills/loop-compass) into the skill directory supported
   by your agent host.
2. Merge the canonical [`project-policy.md`](skills/loop-compass/assets/project-policy.md) block
   into the repository's inherited project instructions.

The core uses the open `SKILL.md` format and ordinary file operations.

You can ask a capable agent to handle both steps:

```text
Install LoopCompass from https://github.com/adammmmmm/LoopCompass for this project, preserve all
bundled skill files, merge its canonical project policy into this host's inherited repository
instructions, and verify skill discovery plus the direct .loopcompass fallback. Do not add hooks or
a CLI.
```

Host-specific plugin packaging may improve installation later, but the portable skill remains the
source of behavior.

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

<details>
<summary><b>Planned optional hooks</b></summary>
<br>

Hooks are a future optional lever for hosts that need stronger enforcement or measurement. They are
not required for core behavior and will remain deferred unless cross-host tests show materially
unacceptable missed consultations or repeated blind retries. Any hook must be bounded, privacy-safe,
fail-open, and removable without disabling the skill or `.loopcompass` fallback.

</details>

See [docs/design.md](docs/design.md) for the architecture and decision record.
See [docs/update-strategy-v1.md](docs/update-strategy-v1.md) for the explicit v1 installation
update and rollback contract.

## Status

> [!IMPORTANT]
> LoopCompass is an early design and skill implementation. The first milestone is to validate the
> two-lane workflow and policy-triggered consultation across multiple agent hosts before adding
> scripts, plugins, or enforcement automation.

## License

[MIT](LICENSE)

---

<div align="center">
<sub>Lost in the loop? Follow the needle. 🧭</sub>
</div>
