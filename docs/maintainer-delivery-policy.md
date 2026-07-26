# Maintainer delivery policy

LoopCompass uses `Backlog → Todo → In Progress → Review → Done`. `Blocked` is a label or dependency
relationship, not a status.

## Review gate

The public requirement is **three independent model reviews**.

This is a cooperative repository quality policy, not a security boundary against a malicious
repository administrator. Evidence is bound to a pull request and exact HEAD, and the gate retains
best-effort cross-pull-request and concurrent-run checks. GitHub statuses remain SHA-scoped, so
intentional identical-SHA reuse and administrator bypass are platform limitations outside the v0.1
threat model.

Entry to Review requires a complete implementation, focused and full required tests, an open pull
request with green `verify`, and assembled closure evidence. Exit to Done requires three independent
model reviews of the current pull request HEAD. Every review has a verdict and a distinct seat and
model identity; public seat identifiers use `R<n>`. Every material finding has an evidence-backed
disposition, blocker fixes are re-verified, and review conversations are resolved. A push changes
the HEAD, dismisses stale approvals, and invalidates all earlier evidence.

Concurrent runs are ordered by numeric Actions run identifiers. Full paginated status history lets
the higher run reclaim lower-run writes, while foreign or unparseable status sources fail closed.

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
{"schema":1,"head_sha":"<40-character commit SHA>","overall_verdict":"approved","previous_comment_id":null,"reviews":[{"seat":"R1","model":"<provider/model>","execution_id":"<unique execution id>","evidence_digest":"<64-hex digest>","verdict":"approved","findings":[]},{"seat":"R2","model":"<provider/model>","execution_id":"<unique execution id>","evidence_digest":"<64-hex digest>","verdict":"approved","findings":[]},{"seat":"R3","model":"<provider/model>","execution_id":"<unique execution id>","evidence_digest":"<64-hex digest>","verdict":"approved","findings":[]}]}
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
Each review record has a unique execution identifier and a SHA-256 digest of its compact source
evidence. These fields are maintainer attestations that make accidental reuse detectable; they are
not cryptographic proof that a provider ran or that execution was independent. Execution
independence remains a process obligation verified before the maintainer records the evidence.
Execution identifiers and evidence digests cannot be reused in a later review comment, including
one for a different HEAD.

When structured `human_approval` evidence is present, its reviewer, kind, and authorization link
must also appear in the visible summary. Hidden authorization is rejected by the exact-rendering
check.

Review evidence comments are immutable. Post a new reconciled comment after a new HEAD or verdict;
set `previous_comment_id` to the preceding review comment's numeric identifier. Carry every earlier
material finding into the new comment with its final disposition. The gate validates the immutable
chain and rejects missing carried findings, so a fix push does not erase the review trail.
The live comment API cannot prove that an authorized maintainer never deleted the entire chain.
Repository credentials and maintainer comment integrity are therefore an explicit trust boundary;
repository audit logs are the external evidence for destructive administrative changes.

## Layered merge policy

- `verify` remains an independent required check.
- `model-review-gate` validates the three review records, verdicts, findings, and dispositions
  against the exact current HEAD.
- `delivery-policy` independently validates the trusted, external, sensitive-path, and human-review
  conditions.
- Trusted first-party, non-sensitive pull requests need both checks. After both pass, the trusted
  workflow posts a pull-request-scoped GitHub Actions approval for the exact HEAD. If either fails,
  it posts changes requested instead. The latest automation review is a delivery attestation and
  never counts as one of the three independent model reviews.
- External pull requests additionally need current human maintainer review.
- Sensitive paths always need current human maintainer review, regardless of author. This includes
  Actions and workflows, authentication or permissions, migrations, release credentials, security
  boundaries, policy configuration, this policy, and every file under `scripts/`, `tests/`, or
  `fixtures/`.
