# Decision: defer schema 2 ownership fields

Status: accepted

Date: 2026-07-26

Issue: [#26](https://github.com/adammmmmm/LoopCompass/issues/26)

## Decision

Current evidence is insufficient to justify capsule schema 2. Keep schema 1 unchanged and defer new
`coordinator` or `action_owner` fields. Do not rewrite consumer state, implement schema 2, or open a
schema-v2 implementation issue.

This is a conservative compatibility decision, not an affirmative claim that schema 1 and
terminal receipts answer every ownership query. Schema 2 creates permanent read/write, update,
rollback, and migration obligations. Those costs require representative evidence that the current
contract causes a material accountability or query failure and that split fields solve it.

## What the probe establishes

Run:

```sh
node scripts/ownership-probe.mjs
```

The read-only probe inventories three existing redacted pilot incidents. It validates their current
schema-1 capsule structure, records the structured `owner` and `requires` values actually present,
and hashes the source files before and after. The committed aggregate digest is
`034b5154a77659cfe69542d70f7a0701eaa7333217e8a4d18596be8560b52f0d`.

The probe establishes only these facts:

- all three representative inputs are valid schema-1 incidents;
- each input contains one structured coordinator in `owner` and a nonempty `requires` list;
- none contains a structured coordinator/action-owner split; and
- the aggregate and per-file consumer bytes remain identical before and after inspection.

The fixture identifies source artifacts and their expected byte digest. It does not manufacture
receipt events, assignment order, expected action-owner maps, or a current actor and then compare
those values back to itself.

## Evidence gaps

The representative corpus does not contain:

- authorized receipt provenance tied to these consumer incidents;
- a trusted receipt generation or host-task order for action-owner reassignment;
- evidence that any observed escalation target is the authoritative current action owner; or
- observed verification and closure actor history.

The accepted lifecycle contract states that schema-1 `owner` is responsible for coordination,
verification, and closure. The terminal receipt contract can carry an escalation target. Those
contracts describe allowed semantics, but prose plus synthetic examples cannot prove representative
consumer provenance, authority, ordering, or current-owner queryability. The probe therefore reports
each missing property as `proven: false`.

## Decision gate for a later schema-v2 proposal

Reconsider schema 2 only after sanitized, reproducible evidence supplies all of the following:

1. Representative consumer state and its authoritative receipt or task provenance.
2. A trusted ordering or generation mechanism that identifies reassignment and the current actor.
3. A material query, accountability, verification, or closure failure that persists when
   schema-1 `owner`, `requires`, and authorized receipts are used as documented.
4. Evidence that durable split fields solve that failure without creating a second conflicting
   source of truth.
5. A compatibility design covering legacy interpretation, field mutability, structural list
   parsing, one authoritative validator, manifest read/write compatibility, no-rewrite upgrade,
   and rollback.

Until that gate is met, neither schema-2 material usefulness nor schema-1 ownership completeness is
proven. Deferral avoids speculative permanent compatibility scope while preserving a concrete,
falsifiable path to revisit the decision.

## Compatibility, release, and rollback

- Consumer capsules remain schema 1 and are never rewritten by the probe.
- Incident templates, capsule parsers, validators, update behavior, and rollback behavior are
  unchanged.
- `skills/loop-compass/` is unchanged, so the shipped manifest and its digests remain unchanged.
- No release is required. The probe, fixture, tests, and this decision record are repository
  evidence only.
- Removing this evidence rolls back the repository-only probe without touching consumer state.
