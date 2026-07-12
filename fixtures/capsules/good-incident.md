---
id: null-identity-replay-state-stops-periodic-refresh
schema: 1
signature: "null identity replay state stops periodic refresh"
status: detected
requires: [repository_write]
owner: operator
opened: 2026-07-08
containment_expires: 2099-08-07
consulted: []
---

# Repair silent identity replay disarm

## Failure

Normal path: the client periodically refreshes identity mapping for new positions.

Evidence: when replay state is null, the refresh path becomes a no-op while the surface still looks
healthy, leaving new positions unmapped.

## Repair

Re-arm identity replay on the keepalive path when state is null. Add a regression test.

## Containment

Treat identity freshness as unconfirmed until fixed. Owner: operator. Expiry: far-future for fixture.

## Verification

From a clean session with no organic refresh, show periodic identity frames within the keepalive
window, then run the regression test.
