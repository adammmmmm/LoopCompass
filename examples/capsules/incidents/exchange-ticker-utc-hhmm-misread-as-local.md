---
id: exchange-ticker-utc-hhmm-misread-as-local
schema: 1
signature: "exchange ticker utc hhmm misread as local"
status: detected
requires: [repository_write]
owner: project-maintainer
opened: 2026-07-09
containment_expires: 2099-08-08
consulted: []
---

<!-- source: example (redacted pilot pattern); not live project memory -->

# Complete the UTC-everywhere time audit

## Failure

Normal path: derive event date from an exchange ticker and map a book position to the matching
market.

Evidence: treating ticker `HHMM` as local time misdates events that start at or after 00:00 UTC.
Mapped rows go missing or land on the wrong calendar day. A point fix may land while mixed-time
storage remains elsewhere.

## Repair

Audit timestamp storage and logic paths, enforce UTC-aware values, and isolate timezone conversion
to render-only helpers. Add a regression for late UTC start times.

## Containment

Manually UTC-review late-starting events before accepting a non-empty plan. Owner: maintainer.
Expiry: fixture far-future.

## Verification

Exercise a late-UTC ticker through the mapper, confirm correct local display date and market
mapping, run timezone guardrail tests, then the full project gate.
