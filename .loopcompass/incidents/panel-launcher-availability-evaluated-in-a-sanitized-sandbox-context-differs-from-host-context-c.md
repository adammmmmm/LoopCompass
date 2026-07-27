---
id: panel-launcher-availability-evaluated-in-a-sanitized-sandbox-context-differs-from-host-context-c
schema: 1
signature: "panel launcher availability evaluated in a sanitized sandbox context differs from host context causing a false unavailable-seat determination"
status: repairing
requires: [process_control]
owner: panel-convener-agent
opened: 2026-07-26
containment_expires: 2026-08-09
consulted: []
---

# Resolve panel launchers and authentication in the effective host context

## Failure

Normal path: Before declaring a requested panel seat unavailable, resolve its installed launcher
and validate its authentication in the same effective host context that will run the reviewer.

Evidence: Sandboxed discovery could not resolve the user-local Grok launcher, and sandboxed Claude
authentication could not access host Keychain credentials, causing a false unavailable-seat
determination. The failed raw diagnostics are retained under the project-local panel run. Verified
host launchers subsequently started both intended external seats with their requested models and
read-only restrictions. That completed panel used explicit launcher and authentication hints, so it
proves the containment works but does not verify the repaired normal path.

## Repair

The durable preflight and launcher-resolution rule is merged in the canonical orchestration
repository at PR #8, squash `99e0e2297a10494ee8d7e22f0dd183ed61733079`. It distinguishes
sanitized or sandboxed discovery from host execution, resolves approved host launchers, checks
authentication in the effective execution context, and starts the failed-seat attempt count only
after viable preflight. The corresponding consumer alignment is merged and its orchestration claim
is released.

The installed Codex and Claude skill copies are recursively identical to the canonical skill and
include the executable resolver. Source repair and installation are complete; normal-path
verification remains pending.

## Containment

Until 2026-08-09, the panel-convener agent may use verified absolute host launchers and
host/escalated execution for network or Keychain access while retaining each reviewer CLI's
read-only tool restrictions. Do not infer provider unavailability from sanitized `PATH` or
sandbox-hidden credentials alone.

## Verification

After the global rule is merged and installed, start a real default three-seat panel from a Codex
sandbox without ad hoc launcher-path or authentication hints. Verify that preflight resolves the
native Codex, external Claude, and external Grok seats in their effective contexts; all three use
the requested model and effort; external reviewers retain read-only restrictions; and every seat
returns a valid `VERDICT:` line. The hinted three-seat panel retained as evidence does not satisfy
this gate. After an unassisted run passes, file the corresponding verified recovery and delete this
live incident through the normal LoopCompass closure process.
