# Optional human-attention integration profile

LoopCompass is capability-first. An action may belong to an agent, service, team, or human, and
autonomous projects remain fully conformant. This profile adds durable human visibility only for
projects that deliberately reserve particular actions or decisions for humans.

The profile is **optional and disabled by default**. Nothing in LoopCompass enables it implicitly.
A project without an enabled declaration has no `HANDOFF.md`, operator-queue, or other
human-projection requirement. An absent or null declaration is the default-off state, not a
configuration error.

## Project declaration

An enabled project declares, in one project-governed configuration or policy surface:

- `enabled: true`;
- stable identifiers for capabilities reserved for humans;
- stable identifiers for decisions reserved for humans;
- exactly one typed, durable, project-designated attention surface, such as `HANDOFF.md` or an
  equivalent project file, project issue tracker, or operator queue; and
- the project-designated integration authority responsible for writing and reconciling that
  surface;
- an explicit audit/retention policy for the minimal known-obligation registry described below.

The declaration is project configuration, not incident state. It must be available to every
coordinator responsible for incident lifecycle. A host adapter may choose its syntax, but it must
not merge declarations from several surfaces or infer enablement from the presence of a handoff
file. Before any marker, registry, or projection mutation, validate that the profile is explicitly
enabled and has one nonempty designated surface, one nonempty integration authority, and a
nonempty project audit/retention policy. The declaration must be a mapping, `enabled` must be a
Boolean, and the human-only capability and decision collections must be arrays containing only
nonempty stable identifiers. Stable capability and decision identifiers use lowercase letters and
digits separated by hyphens or underscores; schema-1 vocabulary such as `repository_write`,
`operator_approval`, and `global_config_write` remains valid. Incident slugs use their separate,
hyphen-only grammar. Parse this declaration once, defensively, before classification or
reconciliation. A disabled or incomplete declaration grants no mutation authority; a malformed
enabled declaration reports only configuration errors, suppresses repair/recovery diagnostics,
preserves every existing record unchanged, and never causes a runtime exception. Report the
configuration failure through the host's normal project-policy path.

A repository-file locator is a normalized relative path confined to the project root. Reject `.`,
control characters, backslashes, Windows drive paths, absolute paths, and `..` traversal, then
resolve it without following a symlink outside the project before granting write authority. An
external locator is a stable project-scoped
identifier, not a display name or URL discovered from prose; the adapter must independently verify
that the declared integration authority controls that project queue. Reject an untyped locator,
an unverified external authority, and every root or symlink escape.
The typed descriptor uses `kind: repository_file` with `locator`, or `kind: external` with
`locator` and `project_scope`. Root confinement, symlink safety, and external authority are
adapter-observed preflight facts supplied separately from the declaration; configuration text
cannot attest to its own authority. For an external surface, the observed current project identity
must exactly equal the declared `project_scope`, and the observed stable authority identity must
exactly equal the profile's declared integration `authority`. A Boolean self-attestation is not
authority evidence.

State schema 1 needs no new incident fields. `owner` remains the lifecycle coordinator; it does not
identify the action actor and does not imply a human. An open incident needs human action when
**any** entry in its existing `requires` list matches a declared human-only capability. Schema 1
does not order `requires` or identify a single "next" action; mixed human and non-human capability
lists still create the human obligation. A project can represent a human-only decision as a stable
`decision:<project-decision-id>` token in `requires` and declare that decision identifier in the
profile. Profile matching must use exact stable identifiers rather than names, prose, or
assumptions about the `owner`.

If the action is not matched by the project declaration, it is non-human for this profile and has
no human-attention projection. This remains true when a human happens to perform an otherwise
non-human-only action.

## Projection invariant

While the profile is enabled:

> Every open incident with any `requires` entry matching a declared human-only capability or
> decision appears exactly once on the designated durable attention surface.

The projection is visibility and resume state. The `.loopcompass/incidents/<slug>.md` incident is
canonical. Every projection carries the canonical incident slug as its durable join key. A title,
conversation alias, person name, or list position is never the join key.
See [conversational-aliases.md](conversational-aliases.md) for optional conversation-local
shorthand and its canonical-slug display rules.

