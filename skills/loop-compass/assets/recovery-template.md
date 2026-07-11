---
id: <slug-from-normalized-signature>
schema: 1
signature: "<normalized symptom or error>"
scope:
  os: <any-or-specific>
  shell: <any-or-specific>
  tool: <tool-name>
  versions: <version-range-or-unknown>
status: candidate
first_seen: <YYYY-MM-DD>
last_verified: null
expires_after_days: <integer>
supersedes: null
---

<!-- status: candidate | verified | stale | superseded -->
<!-- id and filename must be the mechanical slug of signature (see SKILL.md) -->

# <Correct path in one line>

## Symptom

<What the agent observes.>

## Recovery

<The shortest correct operating path.>

## Verification

<Evidence that the recovery caused the intended outcome, or "Pending" while status is candidate.>

## Limits

<Where this recovery does not apply or remains uncertain.>
