# Project integration

The canonical policy is [project-policy.md](../assets/project-policy.md). Copy that block without
rewriting its semantics so each host shares one trigger contract.

## Codex

Merge the canonical policy into the closest repository `AGENTS.md` that governs tool-using agents.
When a delegated worker may not inherit repository instructions, add only the one-line reminder
from the policy to its brief.

Skill availability and project-instruction inheritance vary by Codex surface. Treat both as
capabilities to verify, not assumptions. The direct `.hive` fallback remains functional without
skill discovery.

## Claude Code

Merge the canonical policy into the repository `CLAUDE.md`. Normal tool-using subagents can discover
project skills during execution. For custom subagents, preload the skill when appropriate:

```yaml
skills:
  - loop-compass
```

Preloading improves availability but does not enforce invocation. Keep the canonical policy and
fallback behavior in project instructions.

## Other hosts

Place the canonical policy in the host's inherited project-instruction surface. If the host has no
such surface, include the one-line reminder in every tool-using delegation and provide a resolvable
path to the installed skill or repository `.hive` directories.

## Conformance

Verify the host behavior with the acceptance tests in the project design document. Describe the
integration as policy-triggered or best-effort automatic unless the host provides and passes a
stronger enforcement mechanism.
