# CLAUDE.md - LoopCompass

## What this is

Portable agent skill for classifying recurring operational failures into verified recoveries or
root-cause repair incidents. First milestone: skill + Markdown only.

## Working rules

1. Keep `main` clean. Use the clean-main task branch workflow in
   `docs/clean-main-task-branch-workflow.md`.
2. Create write work with:

   ```sh
   node scripts/task-worktree.mjs create TASK-NNN short-slug \
     --title "Workstream: client-readable outcome" \
     --tags docs,release \
     --worker claude
   ```

3. Land through PR + squash auto-merge. Pull `main` with `--ff-only` after merge.
4. Run `node scripts/release.mjs validate` when release inventory or skill files change.
5. Do not add daemons, hooks, consumer CLIs, or silent update checks without an explicit design
   decision and measured need.
6. Preserve `.loopcompass/recoveries` and `.loopcompass/incidents` during software updates.

## Authoritative docs

- Design: `docs/design.md`
- Update contract: `docs/update-strategy-v1.md`
- Clean-main workflow: `docs/clean-main-task-branch-workflow.md`
- Skill: `skills/loop-compass/SKILL.md`
