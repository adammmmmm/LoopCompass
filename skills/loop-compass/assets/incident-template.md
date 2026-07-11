---
id: <slug-from-normalized-signature>
schema: 1
signature: "<normalized symptom or error>"
status: detected
requires: [<capability>]
owner: <agent-or-operator>
opened: <YYYY-MM-DD>
containment_expires: null
consulted: []
---

<!-- status: detected | escalated | repairing | verified -->
<!-- blocked is metadata on an open incident, not a terminal status value in the filename lifecycle -->
<!-- id and filename must be the mechanical slug of signature (see SKILL.md) -->

# <Repair the broken mechanism>

## Failure

Normal path: <The intended operation that failed.>

Evidence: <Expected behavior, observed behavior, and minimal reproduction.>

## Repair

<The mechanism and source of authority that must change.>

## Containment

<Temporary containment, owner, and expiry, or "None".>

## Verification

<How to remove containment and exercise the exact original normal path from clean preconditions.>
