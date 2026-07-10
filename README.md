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
.hive/
├── recoveries/
│   └── <verified-operational-knowledge>.md
└── incidents/
    └── <open-repair-obligation>.md
```

Agents search first, then read only the top one to three matches. The corpus is never loaded into
context wholesale.

## Install

Install or copy [`skills/loop-compass`](skills/loop-compass) into the skill directory supported by
your agent host. The core uses the open `SKILL.md` format and ordinary file operations.

Host-specific plugin packaging may improve installation later, but the portable skill remains the
source of behavior.

## Use

Invoke LoopCompass when an agent encounters a distinctive failure, repeats a failed approach,
discovers a verified recovery, or needs authority to repair a broken mechanism.

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

See [docs/design.md](docs/design.md) for the architecture and decision record.

## Status

LoopCompass is an early design and skill implementation. The first milestone is to validate the
two-lane workflow across multiple agent hosts before adding scripts, plugins, or automation.

## License

[MIT](LICENSE)
