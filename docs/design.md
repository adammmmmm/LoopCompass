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

## Policy-triggered consultation

The portable enforcement layer is a canonical project policy plus the LoopCompass skill. The policy
defines when to consult, exclusions, retry limits, missing-skill fallback, and delegation behavior.
Host-specific instructions adapt placement without changing the semantic contract.

The trigger is once per normalized failure signature per agent task. A distinctive deterministic
failure triggers before a substantially equivalent retry. An unexplained transient failure gets one
ordinary retry before consultation. Expected failures and documented in-progress states do not
trigger.

Project instructions provide best-effort automatic behavior rather than a cross-host guarantee.
Skill preloading improves availability but does not enforce use. A worker without the skill searches
`.hive` directly and continues fail-open if retrieval is unavailable.

## Escalation ladder

Escalation names the failed normal path, evidence, missing capability, any containment, and the
verification gate. Each parent either repairs within its authority or passes the deduplicated
incident upward. The ladder terminates at the operator when no agent can act.

## Planned optional hooks

Hooks are an optional future lever for enforcement and measurement, not a core dependency. Consider
a host-specific hook only when cross-host acceptance tests show materially unacceptable missed
consultations or repeated blind retries. Any adopted hook must be documented by the host, narrowly
scoped, bounded, privacy-safe, fail-open, and removable without disabling skill or `.hive` behavior.

Hooks must not publish recoveries, infer causality, or turn raw tool output into a telemetry store.

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

### Decision: add policy without claiming enforcement

Question: How should subagents consult LoopCompass automatically without requiring hooks?

Rec: Use one canonical repository policy, host-specific placement, optional skill preloading, and a
direct `.hive` fallback.

Options:

1. Skill discovery alone: portable but easy for agents to miss.
2. Project policy plus skill: best-effort automatic and lightweight.
3. Mandatory lifecycle hooks: stronger observation but host-specific and premature.

Chosen: Project policy plus skill, with hooks planned as an evidence-gated optional lever.

Why: It closes the common parent and subagent path without making the portable core depend on host
automation.

## Acceptance tests

1. A known deterministic failure causes consultation before the first equivalent retry.
2. An unexplained transient failure gets one ordinary retry, then consultation.
3. Expected validation and asynchronous states do not trigger.
4. An identical failure triggers only one consultation per agent task.
5. Changed evidence or environment permits a new consultation.
6. A worker without the skill reads no more than three `.hive` matches and continues fail-open.
7. Missing `.hive` directories do not block work or create artifacts.
8. Out-of-scope or expired recovery knowledge is rejected.
9. A repairable defect escalates instead of becoming a recovery.
10. Escalation reaches a capable agent or terminates at the operator.
11. Consultation failure does not recursively invoke LoopCompass.
12. Manual invocation exercises the same classification path as policy-triggered use.
