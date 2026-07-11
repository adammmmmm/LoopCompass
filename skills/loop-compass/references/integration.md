# Project integration

The canonical policy is [project-policy.md](../assets/project-policy.md). Copy that **entire**
marked block without rewriting its semantics so each host shares one trigger contract.

## Managed policy markers

Install the policy between LoopCompass-owned markers:

```markdown
<!-- loopcompass:start policy=1 -->
...canonical LoopCompass policy...
<!-- loopcompass:end -->
```

The v1 updater may replace only the content from the opening marker through the closing marker. It
must preserve every byte of project instruction content outside that block. Missing, duplicated,
nested, malformed, or overlapping markers are a hard stop for updates.

## Codex

Merge the marked canonical policy into the closest repository `AGENTS.md` that governs tool-using
agents. When a delegated worker may not inherit repository instructions, add only the compact
reminder from the policy to its brief.

Skill availability and project-instruction inheritance vary by Codex surface. Treat both as
capabilities to verify, not assumptions. The direct `.loopcompass` fallback remains functional
without skill discovery.

## Claude Code

Merge the marked canonical policy into the repository `CLAUDE.md`. Normal tool-using subagents can
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

## Version and updates

Distributed skill installs include `manifest.yaml` next to `SKILL.md`. That file is the
authoritative installed version, source, schema, and per-file digest inventory.

Software updates are explicit and agent-assisted. They do not run during ordinary failure
consultation. Follow [docs/update-strategy-v1.md](../../../docs/update-strategy-v1.md) in the
LoopCompass source repository (or the copy shipped with a release) for install, update, check, and
rollback one-liners.

Scopes:

- **Personal skill:** user-level host skill directory; does not rewrite project policy.
- **Project-local skill:** skill committed in the repository; may update the managed policy block
  in that repository only.

Never modify `.loopcompass/recoveries/` or `.loopcompass/incidents/` during a software update.

## Conformance

Verify the host behavior with the acceptance tests in the project design document. Describe the
integration as policy-triggered or best-effort automatic unless the host provides and passes a
stronger enforcement mechanism.
