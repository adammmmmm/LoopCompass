# Maintainer delivery policy

LoopCompass uses `Backlog → Todo → In Progress → Review → Done`. `Blocked` is a label or dependency
relationship, not a status.

## Merge rule

A pull request may merge when `verify` passes and `review-policy` finds one of these comments,
authored directly by the configured repository owner and bound to the exact current HEAD:

1. A three-model panel record with three distinct seats, three distinct model names, and three
   `approved` verdicts.
2. A repository-owner approval comment.

This is a cooperative repository quality policy, not a security boundary against a malicious
repository administrator. GitHub commit statuses are SHA-scoped, and repository-owner comment
integrity is a trust boundary.

The panel form is:

```text
### Repository-owner panel

**Target:** `<40-character commit SHA>`

- R1 — <provider/model> — Approved
- R2 — <provider/model> — Approved
- R3 — <provider/model> — Approved

<!-- loopcompass-owner-panel:v1
{"schema":1,"head_sha":"<40-character commit SHA>","reviews":[{"seat":"R1","model":"<provider/model>","verdict":"approved"},{"seat":"R2","model":"<provider/model>","verdict":"approved"},{"seat":"R3","model":"<provider/model>","verdict":"approved"}]}
-->
```

The owner-human alternative is:

```text
### Repository-owner approval

**Target:** `<40-character commit SHA>`

**Verdict:** `Approved`

<!-- loopcompass-owner-approval:v1
{"schema":1,"head_sha":"<40-character commit SHA>","verdict":"approved"}
-->
```

Both forms are exact canonical records. Bot, App, wrong-author, malformed, stale-SHA, partial, and
changes-requested evidence fails closed. Editing or deleting an issue comment re-evaluates the
check. A push changes the current HEAD and therefore invalidates earlier evidence.

## Repository enforcement

- `verify` and `review-policy` are the only required status checks.
- Trusted policy code is checked out from the default branch and runs on `pull_request_target`;
  proposed pull request code is never executed by the review workflow.
- The main ruleset requires zero native approvals and does not require last-push approval. Native
  GitHub reviews are not review-policy evidence.
- Review conversations must be resolved.
- Squash is the only merge method, and the remote branch is deleted after merge.
- The ruleset has no bypass actors.

The desired live ruleset and repository settings are recorded in `.github/delivery-policy.json`.
After a policy change merges, run `node scripts/review-gate.mjs audit` with an ephemeral
least-privilege administrator token and align the live ruleset before declaring delivery complete.
