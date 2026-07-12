---
id: null-identity-replay-state-stops-periodic-refresh
schema: 1
signature: "null identity replay state stops periodic refresh"
status: detected
requires: [repository_write]
owner: project-maintainer
opened: 2026-07-08
containment_expires: 2099-08-07
consulted: []
---

<!-- source: example (redacted pilot pattern); not live project memory -->

# Repair silent identity replay disarm

## Failure

Normal path: the client periodically refreshes identity mapping so new positions stay mapped.

Evidence: when identity replay state is null, the refresh path becomes a no-op while the surface
still appears healthy, leaving new positions unmapped for long gaps.

## Repair

Re-arm identity replay on the keepalive path when state is null. Prove with a regression test while
preserving capture ordering constraints.

## Containment

Treat identity freshness as unconfirmed and alert when periodic refresh is not observed. Owner:
maintainer. Expiry: fixture far-future.

## Verification

From a clean session with no organic refresh, show periodic identity frames within the keepalive
window, then run the regression and project gate.
