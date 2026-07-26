# Terminal receipts

A terminal receipt is a compact, host-neutral handoff for one triggered failure signature. It is
not a recovery or incident capsule, does not change capsule schema, and is not a default log.
Emit it in the task response or host handoff surface. Host integrations decide whether and how to
ingest, deduplicate, sanitize, queue, persist, and close it.

## Classification receipt

Use this shape for the actor that finishes classification:

```yaml
receipt_schema: 1
receipt_id: <opaque-id-unique-within-the-handoff>
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

All keys are required; fields marked `null` stay present. `evidence` and `requires` are non-empty
lists when used. `containment.summary` and `containment.verification_gate` are non-empty only when
`containment.used` is true.

Outcome-specific rules:

- `persisted_artifact` requires `artifact_ref`; `proposed_artifact` and `no_artifact_reason` are
  null.
- `no_artifact` requires `no_artifact_reason`; artifact fields are null.
- `proposed_artifact` requires the complete `proposed_artifact` and exact `escalation`; the other
  terminal fields are null.
- `incident` and `external` classifications require exact `escalation` even when the incident was
  already persisted.

`task_outcome` and `mechanism_health` are independent. For example, containment can produce
`task_outcome: completed` while the documented launcher remains `mechanism_health: broken`.

Read-only workers, workers without a project store, and workers outside repository authority must
return a complete `proposed_artifact` receipt. Read-only suppresses only the direct write. It never
suppresses consultation, classification, evidence, the complete proposed artifact, or escalation.

## Parent receipt

The receiving parent returns a linked receipt:

```yaml
receipt_schema: 1
receipt_id: <opaque-parent-receipt-id>
child_receipt_id: <classification-receipt-id>
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
alone is not proof of complete propagation. An authoritative action leaves `forwarded_receipt`
null; further escalation includes the complete unchanged child receipt.

## Boundaries

Receipts are ephemeral coordination evidence unless a host already has an authorized durable task
record. Core LoopCompass does not create a receipt directory, queue, daemon, database, transcript,
or network service. A receipt never replaces the canonical `.loopcompass` artifact.
