# Verification

How LoopCompass proves its mechanical contracts without requiring a consumer runtime.

## One command

```sh
node scripts/verify.mjs
```

Runs:

1. `node --test tests` - unit, fixture, schema, capsule, evaluation, install/update dry-run, consumer kit tests.
2. `node scripts/release.mjs validate` - VERSION, policy markers, per-file digests.
3. `node scripts/redact-check.mjs examples` - denylist for project-specific tokens in examples.

## What is automated

| Area | Location |
| --- | --- |
| Signature normalize + slug + collision suffix | `scripts/lib/signature.mjs`, `tests/signature.test.mjs` |
| Identity goldens (single source of truth) | `fixtures/identity/goldens.json`, `tests/identity-goldens.test.mjs` |
| Classification goldens + hard-lane gates | `fixtures/classification/cases.json`, `classify-assist.mjs` |
| Evaluation benchmark fixtures + Markdown report | `fixtures/evaluation/cases.json`, `scripts/evaluate.mjs`, `docs/evaluation-benchmark.md`; includes host-enforcement vs skill-decision separation and parent/subagent/missing-skill/missing-instruction dimensions |
| Capsule schema + state dir + containment expiry | `scripts/lib/capsule.mjs`, `validate-state.mjs` |
| Recovery/incident field rules + templates | `scripts/lib/frontmatter.mjs`, `tests/artifact-schema.test.mjs` |
| Project-scope stage, dual-host install, update check | `release.mjs stage-install`, dry-run tests |
| Consumer integration kit | `scripts/verify-consumer.mjs`, `docs/consumer-verification.md` |
| Example redaction denylist | `scripts/redact-check.mjs`, `examples/capsules/` |
| Manifest digests and policy marker integrity | `scripts/release.mjs`, `tests/release-tooling.test.mjs` |
| Persist, no-artifact, or exact-escalation policy contract | `tests/release-tooling.test.mjs` |

## What remains host-level

Trigger timing, authorized recovery and incident persistence, explicit no-artifact reporting,
read-only subagent handoff, and consultation miss-rate need real agent hosts. Use
[host-matrix.md](host-matrix.md), [host-results/](host-results/), and the numbered acceptance tests
in [design.md](design.md).

The deterministic benchmark in [evaluation-benchmark.md](evaluation-benchmark.md) can score
synthetic or recorded receipts before a live host pass exists. It should not be used as evidence of
provider-specific host performance unless the receipts name an explicit host version and run
protocol.

## Release hygiene

- **On every PR / push to main:** `node scripts/verify.mjs` (CI workflow).
- **Between tags:** source-tree `manifest.commit` may lag HEAD; that is expected.
- **On tag `v*`:** CI runs verify, informational `pin-check`, then `package` (rewrites the
  **archive** `manifest.commit` to the tag SHA) and uploads dist artifacts.
- **Consumers:** trust the published tarball + `SHA256SUMS` + per-file digests. Do not treat
  source-tree `pin-check --strict` on a tag checkout as a consumer install gate.

## Dogfood

Live recoveries and incidents remain repository-local and are not included in release archives.
This source repository may dogfood maintenance-specific records under `.loopcompass/`; portable
teaching examples remain redacted under `examples/capsules/`.
