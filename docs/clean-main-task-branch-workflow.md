# Clean-Main Task Branch Workflow

This is the default workflow for autonomous development in this trusted repo. Keep `main` clean,
give each accepted change one owner, and land through a pull request.

## Core rule

`main` is the integration checkout, not a scratchpad. Source, docs, tests, and task records land
through a task worktree and pull request. Read-only scouting may use the integration checkout.

Do not add permission brokers, global locks, agent queues, or a new landing service. Git branches,
worktrees, task metadata, focused checks, and one root landing owner are enough.

## Branch types

- `task/TASK-NNN-slug`: accepted or acceptance-bound work. This is the normal mergeable unit.
- `lab/TASK-NNN-slug`: product, docs, or UX exploration.
- `spike/TASK-NNN-slug`: technical feasibility or risky uncertainty.

Every branch gets a `TASK-NNN`. A mergeable task branch should contain one coherent improvement that
can be accepted, rejected, or reverted as one squash commit.

Promote a clean `lab/*` or `spike/*` branch by renaming it to `task/*`. If only part is accepted,
port that part to a fresh `task/*` branch.

## Paved start

For non-trivial write work, create the isolated branch, worktree, and task record in one command:

```sh
node scripts/task-worktree.mjs create TASK-NNN short-slug \
  --title "Workstream: client-readable outcome" \
  --tags docs,release \
  --worker grok
```

By default the helper fetches `origin/main`, resolves that ref to an exact commit, and creates the
worktree at:

```text
../LoopCompass-worktrees/TASK-NNN-short-slug
```

It does not base new work on a dirty local `HEAD`, and it does not write task files into the
integration checkout.

Offline or historical base:

```sh
node scripts/task-worktree.mjs create TASK-NNN short-slug \
  --title "Workstream: client-readable outcome" \
  --tags docs \
  --worker grok \
  --base HEAD
```

If the destination worktree path already exists, stop and inspect it. Do not reuse it implicitly.

## Autonomous ownership

Trusted local engineering agents own a coherent task through implementation, review, validation,
commit, PR, CI repair, and merge when policy allows. The root driver is the single lightweight
landing owner for the session.

Run disjoint work in parallel. Serialize when file or behavioral overlap is obvious. Routine
collisions are not an operator escalation: land the better-ready change first, refresh the other
task from the new `origin/main`, and continue.

## Validation and review

Validation must be fresh and relevant to the changed surface. For this repo the default gate is:

```sh
node scripts/release.mjs validate
```

Run it when `VERSION`, the skill tree, policy markers, or release tooling change. Doc-only tasks
still need a quick consistency pass against the linked contracts.

Review scope, quality, hard-stop compliance, and validation before opening or merging a PR. Never
merge a red PR.

## Push and landing

- Use normal pushes for new commits.
- If a rebased branch requires history replacement, use `--force-with-lease` only. Plain
  `--force` is prohibited.
- Open a PR for the coherent task and arm squash auto-merge:

```sh
gh pr create --title "..." --body "..."
gh pr merge --auto --squash --delete-branch
```

- Accepted task branches land as one squash commit and delete the remote task branch.
- This repository has no production deploy-on-push surface. Green reviewed PRs may merge without a
  deploy gate when CI is green or when no required checks are configured.
- After merge, refresh the integration checkout with `git pull --ff-only`.

## Project state

Task records start in the task worktree under `.claude/tasks/`. Prefer moving finished tasks to
`.claude/tasks/done/` in the same PR when the work is complete.

Generated archives under `dist/` remain ignored. Do not commit release tarballs; attach them to
GitHub Releases when cutting a version.

## Hard stops

Stop and ask the operator only for:

- irreversible destructive git or filesystem actions beyond the normal PR flow
- secret mutation or exposure
- legal, payment, or outward-facing publication decisions beyond ordinary repo commits
- an explicit operator gate

Commit, push, PR, CI repair, and merge of green work on this operator-owned repo are agent work,
not operator-attention items.
