# LoopCompass

> Agents remember the right path and repair the broken one.

LoopCompass is a lightweight, provider-neutral skill for agent workflows. It turns recurring
failures into one of two outcomes:

1. **Verified operational knowledge** when the recovery is the correct way to use a tool or respect
   a legitimate constraint.
2. **Root-cause repair** when a permission, configuration, wrapper, workflow, or other mechanism
   should not remain broken.

It does not require a daemon, hook, CLI, database, model API, or hosted service.

## Why LoopCompass

Agents repeatedly encounter the same environment, tool, permission, API, CI, and workflow
failures. Useful recoveries disappear into transcripts, while clever workarounds can harden into
folklore.

LoopCompass adds a classification gate:

```text
failure
  -> retrieve relevant repository knowledge
  -> classify
     -> correct operating behavior -> verify and preserve a concise recovery
     -> repairable defect -> escalate, repair, verify the normal path, close
     -> external defect -> track expiring containment until repair
     -> bypass or coincidence -> preserve nothing
```

## Repository state

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
fallback.
See [project integration](skills/loop-compass/references/integration.md).

## Install

Install or copy [`skills/loop-compass`](skills/loop-compass) into the skill directory supported by
your agent host, then merge the canonical
[`project-policy.md`](skills/loop-compass/assets/project-policy.md) block into the repository's
inherited project instructions. The core uses the open `SKILL.md` format and ordinary file
operations.

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

Example requests:

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

## Planned optional hooks

Hooks are a future optional lever for hosts that need stronger enforcement or measurement. They are
not required for core behavior and will remain deferred unless cross-host tests show materially
unacceptable missed consultations or repeated blind retries. Any hook must be bounded, privacy-safe,
fail-open, and removable without disabling the skill or `.loopcompass` fallback.

See [docs/design.md](docs/design.md) for the architecture and decision record.

## Status

LoopCompass is an early design and skill implementation. The first milestone is to validate the
two-lane workflow and policy-triggered consultation across multiple agent hosts before adding
scripts, plugins, or enforcement automation.

## License

[MIT](LICENSE)
