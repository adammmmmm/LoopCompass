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

1. Create a focused branch from `main`.
2. Make the smallest coherent change that solves the stated problem.
3. Add or update focused tests for observable behavior and material regressions.
4. Run the complete verification gate:

   ```text
   node scripts/verify.mjs
   ```

5. Confirm `git diff --check` passes.
6. Open a pull request using the repository template.

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
