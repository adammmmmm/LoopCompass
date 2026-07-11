# Verification

How LoopCompass proves its mechanical contracts without requiring a consumer runtime.

## One command

```sh
node scripts/verify.mjs
```

Runs:

1. `node --test tests` — unit, fixture, schema, install/update dry-run, release tooling tests.
2. `node scripts/release.mjs validate` — VERSION, policy markers, per-file digests.

## What is automated

| Area | Location |
| --- | --- |
| Signature normalize + slug + collision suffix | `scripts/lib/signature.mjs`, `tests/signature.test.mjs` |
| Classification goldens (lane coverage + identity stability) | `fixtures/classification/cases.json`, `tests/classification-fixtures.test.mjs` |
| Recovery/incident field rules + templates | `scripts/lib/frontmatter.mjs`, `tests/artifact-schema.test.mjs` |
| Project-scope stage, policy markers, update check, state preserve | `tests/install-update-dry-run.test.mjs` |
| Manifest digests and policy marker integrity | `scripts/release.mjs`, `tests/release-tooling.test.mjs` |

## What remains host-level

Trigger timing, subagent inheritance, and consultation miss-rate need real agent hosts. Use
[host-matrix.md](host-matrix.md) and the numbered acceptance tests in [design.md](design.md).

## Release hygiene

- **On every PR / push to main:** `node scripts/verify.mjs` (CI workflow).
- **Before cutting a release tag:** `node scripts/release.mjs generate` then commit the refreshed
  `manifest.yaml` (commit field must match the release commit).
- **On tag `v*`:** CI runs verify, then `node scripts/release.mjs package` and uploads
  `dist/loopcompass-vVERSION.tar.gz` plus `dist/SHA256SUMS` as workflow artifacts.

`manifest.commit` is the release identity pin. Day-to-day main commits may advance after the last
generate; cutting a release regenerates so tag SHA and manifest commit agree.

## Dogfood

Product-facing recoveries and incidents should be mined in real multi-agent repositories (for
example a production-adjacent collector). This repository keeps stores empty by default and proves
mechanics via fixtures and dry-runs.
