# Terminal receipts

A terminal receipt is a compact, host-neutral handoff for one triggered failure signature. It is
not a recovery or incident capsule, does not change capsule schema, and is not a default log.
The emitting worker or parent must apply the
[PII sanitation contract](pii-sanitation.md) before the first handoff or write. Sanitize source
material in memory before constructing any receipt field. Only after sanitation may the actor
normalize the signature or derive a dedupe key, receipt id, artifact reference, or other
identity-bearing value.

This ordering covers every field, including evidence, containment, proposed artifact content,
escalation target and action, `no_artifact` reason, and parent-receipt additions. Use functional
roles instead of identities. A non-authoritative parent forwards the complete already-sanitized
child receipt and sanitizes its own new fields before emitting the parent receipt.

## Classification receipt

Use this shape for the actor that finishes classification:

```yaml
receipt_schema: 1
receipt_id: <lowercase-host-neutral-id-unique-within-the-handoff>
signature: <normalized-failure-signature>
dedupe_key: <stable-mechanism-and-signature-key>
classification: <recovery|incident|external|none>
evidence: [<minimal-sanitized-fact>, ...]
task_outcome: <completed|incomplete|blocked|unknown>
mechanism_health: <healthy|broken|external|unknown>
containment:
  used: <true|false>
  summary: <bounded-containment-or-null>
  verification_gate: <normal-path-gate-or-null>
terminal_outcome: <persisted_artifact|no_artifact|proposed_artifact>
artifact_ref: <canonical-artifact-id-or-null>
no_artifact_reason: <classification-reason-or-null>
proposed_artifact:
  kind: <recovery|incident>
  content: <complete-sanitized-proposed-artifact>
escalation:
  requires: [<capability>, ...]
  target: <nearest-capable-actor>
  action: <exact-action-needed>
```

All keys are required; fields marked `null` stay present. `evidence` contains 1–8 single-line,
sanitized facts, each at most 512 characters. `requires` contains 1–8 capability names when used,
each one line and at most 128 characters.
`containment.summary` and `containment.verification_gate` are non-empty only when
`containment.used` is true. Containment is valid only for `incident` and `external`
classifications. Containment summary and gate, escalation target and action, and
`no_artifact_reason` are each one line of at most 512 characters. One line excludes carriage
return, line feed, next line (`U+0085`), line separator (`U+2028`), and paragraph separator
(`U+2029`).
All receipt text rejects unsafe control, bidi/format, and default-ignorable characters without
echoing them in diagnostics. Proposed artifact content is the only multiline text surface: CRLF
is normalized to LF, and LF is the only permitted control character there.

The schema is closed: do not add raw-log, transcript, private-payload, or host-specific fields.
Sanitize and summarize necessary evidence into the modeled fields. `signature` is a normalized
one-line identity of at most 512 characters. Evidence, containment, escalation, reasons, and
artifact bodies retain useful prose and safe dates; they are sanitized but are not
signature-normalized or whitespace-collapsed. Receipt ids and artifact references are lowercase
host-neutral identifiers of at most 128 characters. Dedupe keys use the same character set and
additionally permit `|` as a component separator; they are at most 256 characters. Receipt ids are
unique within the handoff chain.

`proposed_artifact.content` is the complete filled recovery or incident Markdown artifact,
including type-correct, non-empty required frontmatter and a non-empty body under every required
template section. It is at most 32,768 UTF-8 bytes; CRLF is canonicalized to LF before parsing and
validation. Frontmatter uses exact `---` delimiter lines, only the documented schema-1 keys, and
fully parsed unique fields; malformed lines, duplicates, unknown keys, and unresolved values fail
validation. The canonical receipt representation uses a JSON-compatible double-quoted
`signature`, strict bracketed `requires` and `consulted` lists whose entries are bare safe scalars
or JSON-compatible double-quoted strings, and bare or JSON-compatible double-quoted values for
every other scalar field. Validation uses the decoded value. Unbalanced lists or quotes, malformed
escapes, anchors, aliases, and tags fail validation.
JSON escapes are decoded once and the same decoded signature and list items drive strict schema and
shared capsule validation. Quoted commas remain inside one list item; an escape that decodes to an
unsafe control or unresolved structural marker still fails.
Incident dates must be real calendar dates. Proposal validation checks containment
expiry date shape deterministically but defers whether the expiry is current to authoritative
persistence, when the actual persistence date is known. Recovery scope contains only the required
non-empty OS, shell, tool, and versions values; its dates and positive expiry follow the recovery
schema, and `expires_after_days` is a positive base-10 integer without alternate numeric notation.
Its signature is itself normalized, one-line, at most 512 characters, and exactly matches the
terminal receipt signature. Its id is the mechanical signature slug or that slug plus an unpadded
`-N` collision suffix where `N` is at least 2.

