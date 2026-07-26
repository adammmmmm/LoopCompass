# Maintainer delivery policy

LoopCompass uses `Backlog → Todo → In Progress → Review → Done`. `Blocked` is a label or dependency
relationship, not a status.

## Review gate

Entry to Review requires a complete implementation, focused and full required tests, an open pull
request with green `verify`, and assembled closure evidence. Exit to Done requires three independent
model reviews of the current pull request HEAD. Every review has a verdict and a distinct seat and
model identity. Every material finding has an evidence-backed disposition, blocker fixes are
re-verified, and review conversations are resolved. A push changes the HEAD and invalidates all
earlier evidence.

One compact, attribution-neutral pull request comment is the canonical evidence. The comment must
be posted by a configured maintainer and use this shape:

```text
### Independent model reviews — 3/3 complete

**Target:** `<40-character commit SHA>`

**Verdict:** `Approved`

- R1 — <provider/model> — Approved
- R2 — <provider/model> — Approved
- R3 — <provider/model> — Approved

No blocking findings identified.

<!-- loopcompass-review:v1
{"schema":1,"head_sha":"<40-character commit SHA>","overall_verdict":"approved","previous_comment_id":null,"reviews":[{"seat":"R1","model":"<provider/model>","verdict":"approved","findings":[]},{"seat":"R2","model":"<provider/model>","verdict":"approved","findings":[]},{"seat":"R3","model":"<provider/model>","verdict":"approved","findings":[]}]}
-->
```

When a material finding exists, replace the no-blocker sentence with a concise record:

```text
**Bug identified (R1):** <finding summary>
- Impact: <observable consequence>
- Required fix: <specific correction>
- Verification: <test or evidence>
- Disposition: fixed — <rationale>; <evidence>
```

Allowed finding prefixes are `Bug identified`, `Risk identified`, `Verification gap`,
`Plan mismatch`, `Edge case identified`, and `Required fix`. The matching structured finding
contains `id`, `prefix`, `summary`, `impact`, `required_fix`, `verification`, and a `disposition`
with `status`, `rationale`, and `evidence`. Disposition status is `fixed`, `accepted`, or
`not_applicable`. All three verdicts must be `approved`; a changes-requested verdict cannot pass.
Public summaries use declarative language and avoid first-person or anthropomorphic attribution.
Review evidence comments are immutable. Post a new reconciled comment after a new HEAD or verdict;
set `previous_comment_id` to the preceding review comment's numeric identifier. Carry every earlier
material finding into the new comment with its final disposition. The gate validates the immutable
chain and rejects missing carried findings, so a fix push does not erase the review trail.

## Layered merge policy

- `verify` remains an independent required check.
- `model-review-gate` validates the three review records, verdicts, findings, and dispositions
  against the exact current HEAD.
- `delivery-policy` independently validates the trusted, external, sensitive-path, and human-review
  conditions.
- Trusted first-party, non-sensitive pull requests need both checks.
- External pull requests additionally need current human maintainer review.
- Sensitive paths always need current human maintainer review, regardless of author. This includes
  Actions and workflows, authentication or permissions, migrations, release credentials, security
  boundaries, policy configuration, validator code and fixtures, and this policy.
- Human review can be a native approval targeting the current HEAD or a `human_approval` object in
  the canonical maintainer comment. The object contains `reviewer`, `head_sha`, and
  `verdict: "approved"`; its reviewer must be the configured maintainer who posted the comment.
  Automation validates this attestation but must never create it.
- Native approval clicks do not count as independent model records and cannot replace the structured
  three-review evidence.
- Auto-merge is armed only after applicable checks and review are green. Squash is the only merge
  method, all review conversations must be resolved, and the remote branch is deleted after merge.
- Every durable remote implementation branch receives a draft or open pull request within the
  configured grace period. The scheduled branch audit reports exceptions.

The auditable repository policy is `.github/delivery-policy.json`. Changes to the policy or its
enforcement are themselves sensitive.
