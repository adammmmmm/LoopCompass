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
Before Done, attach either the repository-owner three-model panel record or the repository-owner
approval comment for the exact current HEAD using docs/maintainer-delivery-policy.md.
-->

All changes require green `verify` and `review-policy`. A push changes the HEAD and invalidates
earlier review evidence.
Squash is the only merge method, and merged remote branches are deleted.

## Checklist

- [ ] The change is the smallest coherent solution to the stated problem.
- [ ] Tests protect observable behavior or a material regression.
- [ ] `node scripts/verify.mjs` passes.
- [ ] `git diff --check` passes.
- [ ] Documentation and `CHANGELOG.md` are updated when behavior changes.
- [ ] Examples and logs contain no secrets, private paths, or personal data.
- [ ] The exact-current-HEAD owner panel or owner approval satisfies `review-policy`.
- [ ] Every material finding is dispositioned with evidence and blocker fixes are re-verified.
- [ ] Review conversations are resolved.