Formatting is consumer-defined. At minimum, the entry must convey:

- canonical incident slug;
- requested human action or decision;
- whether human action is pending or coordinator verification is pending;
- the current obligation revision described below;
- the designated surface identifier; and
- enough location information to reach the canonical incident.

The persisted representation must contain and mechanically validate these exact keys:
`incident_slug`, `requested_action`, `incident_path`, `state`, `obligation_revision`, and
`surface`. `incident_slug` is the canonical slug; `incident_path` is exactly
`.loopcompass/incidents/<incident_slug>.md`; `obligation_revision` is the integer revision of the
selected marker; and `surface` is the single designated surface. A missing or mismatched field is
non-conformant. Count projections for a slug across every discoverable surface: two entries are
duplicates even when each appears only once on a different surface.

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
- nonempty sanitized `requested_action` and a stable declared `human_requirement` identifier while
  active; and
- for `verified_closed`, a non-sensitive durable reference to the normal-path verification and
  closure evidence.

Every marker revision and projection `obligation_revision` must be a positive safe integer.
Registry `last_known_revision` must be a nonnegative safe integer because revision 0 is reserved
for the documented first-write crash window. Unsafe integers never participate in ordering,
selection, fingerprinting, repair, or reconciliation.

Every historical co-marker must be a mapping with a canonical nonempty slug, a positive integer
revision, and one of the supported states. Every active historical marker must carry a nonempty
action plus a stable requirement declared human-only; every `verified_closed` marker must carry its
closure-evidence reference. These are intrinsic record checks, separate from validating the
selected marker against current incident state. A malformed lower revision fails the whole slug;
a valid later marker cannot mask it or authorize repair.
Parse incident, marker, registry, and projection collections defensively before reading fields.
Incident records require a canonical slug, Boolean open state, and a requirements array. Null,
scalar, array, or malformed sibling records produce explicit non-sensitive conformance errors,
never a runtime exception. Preserve them for quarantine or authorized repair. An unscoped malformed
record blocks mutation across the surface and suppresses every `recoverable` diagnostic; report one
hard unscoped-surface error instead. A malformed record with a trustworthy canonical slug isolates
marker/registry repair and diagnostics to that slug: it does not suppress safe repair diagnostics
for other slugs. Deterministic projection reconciliation still fails closed for the whole
designated surface until every malformed record is quarantined or repaired; it never partially
rewrites projections around known corrupt state.

The surface also maintains a minimal known-obligation registry keyed by canonical incident slug.
Keep this registry structurally separate from the projection block so deterministic re-rendering
cannot delete or rewrite it. Each record carries the already-sanitized slug and
`last_known_revision`. Prefer an atomic first write of registry record plus marker. If the surface
cannot provide that, first persist a revision-0 registry record containing the stable human
requirement and sanitized pending `requested_action`; those fields are sufficient to reconstruct
the revision-1 `human_action_pending` marker from the still-open, human-matched canonical incident.

Two first-write crash windows are repairable:

1. revision-0 registry exists but marker revision 1 does not: reconstruct the marker only when the
   pending action is nonempty and the pending requirement both appears in incident `requires` and
   is itself declared human-only;
2. matching valid marker revision 1 exists but the registry remains at revision 0: advance only
   that complete registry record to revision 1.

