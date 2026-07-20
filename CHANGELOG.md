# Changelog

All notable changes to LoopCompass are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Deterministic evaluation benchmark fixtures and Markdown report generator for measurement-only
  host-agnostic scoring.

## [0.3.0] - 2026-07-16

### Changed

- Verified agents now persist justified recoveries and incidents automatically within current
  repository authority.
- Every triggered classification must finish as a persisted artifact, explicit `no artifact`, or
  a proposed artifact with the exact permission, capability, or operator escalation required.
- Delegated read-only workers return a complete classification payload for same-turn parent
  handling.

## [0.2.1] - 2026-07-12

### Fixed

- Release packaging now LF-canonicalizes skill text into the archive and fails if staged
  raw digests do not match the manifest. Fixes Windows worktree CRLF for
  `agents/openai.yaml` making v0.2.0 fail consumer per-file integrity checks that hash
  raw bytes (not LF-normalized hashes).

## [0.2.0] - 2026-07-12

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

### Changed

- Integration docs cover multi-host project layout (Codex + Claude paths).
- Incident template and classification notes cover lifecycle / expired containment.
- Tag CI packages release archives; pin status is informational (archive pin rewritten to tag SHA).

### Fixed

- Recovery/incident templates require mechanical slug ids.

## [0.1.0] - 2026-07-11

### Added

- Portable `loop-compass` skill with recovery and incident templates.
- Canonical managed project-policy block with `loopcompass:start` / `loopcompass:end` markers.
- Classification and host integration references.
- Design document and acceptance tests for the two-lane workflow.
- V1 explicit update contract (`docs/update-strategy-v1.md`).
- Release `VERSION`, skill `manifest.yaml` with per-file SHA-256 digests, and
  `scripts/release.mjs` for generate/validate/package checksums.
- Executable verification: `node scripts/verify.mjs` (Node test suite + release validate).
- Deterministic signature normalize/slug helpers in `scripts/lib/signature.mjs`.
- Classification fixtures in `fixtures/classification/cases.json`.
- Install/update dry-run tests and artifact field validation.
- Host matrix checklist (`docs/host-matrix.md`) and verification guide (`docs/verification.md`).

### Changed

- Installation scopes renamed to **global** (host skill directory) and **project** (repo-local).

### Fixed

- Duplicate line in design acceptance section.

[Unreleased]: https://github.com/adammmmmm/LoopCompass/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/adammmmmm/LoopCompass/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/adammmmmm/LoopCompass/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/adammmmmm/LoopCompass/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/adammmmmm/LoopCompass/releases/tag/v0.1.0
