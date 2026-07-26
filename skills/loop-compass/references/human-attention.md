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
  surface.

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
- whether human action is pending or coordinator verification is pending; and
- enough location information to reach the canonical incident.

The projection must not become a second incident record. Detailed evidence, containment, repair
state, and closure authority remain with the incident.

## Idempotent lifecycle

Reconciliation is an idempotent upsert by canonical incident slug:

1. Read the enabled profile declaration and the canonical open incidents.
2. Derive the set needing human action by exact matching against `requires`.
3. Upsert one entry per member on the single designated surface.
4. Collapse duplicate entries for the same slug without dropping the newest requested action or
   verification state.
5. Reconcile entries that no longer match an open human-action incident as described below.
6. Re-read the surface and confirm the exactly-one invariant before reporting projection success.

Human acknowledgment or completion of the requested action is progress, not closure. Update the
same projection to `verification_pending` while the incident coordinator verifies the authoritative
normal path. Keep it there if verification fails or containment remains. During this state, retain
the matched human-only `requires` token (or an equivalent adapter-owned obligation snapshot) until
closure. Removing the token merely because the human step finished must not masquerade as a
non-human reassignment.

Remove the projection only after verified closure. Verified closure means the LoopCompass
coordinator has removed obsolete containment, exercised the authoritative normal path from clean
preconditions, and completed the normal incident-closure process. The projection must not
disappear merely because the human acknowledged, decided, or completed the requested step.

## Reassignment and reconciliation

- **Human to human:** update the same slug-keyed entry. Do not create an entry per person.
- **Non-human to human:** upsert the entry before treating the escalation as durably surfaced.
- **Human to non-human:** when the canonical incident no longer requires any declared human-only
  capability or decision, remove its projection as a reassignment, not as incident closure. The
  incident stays open under its coordinator.
- **Duplicate:** reduce entries with the same canonical slug to one and preserve the most advanced
  accurate state.
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
  upsert.
- If duplicates exist, collapse them and verify one remains.
- If a crash occurs after human action but before verification, retain or restore
  `verification_pending`.
- If closure completed but projection cleanup did not, remove the orphan only after confirming
  durable verified-closure evidence.
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
- Verified closure complete, entry removed: conformant.
- Open incident requiring only an agent capability, no entry: conformant.

Deterministic cases live at `fixtures/human-attention/cases.json` in the source repository. They
describe portable semantics only; live host adapters and presentation formats are outside this
profile.
