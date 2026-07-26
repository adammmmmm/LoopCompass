# Optional human-attention integration profile

LoopCompass is capability-first. An action may belong to an agent, service, team, or human, and
autonomous projects remain fully conformant. This profile adds durable human visibility only for
projects that deliberately reserve particular actions or decisions for humans.

The profile is **optional and disabled by default**. Nothing in LoopCompass enables it implicitly.
A project without an enabled declaration has no `HANDOFF.md`, operator-queue, or other
human-projection requirement.

## Project declaration

An enabled project declares, in one project-governed configuration or policy surface:

- `enabled: true`;
- stable identifiers for capabilities reserved for humans;
- stable identifiers for decisions reserved for humans;
- exactly one durable, project-designated attention surface, such as `HANDOFF.md` or an equivalent
  project file, project issue tracker, or operator queue; and
- the project-designated integration authority responsible for writing and reconciling that
  surface;
- an explicit audit/retention policy for the minimal known-obligation registry described below.

The declaration is project configuration, not incident state. It must be available to every
coordinator responsible for incident lifecycle. A host adapter may choose its syntax, but it must
not merge declarations from several surfaces or infer enablement from the presence of a handoff
file.

State schema 1 needs no new incident fields. `owner` remains the lifecycle coordinator; it does not
identify the action actor and does not imply a human. An open incident needs human action when an
entry in its existing `requires` list matches a declared human-only capability. A project can
represent a human-only decision as a stable `decision:<project-decision-id>` token in `requires`
and declare that decision identifier in the profile. Profile matching must use exact stable
identifiers rather than names, prose, or assumptions about the `owner`.

If the action is not matched by the project declaration, it is non-human for this profile and has
no human-attention projection. This remains true when a human happens to perform an otherwise
non-human-only action.

## Projection invariant

While the profile is enabled:

> Every open incident whose next required action is declared human-only appears exactly once on
> the designated durable attention surface.

The projection is visibility and resume state. The `.loopcompass/incidents/<slug>.md` incident is
canonical. Every projection carries the canonical incident slug as its durable join key. A title,
conversation alias, person name, or list position is never the join key.

Formatting is consumer-defined. At minimum, the entry must convey:

- canonical incident slug;
- requested human action or decision;
- whether human action is pending or coordinator verification is pending;
- the current obligation revision described below; and
- enough location information to reach the canonical incident.

The projection must not become a second incident record. Detailed evidence, containment, repair
state, and closure authority remain with the incident.

## Persisted obligation marker

Schema 1 has no action-owner or verification-pending field. Therefore, an enabled profile must
persist a small, machine-detectable obligation marker on the same designated surface (or in its
project-governed configuration metadata) before reporting that human attention is durable. This
marker is reconciliation metadata, not another incident.

Each marker is keyed by canonical incident slug and carries:

- `state`: `human_action_pending`, `verification_pending`, `reassigned_nonhuman`, or
  `verified_closed`;
- a monotonically increasing integer `revision`;
- the requested action or stable decision/capability identifier while active; and
- for `verified_closed`, a non-sensitive durable reference to the normal-path verification and
  closure evidence.

The surface also maintains a minimal known-obligation registry keyed by canonical incident slug.
Register the slug before or atomically with the first obligation marker. This registry is the
durable expected-slug source used to detect accidental deletion of the incident, marker,
projection, and closure evidence together. It may contain only the slug and a project retention
policy reference; it need not repeat incident evidence or requested-action prose.

Do not remove a known-obligation registry entry as part of projection cleanup, incident deletion,
reassignment, installation, or ordinary reconciliation. It remains through the explicit
project-declared audit/retention period. Purging it is a distinct, authorized retention action
after the terminal marker and its evidence have satisfied that policy. Until then, a known slug
with no obligation marker is non-conformant even when every other current-state record is absent.

`human_action_pending` and `verification_pending` are active obligations and require exactly one
visible projection. `reassigned_nonhuman` and `verified_closed` are release markers and require no
human projection. Retain a release marker long enough for reconciliation and the project's normal
audit policy to prove why the projection disappeared.

When `requires` currently matches a declared human-only identifier, that canonical incident creates
or refreshes an active marker; a release marker cannot override the current requirement. When the
human step completes, advance the marker to `verification_pending` before changing or removing the
matched `requires` token. The persisted marker then keeps the projection required even though
schema 1 has no incident field for that phase.

A true human-to-non-human reassignment is a separate coordinator event: first update the canonical
incident so `requires` no longer matches a human-only identifier, then advance the marker to
`reassigned_nonhuman`. Merely removing the token after a human action is not a reassignment.

If verification fails and renewed human action is required, increment `revision` and transition
the marker from `verification_pending` back to `human_action_pending`. The greater revision wins
even though the state name may look earlier in the lifecycle. State names have no precedence;
reconciliation orders only by the explicit integer revision.

## Idempotent lifecycle

Reconciliation is an idempotent upsert by canonical incident slug:

1. Read the enabled profile declaration, known-obligation registry, canonical open incidents,
   persisted obligation markers, and referenced closure evidence.
