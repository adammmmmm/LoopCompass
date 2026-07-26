# Contributing to LoopCompass

Thanks for helping improve LoopCompass. Contributions should keep the project portable, lean,
provider-neutral, and easy to audit.

## Before you start

- Search existing issues and pull requests before opening a new one.
- Use the bug or feature issue form for a change that needs discussion.
- Report vulnerabilities privately according to the [security policy](SECURITY.md).
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Repository map

| Path | Purpose |
| --- | --- |
| `skills/loop-compass/` | Portable skill, references, templates, and manifest |
| `.loopcompass/` | This repository's own operational memory |
| `scripts/` | Maintainer verification, release, evaluation, and validation tools |
| `tests/` and `fixtures/` | Executable contracts and deterministic test data |
| `examples/` | Redacted teaching examples, not live operational memory |
| `docs/` | Design, integration, evaluation, and verification documentation |
| `site/` | Dependency-free landing page published through GitHub Pages |

## Development workflow

Public work moves through `Backlog → Todo → In Progress → Review → Done`. `Blocked` is a label or
dependency relationship, not a workflow status.

1. Create a focused branch from `main`. Every durable remote implementation branch must promptly
   have a draft or open pull request.
2. Make the smallest coherent change that solves the stated problem.
3. Add or update focused tests for observable behavior and material regressions.
4. Run the complete verification gate:

   ```text
   node scripts/verify.mjs
   ```

5. Confirm `git diff --check` passes.
6. Open a pull request using the repository template and enter Review when the implementation,
   required tests, green `verify` check, and closure evidence are complete.
7. Exit Review only after three independent model reviews approve the current pull request HEAD,
   every material finding has an evidence-backed disposition, blocker fixes are re-verified, and
   all review conversations are resolved. Any later push invalidates that sign-off.

CI uses Node.js 24. Installing project dependencies is not required.

## Contribution principles

- Preserve the no-daemon, no-database, provider-neutral design unless an accepted proposal changes
  that contract.
- Extend existing structures before adding abstractions, files, compatibility paths, or tooling.
- Do not preserve workarounds as recoveries unless they represent correct, repeatable operation.
- Keep examples synthetic or fully redacted. Never commit secrets, private paths, or user data.
- Treat agent-generated contributions like any other contribution: review the diff, verify the
  claims, and take responsibility for the result.
- Do not manually edit release manifest digests. Use `node scripts/release.mjs generate` when a
  release-scoped skill file changes.

## Pull requests

Pull requests should explain the problem, the chosen solution, user-visible impact, and validation
evidence. Keep unrelated changes separate. A maintainer may ask for changes when a contribution
adds speculative scope, duplicates coverage, weakens portability, or lacks a reproducible contract.

Trusted first-party, non-sensitive pull requests require independently green `verify` and
`model-review-gate` and `delivery-policy` checks. External contributions additionally require
current human maintainer review.
Sensitive changes always require current human maintainer review, including Actions and workflows,
authentication or permissions, migrations, release credentials, security boundaries, and the
review gate itself; all `scripts/`, `tests/`, and `fixtures/` changes are sensitive. The trusted
delivery workflow records a pull-request-scoped approval only after every applicable requirement is
green and records changes requested otherwise. That automation review is a delivery attestation,
not one of the three independent model reviews. Review and human evidence bind to the current HEAD
and its trusted workflow-run generation; a push invalidates both even if the branch later returns
to an earlier SHA. Auto-merge may be armed only after the applicable checks and review are green.
Pull requests merge by squash; merged remote branches are deleted automatically.

The compact public evidence format and maintainer procedure are in
[the delivery policy](../docs/maintainer-delivery-policy.md).
