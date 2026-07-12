# Changelog

All notable changes to LoopCompass are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Capsule state validator (`scripts/lib/capsule.mjs`, `scripts/validate-state.mjs`) with
  containment-expiry enforcement for open incidents.
- Identity golden vectors (`fixtures/identity/goldens.json`) as normalize/slug single source of truth.
- Classification assist gates for unambiguous fixture contradictions.
- Dual-host `stage-install` and `pin-check` commands on `scripts/release.mjs`.
- Consumer integration kit (`scripts/verify-consumer.mjs`, `docs/consumer-verification.md`).
- Redacted teaching examples under `examples/capsules/` plus `redact-check` denylist.
- Host-results template and scaffold note under `docs/host-results/`.
- Consultation reuse protocol in skill + project policy (`consulted` / task closeout).
- Executable verification: `node scripts/verify.mjs` (Node test suite + release validate).
- Deterministic signature normalize/slug helpers in `scripts/lib/signature.mjs`.
- Classification fixtures in `fixtures/classification/cases.json`.
- Install/update dry-run tests and artifact field validation.
- Host matrix checklist (`docs/host-matrix.md`) and verification guide (`docs/verification.md`).
- Tag CI job to package release archives; tag pipeline runs `pin-check --strict`.

### Changed

- Installation scopes renamed to **global** (host skill directory) and **project** (repo-local).
- Integration docs cover multi-host project layout (Codex + Claude paths).
- Incident template and classification notes cover lifecycle / expired containment.

### Fixed

- Recovery/incident templates require mechanical slug ids.
- Duplicate line in design acceptance section.

## [0.1.0] - 2026-07-11

### Added

- Portable `loop-compass` skill with recovery and incident templates.
- Canonical managed project-policy block with `loopcompass:start` / `loopcompass:end` markers.
- Classification and host integration references.
- Design document and acceptance tests for the two-lane workflow.
- V1 explicit update contract (`docs/update-strategy-v1.md`).
- Release `VERSION`, skill `manifest.yaml` with per-file SHA-256 digests, and
  `scripts/release.mjs` for generate/validate/package checksums.

[Unreleased]: https://github.com/adammmmmm/LoopCompass/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/adammmmmm/LoopCompass/releases/tag/v0.1.0
