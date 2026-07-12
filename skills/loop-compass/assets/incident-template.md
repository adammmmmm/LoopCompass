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

<!-- status: detected | escalated | repairing | blocked | verified -->
<!-- blocked is metadata on an open incident, not a terminal archive -->
<!-- id and filename must be the mechanical slug of signature (see SKILL.md) -->
<!-- containment_expires past today on an open incident is invalid; renew, clear, or close -->
<!-- after verified repair: delete this live file; do not keep closed incidents as folklore -->

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
