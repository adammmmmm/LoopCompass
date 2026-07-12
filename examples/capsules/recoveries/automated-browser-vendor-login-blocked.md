---
id: automated-browser-vendor-login-blocked
schema: 1
signature: "automated browser vendor login blocked"
scope:
  os: any
  shell: any
  tool: automated-browser + target-site
  versions: unknown
status: verified
first_seen: 2026-06-30
last_verified: 2026-06-30
expires_after_days: 180
supersedes: null
---

<!-- source: example (redacted pilot pattern); not live project memory -->

# Use the operator's normal browser session for the target site

## Symptom

Login in an automated browser returns a provider bot or geo wall, while the same account signs in
in a normal interactive browser.

## Recovery

Do not retry automated-browser login. Use the operator's normal interactive browser session with a
read-only instrumentation path. Never automate credentials.

## Verification

Recorded deterministic automated login block, then validated the interactive-browser path end to
end for the intended read-only session frames.

## Limits

Scoped to the observed account and environment class. Records a provider constraint, not a claim
that every account or browser release behaves identically.