2. Fail reconciliation for any known slug whose marker is absent; an otherwise empty current state
   is not evidence that the obligation never existed or was correctly closed.
3. Match current `requires` values exactly and reconcile them with the markers using the rules
   above.
4. If marker history contains several revisions for a slug, select the greatest valid integer
   revision. Divergent records with the same greatest revision are a hard conflict for the
   designated authority; never choose by document order or prose.
5. Deterministically render one projection for each active marker from the canonical slug,
   marker state and revision, requested action, and canonical incident location.
6. Replace all existing projections for that slug with the deterministic result. Do not merge
   fields from duplicates or guess which entry is newest or most advanced.
7. Reconcile entries that no longer match an active obligation as described below.
8. Re-read the surface and confirm the exactly-one invariant and matching obligation revision
   before reporting projection success.

Human acknowledgment or completion of the requested action is progress, not closure. Update the
same projection to `verification_pending` while the incident coordinator verifies the authoritative
normal path. Keep it there if verification fails or containment remains. The persisted
`verification_pending` marker is the schema-1 obligation source if the matched `requires` token has
already been removed. Removing the token merely because the human step finished must not
masquerade as a non-human reassignment.

Remove the projection only after verified closure. Verified closure means the LoopCompass
coordinator has removed obsolete containment, exercised the authoritative normal path from clean
preconditions, completed the normal incident-closure process, and advanced the marker to
`verified_closed` with a durable evidence reference. The projection must not disappear merely
because the human acknowledged, decided, or completed the requested step.

## Reassignment and reconciliation

- **Human to human:** update the same slug-keyed entry. Do not create an entry per person.
- **Non-human to human:** persist or advance the active marker and then upsert the entry before
  treating the escalation as durably surfaced.
- **Human to non-human:** when the canonical incident no longer requires any declared human-only
  capability or decision, persist a greater-revision `reassigned_nonhuman` marker and
  deterministically render no projection. This is reassignment, not incident closure; the incident
  stays open under its coordinator.
- **Duplicate:** discard the divergent presentation entries and deterministically render one from
  the selected obligation revision and canonical incident. Do not compare prose timestamps or
  treat one lifecycle state as inherently newer.
- **Orphan with verified closure evidence:** remove it.
- **Orphan without verified closure evidence:** do not guess that absence means closure. Retain or
  quarantine it on the designated surface and escalate reconciliation to that surface's declared
  authority.

A projection whose slug points at a different incident is an orphan plus a missing projection, not
an acceptable fuzzy match.

## Crash behavior

The incident and projection can be separate repository edits, so hosts must recover safely from
partial work:

- If the incident exists and needs human action but the projection is absent, retry the idempotent
  marker/upsert sequence.
- If the marker was written but the projection was not, render it from the marker.
- If duplicates or a partially rewritten projection exist, discard them, render from the selected
  marker revision, and verify one exact result remains.
- If a crash occurs after human action but before verification, retain or restore
  `verification_pending` from the persisted obligation marker.
- If closure completed but projection cleanup did not, advance the marker to `verified_closed`
  with a durable evidence reference, then remove the projection.
- If a projection is absent but its marker has not reached `verified_closed` or
  `reassigned_nonhuman`, restore it; absence alone is never closure evidence.
- Never report a human escalation as complete until the projection can be re-read from the
  designated durable surface.

These rules define conformance, not an implementation service. No daemon, hook, notification
system, global queue, or consumer-specific adapter is required.

## Authority and privacy

The project declaration grants only the authority to maintain the designated projection surface,
whether repository-local or in a connected project system. It does not expand authority to perform
the requested human action, edit the canonical incident outside existing permissions, or mutate
another queue. When the coordinating agent cannot write the surface, it must return the exact
missing permission or escalation instead of claiming the projection exists.

Keep the projection lean. Reference the canonical slug and summarize the requested action; do not
copy raw logs, private payloads, secrets, or unnecessary identity data into the attention surface.

## Conformance examples

- Profile disabled, human-only capability declared elsewhere, no projection: conformant because
  the profile is not enabled.
- Profile enabled, one human-action incident, zero or two matching entries: non-conformant.
- Profile enabled, human action acknowledged, one `verification_pending` entry: conformant.
- Human step complete, verification pending, entry removed: non-conformant.
- Human token removed after action, active `verification_pending` marker and one projection:
  conformant.
- Human token removed by true reassignment, `reassigned_nonhuman` marker and no projection:
  conformant.
- Verification fails, greater-revision `human_action_pending` marker replaces the earlier
  `verification_pending` projection: conformant.
- `verified_closed` marker with durable closure evidence and no projection: conformant.
- Projection removed with no durable closure evidence: non-conformant.
- Known-obligation slug remains but incident, marker, projection, and closure evidence are all
  absent: non-conformant.
- Open incident requiring only an agent capability, no entry: conformant.

Deterministic cases live at `fixtures/human-attention/cases.json` in the source repository. They
describe portable semantics only; live host adapters and presentation formats are outside this
profile.
