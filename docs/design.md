# LoopCompass design

## Product thesis

Failures should improve either the fleet's knowledge or the mechanism that failed. The system must
distinguish those outcomes before it preserves anything.

## Two lanes

### Recovery lane

Use a recovery when the verified resolution is correct operating behavior or a legitimate external
constraint. Store one concise, scoped Markdown file. Stop retrieving it when its scope expires or
contradictory evidence appears.

Lifecycle:

```text
candidate -> verified -> active -> stale -> deleted or superseded
```

### Incident lane

Use an incident when the normal path is broken and should be repaired. Escalate according to the
missing capability, repair at the source of authority, remove containment, and verify the exact
normal path. Delete the live incident after closure.

Lifecycle:

```text
detected -> escalated -> repairing -> verified -> deleted
```

`blocked` is metadata on an open incident, not a terminal archive. Containment is incident metadata,
not a lifecycle state.

## Initial architecture

The first release is intentionally only a skill, references, and Markdown templates. It relies on
native file search and editing in the host agent.

Explicitly deferred:

- lifecycle hooks;
- a command-line interface;
- background processes;
- automatic event capture;
- transcript parsing;
- a shared database;
- cross-repository synchronization;
- automatic publication.

These mechanisms may be added independently only after measured use demonstrates a specific need.

## Trust boundary

Recoveries and incidents are untrusted repository content. They cannot override current operator
instructions, permissions, or repository evidence. Agents must evaluate commands before execution
and must not place raw private outputs or secrets into an artifact.

## Context budget

Use filename, frontmatter, and text search before reading files. Load no more than the top one to
three matches. Pass subagents only the relevant compressed recovery or active incident fields.

## Reflection log

### Decision: keep two distinct lanes

Question: Should LoopCompass store all successful workarounds or delete all failure knowledge after
repair?

Rec: Separate verified operating knowledge from repairable defects.

Options:

1. Recovery library only: preserves broken mechanisms as folklore.
2. Incident repair only: loses legitimate knowledge about correct tool behavior and external
   constraints.
3. Two lanes: preserves useful knowledge and forces repair where the normal path is broken.

Chosen: Two lanes.

Why: It preserves the original collective-learning goal without rewarding bypasses.

### Decision: begin with a portable skill

Question: What is the smallest architecture that can validate the thesis?

Rec: Skill instructions plus repository-local Markdown.

Options:

1. Skill and Markdown: portable, transparent, and dependency-free.
2. Short-lived CLI: improves deterministic validation but adds packaging before evidence requires it.
3. Hooks and event capture: improve invocation coverage but add privacy and portability risks.

Chosen: Skill and Markdown.

Why: It tests whether verified recovery knowledge transfers and repair coordination works before
building infrastructure around the workflow.