Long prose placeholders shipped in a template are invalid anywhere in the proposed artifact,
including HTML comments, whether bare, angle-wrapped, nested, split across whitespace, or split by
render-transparent comments and inline tags. Format-control and other default-ignorable insertion
also fail. Short structural tokens such as `<integer>` and `<capability>` are invalid when they are
the complete value of a frontmatter field or required section, but remain valid in ordinary
technical prose. Normalized signature tokens such as `<path>` and `<ts>`, safe Markdown autolinks,
HTML, and other technical angle-bracket prose remain valid when otherwise sanitized. The content
is not a one-line instruction, summary, patch fragment, or artifact id.

Outcome-specific rules:

- `persisted_artifact` requires `artifact_ref`; `proposed_artifact` and `no_artifact_reason` are
  null. A direct classification receipt uses the mechanical slug of its normalized signature, or
  that slug plus a documented `-N` collision suffix where `N` is an integer of at least 2.
- `no_artifact` requires `no_artifact_reason`; artifact fields and `escalation` are null because
  classification has ended without a durable artifact.
- `proposed_artifact` requires the complete `proposed_artifact` and exact `escalation`; the other
  terminal fields are null.
- `incident` and `external` classifications require exact `escalation` even when the incident was
  already persisted.
- `classification: none` and `terminal_outcome: no_artifact` occur together.
- A proposed recovery has `proposed_artifact.kind: recovery`; proposed incident and external
  classifications use `kind: incident`.

`task_outcome` and `mechanism_health` are independent. For example, containment can produce
`task_outcome: completed` while the documented launcher remains `mechanism_health: broken`.

Read-only workers, workers without a project store, and workers outside repository authority must
return a complete `proposed_artifact` receipt. Read-only suppresses only the direct write. It never
suppresses consultation, classification, evidence, the complete proposed artifact, or escalation.

## Parent receipt

The receiving parent returns a linked receipt:

```yaml
receipt_schema: 1
receipt_id: <distinct-lowercase-parent-receipt-id>
child_receipt_id: <classification-receipt-id>
child_payload_sha256: <canonical-complete-child-receipt-digest>
ingested: true
terminal_action: <persisted_artifact|no_artifact|proposed_artifact>
artifact_ref: <canonical-artifact-id-or-null>
no_artifact_reason: <classification-reason-or-null>
proposed_artifact: <complete-proposed-artifact-or-null>
escalation: <exact-escalation-or-null>
forwarded_receipt: <complete-child-receipt-or-null>
```

The parent must perform one terminal action in the same turn:

- persist and name the canonical artifact;
- record why no artifact is justified; or
- if still non-authoritative, propagate the complete child receipt unchanged with a new exact
  escalation.

`ingested: true` means the parent actually received and evaluated the linked payload. A receipt id
alone is not proof of complete propagation. `child_payload_sha256` binds the parent action to the
canonical complete child payload; the parent and child ids must be distinct and must not be reused
for different receipts. An authoritative action leaves `forwarded_receipt` null; further escalation
includes the complete unchanged child receipt. A parent that persists an incident or external
incident retains the exact repair escalation rather than dropping it after persistence. A parent
that propagates also repeats the child's complete proposed artifact unchanged; changing the
candidate requires a new child classification receipt. When an authoritative parent persists a
proposed artifact, `artifact_ref` is derived directly from the child receipt's normalized signature:
its mechanical slug or that slug plus one documented unpadded `-N` collision suffix where `N` is
an integer of at least 2. Collision suffixes do not chain.

## Boundaries

Receipts are ephemeral coordination evidence unless a host already has an authorized durable task
record. Core LoopCompass does not create a receipt directory, queue, daemon, database, transcript,
or network service. A receipt never replaces the canonical `.loopcompass` artifact. Host
integrations decide how to ingest, deduplicate, queue, persist, and close receipts. Host sanitation
checks are defense in depth only; they do not defer or replace the emitting actor's sanitation
before first handoff or write. Receipt validation blocks known high-confidence email, secret, and
personal-home-path shapes without echoing matched content. It cannot prove that personal names,
private organizations, project-specific identifiers, or all PII are absent; the emitting actor
must still substitute functional roles, and project-supplied patterns belong to host tooling.