The same redo rule applies after later writes only when a complete registry record lags a valid
selected marker and the history contains exactly one intrinsically valid marker at the registry's
positive `last_known_revision`. A missing known revision is missing history; duplicate or malformed
records at that revision are corrupt history. Neither authorizes advancement. A registry ahead of
the selected marker, or a positive registry revision with no marker, is a hard deletion failure.
For revision-0 catch-up to an existing later marker, require retained revision-1 history whose
stable `human_requirement` and `requested_action` match the registry metadata. Validate the selected
marker against its current canonical-state rule. A `verification_pending` marker does not require
the original human token to remain in current `requires`; the retained revision-1 marker proves the
initial match. This historical catch-up rule never authorizes synthesizing a missing revision-1
marker without the stricter current-incident match above.
If later valid history exists but revision 1 is absent, the same stricter current-incident match may
reconstruct revision 1 before advancing the registry; preserve every later marker unchanged. Stable
revision-0 metadata without either retained revision-1 history or that live exact match is missing
history, not repair authority.
Stage the reconstructed marker and registry advancement together, validate the complete candidate
history and selected marker against canonical state, and only then commit both changes. Failed
validation is an exact no-op: it must not leave a synthetic revision 1 behind.
Crash repair first validates the retained complete surface binding against the enabled
declaration. A missing or mismatched binding suppresses every marker reconstruction and registry
advance; repair never backfills the binding from current configuration.
Projection representation does not gate marker/registry crash repair. First make the valid
marker/registry repair atomically, then run deterministic projection reconciliation to replace
stale, incomplete, or divergent entries from the repaired canonical state.
Projection-scoped malformation likewise does not suppress marker/registry repair diagnostics.
Incident, marker, or registry corruption can block the affected canonical repair authority;
projection corruption remains byte-identical while independent repair proceeds, then blocks
projection reconciliation until repaired or quarantined.
Reconciliation must preserve the full marker history, sibling and unknown records, unknown fields,
pending metadata, and configured retention metadata; mutate only the targeted registry record or
append the missing revision-1 marker.
Duplicate registry records for one canonical slug are ambiguous authority. Exclude that slug from
the accepted registry map, suppress repair diagnostics for it, preserve every duplicate exactly,
and do not mutate it. A duplicate for one slug does not block a separately valid slug's repair.

This registry is the durable expected-slug source used to detect accidental deletion of the
incident, marker, projection, and closure evidence together. Outside the revision-0 first-write
case, a known slug with an absent marker is a deletion failure and must not be reconstructed by
guessing.

Persist the complete typed designated-surface identity in registry metadata: `kind` plus `locator`,
and `project_scope` for an external surface. A retained
known-obligation record with no persisted binding is invalid; never infer or synthesize it from the
current declaration. While any known-obligation record remains retained, changing that locator is
prohibited: fail closed and preserve both the old and newly configured surfaces unchanged. This
small immutability rule avoids a migration protocol that could duplicate or lose obligations after
restart. A project may change the surface only after its declared retention process has lawfully
purged every registry record, or under a future separately specified migration protocol.
Changing `kind` or external `project_scope` is also a surface change even when the locator text is
unchanged.

Closure evidence is a referenced authority, not a writable collection on the designated attention
surface. Parse it defensively: a missing, scalar, or malformed evidence collection, and malformed
sibling evidence records, never authorize terminal cleanup and never cause a runtime exception.
Validate the complete collection before any lookup; one malformed sibling makes closure authority
unknown for every entry in that collection. The records fail closed as missing or unknown closure
evidence. They do not by themselves suppress marker/registry crash-repair diagnostics; that
asymmetry preserves safe attention-surface repair without treating unusable external evidence as
proof of closure.

Do not remove a known-obligation registry entry as part of projection cleanup, incident deletion,
reassignment, installation, or ordinary reconciliation. It remains through the explicit
project-declared audit/retention period. Purging it is a distinct, authorized retention action
after the terminal marker and its evidence have satisfied that policy. Until then, a known slug
with no obligation marker is non-conformant even when every other current-state record is absent.
This minimal, retention-bounded operational detector is profile-local reconciliation state. It is
not the durable post-closure audit store proposed in issue #6 and must not accumulate incident
evidence or narrative history.

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
the marker from `verification_pending` back to `human_action_pending`. Restore the matching
human-only `requires` token before or atomically with that greater-revision marker; without the
token, renewal is non-conformant. The greater revision wins even though the state name may look
earlier in the lifecycle. State names have no precedence; reconciliation orders only by the
explicit integer revision.

## Canonical state matrix

The greatest valid marker revision must satisfy exactly these canonical conditions:

