# Project integration

The canonical policy is [project-policy.md](../assets/project-policy.md). Copy that **entire**
marked block without rewriting its semantics so each host shares one trigger contract.

## Managed policy markers

Install the policy between LoopCompass-owned markers:

```markdown
<!-- loopcompass:start policy=3 -->
...canonical LoopCompass policy...
<!-- loopcompass:end -->
```

The v1 updater may replace only the content from the opening marker through the closing marker. It
must preserve every byte of project instruction content outside that block. Missing, duplicated,
nested, malformed, or overlapping markers are a hard stop for updates.

## Multi-host project layout

Many repos run more than one agent host. Install **one** skill unit. A Codex/Claude repository may
use a tracked `.agents` skill as the sole source and a repository-confined `.claude` symlink:

| Host | Skill path (project scope) | Policy file |
| --- | --- | --- |
| OpenAI Codex / compatible | `.agents/skills/loop-compass/` | `AGENTS.md` |
| Claude Code / compatible | `.claude/skills/loop-compass` symlink to `.agents/skills/loop-compass` | `CLAUDE.md` importing `@AGENTS.md` |
| Generic / single-host | `skills/loop-compass/` | host instruction file |

Rules:

1. Copy the entire `skills/loop-compass` directory from a release (or stage the supported
   one-source layout with
   `node scripts/release.mjs stage-install --project <repo> --hosts agents,claude`).
2. In the one-source layout, merge the marked policy block **once** into `AGENTS.md` and make
   `CLAUDE.md` exactly `@AGENTS.md` plus one final newline. Otherwise merge the block once into each
   independent host instruction file. Never nest or duplicate markers.
3. Never modify `.loopcompass/recoveries` or `.loopcompass/incidents` during install or update.
4. Track the regular `.agents` skill tree and the `.claude` symlink in Git. The verifier rejects
   untracked sources, symlink escape, divergent targets, and malformed or drifting provider
   imports. `node scripts/verify-consumer.mjs --project <repo>` checks both this topology and
   independent installs.

## Codex

Merge the marked canonical policy into the closest repository `AGENTS.md` that governs tool-using
agents. When a delegated worker may not inherit repository instructions, add only the compact
reminder from the policy to its brief.

Skill availability and project-instruction inheritance vary by Codex surface. Treat both as
capabilities to verify, not assumptions. The direct `.loopcompass` fallback remains functional
without skill discovery.

## Claude Code

For the supported one-source layout, make `CLAUDE.md` exactly:

```text
@AGENTS.md
```

This imports the policy owned by `AGENTS.md` without duplicating it. For an independent Claude
installation, merge the marked canonical policy into `CLAUDE.md`. Normal tool-using subagents can
discover project skills during execution. For custom subagents, preload the skill when appropriate:

```yaml
skills:
  - loop-compass
```

Preloading improves availability but does not enforce invocation. Keep the canonical policy and
fallback behavior in project instructions.

## Other hosts

Place the marked canonical policy in the host's inherited project-instruction surface. If the host
has no such surface, include the compact reminder in every tool-using delegation and provide a
resolvable path to the installed skill or repository `.loopcompass` directories.

## Optional human-attention profile

Human participation is not part of the portable-core requirement. The human-attention integration
profile is **disabled by default** and must be enabled by an explicit project declaration. A
project that does not enable it has no `HANDOFF.md` or other human-projection requirement.

When a project enables the profile, follow
[human-attention.md](human-attention.md). The project declares its human-only capabilities and
decisions, one durable attention surface, and the authority responsible for that surface. The
incident remains canonical; each human-attention entry is only a resumable projection keyed by the
canonical incident slug. Install and update flows must not create, rewrite, or reconcile that
consumer-owned surface, including its projection block, obligation markers, and known-obligation
registry.
The surface declaration is typed: repository-file adapters validate normalized root-confined paths
and symlink resolution, while external adapters validate a stable project-scoped identifier and
an exact stable authority identity against the current project identity and declared integration
authority. These observations are separate from configuration self-assertions. Retained registry
state must persistently bind the complete typed descriptor, including external project scope; a
missing binding fails closed for repair and reconciliation. Adapters use conditional write/version
checks or an equivalent lock for full-surface reconciliation.

## Version and updates

Distributed skill installs include `manifest.yaml` next to `SKILL.md`. That file is the
authoritative installed version, source, schema, and per-file digest inventory.

Software updates are explicit and agent-assisted. They do not run during ordinary failure
consultation. Follow [docs/update-strategy-v1.md](../../../docs/update-strategy-v1.md) in the
LoopCompass source repository (or the copy shipped with a release) for install, update, check, and
rollback one-liners.

Scopes:

- **Global skill:** this machine's host user skill directory; does not rewrite project policy.
- **Project skill:** skill committed in the repository; may update the managed policy block in that
  repository only.

Never modify `.loopcompass/recoveries/` or `.loopcompass/incidents/` during a software update.

## Conformance

Verify the host behavior with the acceptance tests in the project design document. Describe the
integration as policy-triggered or best-effort automatic unless the host provides and passes a
stronger enforcement mechanism.
