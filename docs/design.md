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
candidate -> verified -> stale -> deleted or superseded
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
- a consumer-facing runtime CLI or daemon;
- background processes;
- automatic event capture;
- transcript parsing;
- a shared database;
- cross-repository synchronization;
- automatic publication;
- silent update checks or installs during ordinary failure consultation.

These mechanisms may be added independently only after measured use demonstrates a specific need.

Software distribution uses explicit, agent-assisted updates from immutable GitHub releases. See
[update-strategy-v1.md](update-strategy-v1.md). A maintainer-only `scripts/release.mjs` validates
manifest digests and builds release archives; it is not a runtime dependency of installed skills.

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
`.loopcompass` directly and continues fail-open if retrieval is unavailable.

Every triggered classification has a visible terminal outcome. A verified agent persists a
justified recovery or incident automatically within current repository authority, reports `no
artifact`, or returns the proposed artifact with the exact missing permission, capability, or
operator action. Explicit read-only instructions and safety boundaries override automatic writes.

Delegated agents with shared repository write authority follow the same rule. Brief-only or
read-only workers return the normalized signature, classification, evidence, proposed artifact,
and exact escalation to the parent, which must close the classification in the same turn.

## Artifact identity and concurrency

Normalize signatures by removing volatile paths, IDs, timestamps, and secret-bearing values. Derive
the artifact slug mechanically from the exact normalized signature: lowercase it, replace each
maximal run outside ASCII `a-z` and `0-9` with one hyphen, trim it, truncate it to 96 characters,
and trim it again. Use `failure` when empty. The ID is the slug and the filename is `<slug>.md`.
Search recoveries and incidents for the exact signature immediately before writing.

When a matching artifact exists, update or supersede it rather than creating another. Parallel
writes that still race should resolve around the deterministic artifact path, making the conflict
visible instead of silently creating divergent knowledge.

If the deterministic path contains a different signature, append the lowest available integer
suffix beginning with `-2`. Agents must not invent alternate descriptive filenames.

## Escalation ladder

Escalation names the failed normal path, evidence, missing capability, any containment, and the
verification gate. Each parent either repairs within its authority or passes the deduplicated
incident upward. The ladder terminates at the operator when no agent can act.

## Planned optional hooks

Hooks are an optional future lever for enforcement and measurement, not a core dependency. Consider
a host-specific hook only when cross-host acceptance tests show materially unacceptable missed
consultations or repeated blind retries. Any adopted hook must be documented by the host, narrowly
scoped, bounded, privacy-safe, fail-open, and removable without disabling skill or `.loopcompass`
behavior.

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
direct `.loopcompass` fallback.

Options:

1. Skill discovery alone: portable but easy for agents to miss.
2. Project policy plus skill: best-effort automatic and lightweight.
3. Mandatory lifecycle hooks: stronger observation but host-specific and premature.

Chosen: Project policy plus skill, with hooks planned as an evidence-gated optional lever.

Why: It closes the common parent and subagent path without making the portable core depend on host
automation.

### Decision: explicit release updates, not consult-time checks

Question: How should consumers learn about and apply LoopCompass software updates without adding a
runtime dependency?

Rec: Ship immutable GitHub releases with VERSION, skill manifest digests, managed policy markers,
and an explicit agent-assisted update contract. Optionally allow a non-mutating "check only"
prompt. Do not check or install during ordinary failure consultation.

Options:

1. Silent consult-time version checks: add network dependency and surprise latency to the failure
   path.
2. Mandatory updater CLI/daemon: stronger determinism but contradicts the lightweight portable core.
3. Explicit agent-assisted updates from releases, with optional non-mutating check prompts: offline
   normal use, reviewable mutation, provider-neutral delivery.

Chosen: Option 3.

Why: It preserves offline classification, repository review, and scope isolation (global vs
project) while still giving operators a complete apply, rollback, and integrity story. Automatic
discovery remains a future host-plugin opportunity.

### Decision: persist or escalate by default

Question: Should a classified failure wait for separate operator approval before it becomes durable
knowledge?

Rec: Persist justified recoveries and incidents automatically within current repository authority,
with explicit terminal outcomes for `no artifact` and permission or operator escalation.

Options:

1. Approval gate for every artifact: preserves operator control but routinely loses verified
   knowledge between the failure and a later approval exchange.
2. Repository-authority persistence: saves verified knowledge immediately while preserving
   explicit read-only, safety, and permission boundaries.
3. Hooks or background capture: improves enforcement but adds host-specific machinery and can
   preserve unclassified failures prematurely.

Chosen: Option 2.

Why: It matches the collective-memory goal without expanding authority. The agent must classify
and verify before writing, and must return the proposed artifact plus exact escalation whenever it
cannot write safely.

## Acceptance tests

1. A known deterministic failure causes consultation before the first equivalent retry.
2. An unexplained transient failure gets one ordinary retry, then consultation.
3. Expected validation and asynchronous states do not trigger.
4. An identical failure triggers only one consultation per agent task.
5. Changed evidence or environment permits a new consultation.
6. A worker without the skill reads no more than three `.loopcompass` matches and continues
   fail-open.
7. Missing `.loopcompass` directories do not block work. They are created when an artifact is
   justified and authorized, or the agent returns the exact persistence escalation.
8. Out-of-scope or expired recovery knowledge is rejected.
9. A repairable defect escalates instead of becoming a recovery.
10. Escalation reaches a capable agent or terminates at the operator.
11. Consultation failure does not recursively invoke LoopCompass.
12. Manual invocation exercises the same classification path as policy-triggered use.
13. Two agents handling the same signature converge on one deterministic artifact path.
14. Every triggered classification ends as persisted recovery, persisted incident, explicit `no
    artifact`, or proposed artifact with exact escalation.
15. A delegated read-only worker returns the full classification payload to a parent that closes
    the outcome in the same turn.

Update-contract acceptance tests live in [update-strategy-v1.md](update-strategy-v1.md).

## Executable verification

Mechanical rules are covered by `node scripts/verify.mjs`:

- signature normalization and slug derivation (`scripts/lib/signature.mjs`, `tests/signature.test.mjs`);
- classification fixtures (`fixtures/classification/cases.json`);
- artifact field checks and template contract alignment;
- project-scope install / update dry-runs;
- release inventory validate (`scripts/release.mjs validate`).

Behavioral policy acceptance tests (1-15 above) remain host-agent scenarios. Host coverage notes
live in [host-matrix.md](host-matrix.md).