- Human review can be a native approval targeting the current HEAD or a `human_approval` object in
  the canonical maintainer comment. The object contains `reviewer`, `head_sha`,
  `verdict: "approved"`, `kind`, and `authorization_reference`; its reviewer must be the configured
  human maintainer who posted the comment. Bot and App records are rejected. A different maintainer
  uses `kind: "maintainer_review"`; the pull request author's own native approval is not accepted. A
  self-authored sensitive bootstrap uses
  `kind: "operator_authorization"` and links an earlier immutable issue comment on the same pull
  request. That comment must be authored directly by the configured human maintainer, target the
  exact HEAD, and contain the canonical `loopcompass-human-authorization:v1` approved record.
  Automation validates both comments but must never create either authorization. Edited, missing,
  later, Bot, App, wrong-author, wrong-pull, and stale-SHA authorization records are rejected. An
  authorization created in the same second as the carrying review comment must also have a lower
  numeric comment identifier. An attestation inside syntactically invalid review metadata is not
  trusted; native current-HEAD approval remains independent and can still satisfy the delivery
  check.

  The linked authorization comment has this exact shape:

  ```text
  ### Operator authorization

  **Target:** `<40-character commit SHA>`

  **Verdict:** `Approved`

  <!-- loopcompass-human-authorization:v1
  {"schema":1,"head_sha":"<40-character commit SHA>","verdict":"approved"}
  -->
  ```
- Native approval clicks do not count as independent model records and cannot replace the structured
  three-review evidence.
- The main-branch ruleset requires one approval, dismisses stale reviews on push, and requires an
  approval after the latest push. This PR-scoped approval is a backstop for commit-scoped status
  checks and preserves autonomous delivery for trusted, non-sensitive changes.
- Auto-merge is armed only after applicable checks and review are green. Squash is the only merge
  method, all review conversations must be resolved, and the remote branch is deleted after merge.
- Every durable non-`main` remote branch receives a draft or open pull request promptly unless it
  matches a narrow explicit exemption in the policy configuration. The hourly read-only branch
  audit reports every other branch without a same-repository pull request; a same-named fork branch
  or malformed pull-request head does not satisfy the rule.
- A commit SHA must be the HEAD of exactly one open pull request for the gate to evaluate it. Shared
  open HEADs fail closed as a best-effort guard. After
  closing the duplicate pull request or moving it to a different HEAD, use the delivery-policy
  workflow's manual dispatch with the affected pull request number to recover the original pull
  request immediately; normal pull request activity also re-evaluates it. This cannot change
  GitHub's SHA-scoped status model.

The auditable repository policy is `.github/delivery-policy.json`. Changes to the policy or its
enforcement are themselves sensitive. It also records the desired live ruleset: strict required
`verify`, `model-review-gate`, and `delivery-policy` contexts; squash-only merge; required review
conversation resolution; current-HEAD approval; stale-review dismissal; and no bypass actors. Each
required context is source-bound to the
GitHub Actions application ID recorded from the repository API. The scheduled workflow audits
branch hygiene using its credential-free read access and explicitly records that administrator-only
live settings are unverifiable from the scheduled identity. Live policy auditing also requires
repository Actions defaults to remain read-only while allowing Actions to approve pull-request
reviews; only the trusted gate workflow receives local `pull-requests: write`. The live audit
tolerates additive API response fields while checking every configured security-relevant value.
Hidden bypass actors, missing required parameters, or insufficient visibility are `unverifiable`,
never compliant. Complete closure evidence requires running
`node scripts/review-gate.mjs audit` with an explicit read-only maintainer or administrator
credential. No credential is stored by the workflow.

Policy enablement is not complete when files merely merge. Closure requires the workflow on the
default branch, `can_approve_pull_request_reviews: true` with default workflow permissions still
`read`, the audited ruleset active with one current-HEAD approval required, and a live trusted,
non-sensitive pull request proving that invalid evidence receives changes requested and valid
evidence receives the automation approval.
