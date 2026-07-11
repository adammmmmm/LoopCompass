# Changelog

All notable changes to LoopCompass are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