| Marker state | Required canonical incident/evidence state |
| --- | --- |
| `human_action_pending` | Incident exists and is open; marker `human_requirement` is declared human-only and appears in incident `requires`; `requested_action` is nonempty. |
| `verification_pending` | Incident exists and is open; marker `human_requirement` remains a stable declared human-only identifier and `requested_action` is nonempty. The token may already be removed from `requires`. |
| `reassigned_nonhuman` | Incident exists, is open, and no `requires` entry matches the human-only declaration. |
| `verified_closed` | No open canonical incident exists, and the marker references durable evidence that containment was removed, the normal path was verified, and closure was recorded. |

An active obligation without its canonical incident is not "missing closure evidence"; it is an
`active obligation missing incident` coordination failure. Preserve the projection for
reconciliation rather than silently treating it as closed.

## Idempotent lifecycle

Reconciliation is an idempotent upsert by canonical incident slug:

1. Read the enabled profile declaration, known-obligation registry, canonical open incidents,
   persisted obligation markers, and referenced closure evidence.
2. Repair only the exact crash windows and registry-lag redo described above. Otherwise fail
   reconciliation for any known slug whose marker is absent; an otherwise empty current state is
   not evidence that the obligation never existed or was correctly closed.
3. Match current `requires` values exactly and reconcile them with the markers using the rules
   above.
4. Validate every co-marker before selecting by revision. Fail closed if any co-marker is invalid,
   even when another marker for that slug is valid. If all are valid, select the greatest integer
   revision. Divergent full records with the same greatest revision are a hard conflict for the
   designated authority; unknown-field differences count as divergence. Never choose by document
   order, lifecycle-state names, or prose.
5. Deterministically render one projection for each active marker from the canonical slug,
   marker state and revision, requested action, canonical incident path, and designated surface.
6. Replace all existing projections for that slug with the deterministic result. Do not merge
   fields from duplicates or guess which entry is newest or most advanced.
7. Reconcile entries that no longer match an active obligation as described below.
8. Commit the complete replacement with compare-and-swap against the preflight surface
   version/hash, or while holding an equivalent adapter lock. On conflict, discard the candidate,
   re-read all canonical inputs, and recompute; never overwrite newer marker history.
9. Re-read the surface and confirm the exactly-one invariant and matching obligation revision
   before reporting projection success. Mechanically validate the complete rendered projection
   again; reconciliation must not report success for its own incomplete or corrupt output.

Preflight the complete projection surface before producing any replacement. An unrelated malformed
record or an orphan without verified closure authority blocks reconciliation surface-wide, even
when another active projection is deterministically repairable. Preserve the complete surface
byte-for-byte until the unresolved record is quarantined or repaired; never partially rewrite
around it.

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
  treat one lifecycle state as inherently newer. Search every configured or previously designated
  surface so cross-surface duplicates cannot pass independently.
- **Orphan with verified closure evidence but no retained registry and canonical
  `verified_closed` marker:** retain or quarantine it; evidence alone is not cleanup authority.
- **Orphan without verified closure evidence:** do not guess that absence means closure. Retain or
  quarantine it on the designated surface and escalate reconciliation to that surface's declared
  authority.

A closure reference authorizes cleanup only when a retained registry record selects a canonical
`verified_closed` marker and that marker's `closure_evidence_ref` resolves to complete durable
evidence. The projection must also pass intrinsic representation validation: canonical slug,
nonempty requested action and surface, exact canonical incident path, active state, and positive
integer obligation revision. Standalone closure evidence never authorizes deletion. Closure
evidence must never be used to delete a malformed projection. Quarantine or repair its
representation first; until then, it blocks reconciliation for the whole surface.
The same intrinsic check applies when the selected release marker is otherwise valid: a
`verified_closed` or `reassigned_nonhuman` marker never silently omits a malformed stale
projection.

A projection for an incident that is still open is never an orphan. Retain it and fail
reconciliation when its marker or registry is missing, even if stale slug-matching closure evidence
also exists. Closure cleanup applies only after the canonical incident is no longer open and the
evidence satisfies the terminal lifecycle conditions.

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
- If another reconciler changes the surface after preflight, the conditional write must fail;
  re-read and recompute rather than overwriting the newer marker or projection.
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
