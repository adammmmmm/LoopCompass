---
id: TASK-006
title: "Release distribution: v1 update contract and clean-main workflow"
status: done
created: 2026-07-11T11:39:39Z
claimed: 2026-07-11T11:39:39Z
completed: 2026-07-11T11:39:39Z
tags: [release, workflow, docs]
owner: grok:TASK-006
worker: grok
branch: task/TASK-006-v1-update-contract
---

# TASK-006 - Release distribution: v1 update contract and clean-main workflow

## Goal

Ship the in-repo v1 update prerequisites and adopt the hedge-style clean-main task branch PR workflow.

## Done

- VERSION, CHANGELOG, skill manifest digests, release.mjs validate/generate/package/check
- Managed policy markers already present; docs and skill contracts updated
- Clean-main workflow, AGENTS.md, CLAUDE.md, project.json deployOnPush=safe, task-worktree helper
- CI validate-manifest workflow
