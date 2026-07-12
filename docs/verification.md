# Verification

How LoopCompass proves its mechanical contracts without requiring a consumer runtime.

## One command

```sh
node scripts/verify.mjs
```

Runs:

1. `node --test tests` - unit, fixture, schema, capsule, install/update dry-run, consumer kit tests.
2. `node scripts/release.mjs validate` - VERSION, policy markers, per-file digests.
3. `node scripts/redact-check.mjs examples` - denylist for project-specific tokens in examples.

## What is automated

| Area | Location |
| --- | --- |
| Signature normalize + slug + collision suffix | `scripts/lib/signature.mjs`, `tests/signature.test.mjs` |
| Identity goldens (single source of truth) | `fixtures/identity/goldens.json`, `tests/identity-goldens.test.mjs` |
| Classification goldens + hard-lane gates | `fixtures/classification/cases.json`, `classify-assist.mjs` |
| Capsule schema + state dir + containment expiry | `scripts/lib/capsule.mjs`, `validate-state.mjs` |
| Recovery/incident field rules + templates | `scripts/lib/frontmatter.mjs`, `tests/artifact-schema.test.mjs` |
| Project-scope stage, dual-host install, update check | `release.mjs stage-install`, dry-run tests |
| Consumer integration kit | `scripts/verify-consumer.mjs`, `docs/consumer-verification.md` |
| Example redaction denylist | `scripts/redact-check.mjs`, `examples/capsules/` |
| Manifest digests and policy marker integrity | `scripts/release.mjs`, `tests/release-tooling.test.mjs` |

## What remains host-level

Trigger timing, subagent inheritance, and consultation miss-rate need real agent hosts. Use
[host-matrix.md](host-matrix.md), [host-results/](host-results/), and the numbered acceptance tests
in [design.md](design.md).

## Release hygiene

- **On every PR / push to main:** `node scripts/verify.mjs` (CI workflow).
- **Between tags:** source-tree `manifest.commit` may lag HEAD; that is expected.
- **On tag `v*`:** CI runs verify, informational `pin-check`, then `package` (rewrites the
  **archive** `manifest.commit` to the tag SHA) and uploads dist artifacts.
- **Consumers:** trust the published tarball + `SHA256SUMS` + per-file digests. Do not treat
  source-tree `pin-check --strict` on a tag checkout as a consumer install gate.

## Dogfood

Live recoveries and incidents belong in consumer repos. This repository ships **redacted examples**
under `examples/capsules/` (teaching only) and keeps `.loopcompass` empty by default.
