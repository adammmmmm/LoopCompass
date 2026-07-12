---
id: branded-browser-ignores-extension-load-flags
schema: 1
signature: "branded browser ignores extension load flags"
scope:
  os: Windows
  shell: any
  tool: instrumented-browser-launcher
  versions: Chromium-family >= 137
status: verified
first_seen: 2026-07-03
last_verified: 2026-07-03
expires_after_days: 180
supersedes: null
---

<!-- source: example (redacted pilot pattern); not live project memory -->

# Use a browser-for-testing channel for extension injection

## Symptom

Branded browser builds can open the target tabs while silently ignoring extension load flags,
leaving the session without instrumentation.

## Recovery

Launch via the project launcher that selects a browser-for-testing binary. Require post-launch
tab census and instrumentation markers to report pass. Treat branded-browser escape hatches as
non-capture troubleshooting only.

## Verification

Reproduced a non-instrumented branded window, then verified the testing-channel path with required
post-launch checks.

## Limits

Applies to CLI-loaded page instrumentation on desktop hosts. Does not prohibit branded browsers for
interactive human use.
