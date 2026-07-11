# AGENTS.md - LoopCompass

Driver-neutral instructions for agents working in this repository.

## Product

LoopCompass is a portable skill plus Markdown templates. It has no daemon, no consumer runtime CLI,
no database, and no hosted service. Ordinary failure consultation stays offline.

## Clean-main workflow

Keep `main` clean. All write-producing work lands through a task worktree and pull request.

- Workflow: [docs/clean-main-task-branch-workflow.md](docs/clean-main-task-branch-workflow.md)
- Branch form: `task/TASK-NNN-slug`
- Worktree root: `../LoopCompass-worktrees/TASK-NNN-slug`
- Helper:

```sh
node scripts/task-worktree.mjs create TASK-NNN short-slug \
  --title "Workstream: client-readable outcome" \
  --tags docs,release \
  --worker <driver>
```

After opening a PR, arm squash auto-merge when checks allow:

```sh
gh pr merge --auto --squash --delete-branch
```

Then refresh the integration checkout with `git pull --ff-only`.

## Gate

When `VERSION`, the skill tree, policy markers, manifests, or release tooling change:

```sh
node scripts/release.mjs validate
```

Optional packaging check (writes gitignored `dist/`):

```sh
node scripts/release.mjs package
```

## Updates

Consumer software updates are explicit and agent-assisted from immutable GitHub releases. See
[docs/update-strategy-v1.md](docs/update-strategy-v1.md). Do not check for or install updates during
ordinary LoopCompass failure consultation.

## Hard stops

- Do not force-push with plain `--force` (use `--force-with-lease` only when history rewrite is
  required on a task branch).
- Do not modify `.loopcompass/recoveries/` or `.loopcompass/incidents/` during a software update.
- Do not rewrite host project instructions outside the managed LoopCompass policy markers.
- Commit, push, PR, and merge of green work on this operator-owned repo are expected agent actions.
  Escalate only irreversible destructive operations, secrets, legal/payment commitments, or an
  explicit operator gate.

## Project policy data

```sh
node ~/.claude/engine/project.mjs . --json
```

`policy.deployOnPush` is `"safe"`: merging to `main` does not deploy a production service.
