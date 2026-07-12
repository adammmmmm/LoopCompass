---
id: worktree-spawn-from-non-git-cwd
schema: 1
signature: "worktree spawn from non-git cwd"
status: blocked
requires: [global_config_write]
owner: operator
opened: 2026-07-08
containment_expires: 2099-08-07
consulted: []
---

<!-- source: example (redacted pilot pattern); not live project memory -->

# Repair worktree-isolated delegation from a neutral root

## Failure

Normal path: spawn a worktree-isolated worker from a neutral non-repository session root aimed at a
target repo.

Evidence: deterministic error that the cwd is not a Git repository and no worktree-create hooks are
configured, while earlier spawns from the same session may have succeeded. Multiple data points may
not yet prove root cause.

## Repair

Reproduce neutral-root behavior and repair the global delegation or worktree-create mechanism so
target-repository isolation is deterministic. Do not assert a repository-local cause without
reproduction.

## Containment

Use an explicit target-repository task worktree when isolation is required; keep the incident open.
Owner: operator. Expiry: fixture far-future.

## Verification

From a clean non-repository cwd, run repeated worktree-isolated spawns, confirm each worker receives
the target repository and delivers its result.
