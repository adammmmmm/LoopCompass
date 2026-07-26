---
id: <slug-from-normalized-signature>
schema: 1
signature: "<normalized symptom or error>"
status: detected
requires: [<capability>]
owner: <incident-coordinator>
opened: <YYYY-MM-DD>
containment_expires: null
consulted: []
---

<!-- status: detected | escalated | repairing | blocked | verified -->
<!-- blocked is metadata on an open incident, not a terminal archive -->
<!-- id and filename must be the mechanical slug of signature (see SKILL.md) -->
<!-- in schema 1, owner is the lifecycle coordinator; the action actor may differ -->
<!-- sanitize every field and section before deriving signature, id, or filename -->
<!-- containment_expires past today on an open incident is invalid; renew, clear, or close -->
<!-- after verified repair: delete this live file; do not keep closed incidents as folklore -->

# <Repair the broken mechanism>

## Failure

Normal path: <The intended operation that failed.>

Evidence: <Sanitized expected behavior, observed behavior, and minimal reproduction; no raw logs.>

## Repair

<The mechanism and source of authority that must change.>

## Containment

<Temporary containment, the actor responsible for operating or expiring it, and expiry, or "None".
The incident coordinator remains the frontmatter owner.>

## Verification

<How to remove containment and exercise the exact original normal path from clean preconditions.>
