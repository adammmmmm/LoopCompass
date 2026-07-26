# Decision: keep schema 1 for ownership

Status: accepted

Date: 2026-07-26

Issue: [#26](https://github.com/adammmmmm/LoopCompass/issues/26)

## Decision

Keep capsule state schema 1. Stable incident `owner` plus validated terminal-receipt escalation is
sufficient for the currently evidenced coordinator/action-owner requirements. Do not add
`coordinator` or `action_owner` fields, do not rewrite consumer state, and do not open a schema-v2
implementation issue.

This decision does not claim that action-owner state is durable inside a schema-1 capsule. The
capsule keeps lifecycle coordination durable; a current action actor is queryable from the
authorized host receipt or task record that assigned the action. Core LoopCompass intentionally
does not create a receipt log, queue, database, or transcript.

## Measurable decision criteria

Schema 1 is sufficient only when all of these conditions hold:

1. A capsule's stable `owner` unambiguously identifies the lifecycle coordinator.
2. A validated receipt's exact escalation target can differ from the coordinator.
3. Sequential validated receipts can change that target without changing the capsule owner.
4. Exact action-owner queries recover the current assignment from the authorized receipt sequence.
5. Verification and closure remain the coordinator's responsibility after action completion.
6. A read-only probe leaves every representative consumer incident byte-identical.

Run:

```sh
node scripts/ownership-probe.mjs
```

The probe reads three existing redacted pilot incidents, constructs complete schema-1 terminal
receipts in memory, validates them with the authoritative receipt validator, indexes them by exact
action-owner role, and hashes the source files before and after. The committed baseline digest is
`034b5154a77659cfe69542d70f7a0701eaa7333217e8a4d18596be8560b52f0d`. The report must select
`schema_1_plus_receipts_sufficient`, show the same before/after digest, and pass every criterion.

## Evidence

| Scenario | Stable coordinator | Action-owner sequence | Verification and closure |
| --- | --- | --- | --- |
| UTC mapping repair | `project-maintainer` | `runtime-maintainer` → `project-maintainer` | `project-maintainer` |
| Identity refresh repair | `project-maintainer` | `client-maintainer` → `test-maintainer` | `project-maintainer` |
| Neutral-root worktree repair | `operator` | `configuration-maintainer` → `operator` | `operator` |

The scenarios cover action-owner reassignment, stable coordination, exact role queryability, and
coordinator-owned verification and closure. Each generated observation is a complete terminal
receipt whose incident classification, artifact identity, escalation capabilities, target, and
action pass `validateTerminalReceipt`.

No representative case needs a second durable capsule identity. The existing `requires` list names
the missing capability, the receipt escalation names the actor handling the current action, and the
schema-1 `owner` remains responsible for lifecycle state and normal-path verification.

## Counterexamples and falsification conditions

The probe records three real limits rather than hiding them:

- If a consumer requires durable current-action-owner queries after every authorized receipt and
  host task record is unavailable, schema 1 cannot answer that query.
- If one incident requires independently mutable, simultaneous action-owner identities rather than
  capability requirements and sequential assignments, one scalar `action_owner` field would not be
  sufficient either.
- If a consumer must atomically recover both coordinator and current actor from the capsule alone
  after host-state loss, the current receipt contract is insufficient by design.

None of those requirements appears in the representative corpus or the accepted lifecycle and
receipt contracts. A later schema-v2 proposal is authorized only after a sanitized reproducible
consumer case demonstrates one of these needs, shows that `owner` + `requires` + validated receipts
cannot satisfy it, and establishes that the compatibility cost is proportional to the observed
failure. A hypothetical preference for duplicate fields is not enough.

## Compatibility, release, and rollback

- Consumer capsules remain schema 1 and are never rewritten by the probe.
- Incident templates, capsule parsers, validators, update behavior, and rollback behavior are
  unchanged.
- `skills/loop-compass/` is unchanged, so the shipped manifest and its digests remain unchanged.
- No release is required. The probe, fixtures, tests, and this decision record are repository
  evidence only.
- Removing the probe and decision record rolls back this repository evidence without touching
  consumer state. Superseding the decision requires new evidence under the falsification rule
  above.
