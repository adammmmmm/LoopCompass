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
| Terminal and parent receipt contract | `scripts/lib/receipt.mjs`, `tests/receipt-contract.test.mjs`, `skills/loop-compass/references/terminal-receipts.md` |
| Evaluation benchmark fixtures + Markdown report | `fixtures/evaluation/cases.json`, `scripts/evaluate.mjs`, `docs/evaluation-benchmark.md`; includes host-enforcement vs skill-decision separation and parent/subagent/missing-skill/missing-instruction dimensions |
| Capsule schema + state dir + containment expiry | `scripts/lib/capsule.mjs`, `validate-state.mjs` |
| Recovery/incident field rules + templates | `scripts/lib/frontmatter.mjs`, `tests/artifact-schema.test.mjs` |
| Project-scope stage, one-source multi-host install, update check | `release.mjs stage-install`, dry-run tests |
| Consumer integration kit | `scripts/verify-consumer.mjs`, `docs/consumer-verification.md` |
| Optional human-attention lifecycle, crash repair, fail-closed marker history, and projection reconciliation | `fixtures/human-attention/cases.json`, `tests/human-attention-profile.test.mjs` |
| Schema-1 ownership evidence, explicit authority/order gaps, and consumer-state byte identity | `fixtures/ownership-probe/cases.json`, `scripts/ownership-probe.mjs`, `tests/ownership-probe.test.mjs` |
| Example redaction denylist | `scripts/redact-check.mjs`, `examples/capsules/` |
| Manifest digests and policy marker integrity | `scripts/release.mjs`, `tests/release-tooling.test.mjs` |
| Persist, no-artifact, or exact-escalation policy contract | `tests/release-tooling.test.mjs` |
| Repository owner review evidence and ruleset/settings audit | `scripts/lib/review-gate.mjs`, `tests/review-gate.test.mjs`, `tests/repository-health.test.mjs` |

Release 0.4.0 cross-feature, live-host, package, and byte-preserving consumer evidence is recorded
in [release-conformance-0.4.0.md](release-conformance-0.4.0.md).

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
