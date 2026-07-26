## Summary

<!-- What changed? Keep this focused on the full diff. -->

## Why

<!-- What problem or accepted requirement does this solve? -->

## Validation

<!-- List exact commands, fixtures, or manual checks and their results. -->

## Impact

<!-- Note compatibility, release, documentation, or deployment impact. Write "None" when absent. -->

## Review evidence

<!--
Enter Review only after implementation, tests, green verify, and closure evidence are complete.
Before Done, attach one compact review summary for the current HEAD using
docs/maintainer-delivery-policy.md. A later push invalidates that evidence.
-->

## Checklist

- [ ] The change is the smallest coherent solution to the stated problem.
- [ ] Tests protect observable behavior or a material regression.
- [ ] `node scripts/verify.mjs` passes.
- [ ] `git diff --check` passes.
- [ ] Documentation and `CHANGELOG.md` are updated when behavior changes.
- [ ] Examples and logs contain no secrets, private paths, or personal data.
- [ ] Three independent model reviews approve the current HEAD.
- [ ] Every material finding is dispositioned with evidence and blocker fixes are re-verified.
- [ ] Review conversations are resolved.
