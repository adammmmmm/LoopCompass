---
id: TASK-007
title: "Release inventory: LF-normalized digests for CI"
status: done
created: 2026-07-11T11:48:50Z
claimed: 2026-07-11T11:48:50Z
completed: 2026-07-11T11:48:50Z
tags: [release, ci]
owner: grok:TASK-007
worker: grok
branch: task/TASK-007-digest-lf-normalize
---

# TASK-007 - LF-normalized digests for CI

## Goal
Fix validate-manifest CI failure caused by Windows CRLF working-tree digests vs Linux LF checkout.

## Done
- Hash skill files after LF normalization in scripts/release.mjs
- Regenerate skills/loop-compass/manifest.yaml
- Add .gitattributes eol=lf for canonical text
