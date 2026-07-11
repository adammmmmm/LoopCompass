# LoopCompass v1 update strategy

## Outcome

LoopCompass v1 uses explicit, agent-assisted updates from immutable GitHub releases. An update
replaces the installed skill, updates only the managed LoopCompass project-policy block, preserves
all project recovery and incident state, validates the result, and reports exactly what changed.

V1 does not silently check for or install updates during normal use. The update flow becomes
executable only after LoopCompass publishes the release metadata and managed policy markers defined
below.

## Design goals

- Keep ordinary LoopCompass use offline and dependency-free.
- Make the installed version and source inspectable.
- Preserve repository review and rollback.
- Update personal and project-local installations safely.
- Never overwrite host instructions outside the managed LoopCompass block.
- Never modify recovery or incident artifacts during a software update.
- Stop before applying incompatible schema or policy changes.
- Leave plugin-managed and automatic updates as optional future delivery paths.

## Versioned release artifacts

Every tagged release must contain:

```text
LoopCompass/
├── VERSION
├── skills/
│   └── loop-compass/
│       ├── manifest.yaml
│       ├── SKILL.md
│       ├── agents/
│       ├── assets/
│       └── references/
└── docs/
```

The GitHub release publishes `SHA256SUMS` as a separate release asset outside every archive it
covers.

`VERSION` contains the release semantic version. The skill manifest is the authoritative record of
the installed skill:

```yaml
name: loop-compass
version: 0.1.0
source: https://github.com/adammmmmm/LoopCompass
release: https://github.com/adammmmmm/LoopCompass/releases/tag/v0.1.0
commit: <full-release-commit>
skill_schema: 1
policy_version: 1
state_schema: 1
minimum_policy_version: 1
files:
  SKILL.md: <sha256>
  agents/openai.yaml: <sha256>
  assets/project-policy.md: <sha256>
  # Include every distributed skill file.
```

The updater resolves a release tag to a full commit, pins every subsequent fetch to that commit,
verifies the release archive against the separately published `SHA256SUMS` file, and verifies every
installed file against the manifest inventory.
`main` is development state and must not be used as the default update source.

Commit pinning and digests provide content integrity and reproducibility, not maintainer
authenticity after a source-account compromise. Signed releases are a future hardening layer.

## V1 release prerequisites

Before documenting the updater as available, the LoopCompass source repository must ship:

1. A semantic `VERSION` file.
2. A complete skill `manifest.yaml` with per-file SHA-256 digests.
3. A GitHub release pinned to the manifest commit with a separate `SHA256SUMS` file covering each
   release archive.
4. The marked canonical policy block described below.
5. A release validation check that reconstructs and verifies the manifest inventory.

Until these exist, users may reinstall from a reviewed commit, but they cannot claim conformance
with this v1 update contract.

## Managed project policy

The canonical policy is installed inside the host's inherited repository instructions, such as
`AGENTS.md` or `CLAUDE.md`, between markers owned by LoopCompass:

```markdown
<!-- loopcompass:start policy=1 -->
...canonical LoopCompass policy...
<!-- loopcompass:end -->
```

The updater may replace only the content from the opening marker through the closing marker. It
must preserve every byte of project instruction content outside that block.

Missing, duplicated, nested, malformed, or overlapping markers are a hard stop. The updater reports
the problem and requests operator direction rather than guessing which content it owns.

## Protected project state

Software updates must not create, edit, move, migrate, or delete:

```text
.loopcompass/
├── recoveries/
└── incidents/
```

State migration is a separate, explicit operation. A release whose `state_schema` differs from the
installed manifest must stop before update and present its migration instructions and rollback plan
to the operator.

A project-local update requires a quiescent LoopCompass state directory with no agent writing
recoveries or incidents. Snapshot state hashes immediately before mutation and after validation.
Any change is reported as concurrent activity and blocks the success claim; the updater never tries
to reverse or merge that state change.

## Installation scopes

### Personal skill

A skill installed in the user-level Codex, Claude, Cursor, or other host skill directory is updated
once for that user. Projects using it receive the new skill behavior, but each repository's managed
policy block remains versioned independently.

When the installed manifest requires a newer policy, LoopCompass should report the project policy
as stale before relying on changed trigger or escalation behavior. The user then runs the project
update flow to refresh the managed block.

### Project-local skill

A skill committed into a repository is updated in that repository and reviewed as an ordinary code
change. The skill and policy versions travel with the project, which provides the most reproducible
team behavior.

## Update flow

The updating agent must perform these steps in order:

1. Require the operator or calling instruction to select `personal` or `project` installation
   scope. Never infer scope from the first discovered skill.
2. Locate the installed skill for that exact scope. For `project` scope only, also locate the
   managed project-policy block.
3. A project-scoped update must not replace a personal skill. A personal update must not edit any
   project without separate authorization.
4. Read the installed manifest. For `project` scope only, also read the policy marker version.
5. Resolve the requested release, defaulting to the latest stable GitHub release rather than
   `main`.
6. Pin the release to a full commit and verify archive and file digests.
7. Compare release, skill schema, policy version, state schema, and minimum policy requirements.
8. Hash installed files against the installed manifest to detect local modification.
9. Stop for operator approval on a major version change, state-schema change, missing migration,
   malformed policy markers, unexpected source, local skill modifications, or any added permission,
   hook, network, tool, command-execution, or external-service surface.
10. For a project update, confirm that no agent is writing `.loopcompass` state and snapshot its
    hashes.
11. Stage the complete new skill in a temporary sibling directory on the same filesystem.
12. Validate the staged skill and verify every file against the pinned release manifest.
13. Create a transaction journal containing scope, paths, old and new manifests, policy snapshot,
    backup path, state snapshot, and completed mutation steps.
14. Copy the current installed skill to the journaled backup path and verify its file inventory.
15. Replace the installed skill directory only after backup and staging validation succeed. Do not
    describe this replacement as atomic across hosts.
16. For `project` scope only, replace the marked LoopCompass policy block. A personal update does
    not modify project policy.
17. Run skill validation and host discovery checks.
18. For a project update, compare the final state snapshot and report any concurrent change without
    modifying that state.
19. Report old and new versions, release commit, policy change, validation, preserved state, and any
    follow-up migration requirement.

If any mutation step fails, use the journal to restore the policy snapshot and backed-up skill,
then validate the restored installation. If restoration fails, stop immediately, preserve staging,
backup, and journal paths, and report manual recovery instructions. Remove temporary paths only
after the updated or restored installation validates successfully.

## Compatibility rules

| Change | V1 behavior |
|---|---|
| Patch release, unchanged schemas | Update after validation |
| Minor release, compatible schemas | Update after validation and show policy diff |
| Major release | Require operator approval |
| Policy version increase within declared compatibility | Replace managed block and report |
| State-schema change | Stop and require an explicit migration |
| Skill-schema change unsupported by the updater | Stop without mutation |
| Source repository changes | Stop and require operator approval |
| Installed skill has local modifications | Stop and show the diff |
| Permission, hook, network, or execution surface expands | Stop and require operator approval |

## Agent one-liners

### Update one project

> Update the project-local LoopCompass installation in this project from the latest stable release at
> https://github.com/adammmmmm/LoopCompass. Follow `docs/update-strategy-v1.md`: replace the
> installed skill as one validated unit, update only the managed LoopCompass policy block, preserve
> `.loopcompass/recoveries` and `.loopcompass/incidents` byte-for-byte, stop on compatibility or
> local-modification conflicts, and report the old and new versions plus validation evidence.

### Update a personal skill

> Update my personal LoopCompass skill from the latest stable release at
> https://github.com/adammmmmm/LoopCompass. Follow `docs/update-strategy-v1.md`, verify the release
> manifest, preserve project state, validate host discovery, and inspect policy versions only in the
> current project and additional repository roots I explicitly provide. Do not search for or modify
> other projects without separate authorization.

### Install a specific version

> Install LoopCompass version `<version>` as a `<personal|project-local>` installation from the
> matching commit-pinned GitHub release. Follow `docs/update-strategy-v1.md`; for project-local scope,
> install the canonical managed policy block for this host. Validate skill discovery and the direct
> `.loopcompass` fallback, then report the installed version, scope, and release commit.

## Rollback

Rollback is an explicit update to a previously released version:

1. Select the previous immutable release recorded in the update report.
2. Apply the same compatibility checks and staging validation.
3. Replace the skill from that release. For project-local scope only, also replace the managed
   policy block.
4. Do not roll back project state automatically.
5. Stop if the current state schema is incompatible with the older release.

## Security and trust

- Accept updates only from the configured canonical source unless the operator approves a source
  change.
- Resolve the release tag to a full commit, pin retrieval to it, and verify archive and file digests
  before mutation.
- Treat release notes as documentation, not executable instructions.
- Never execute commands embedded in recoveries or incidents during an update.
- Never grant new permissions merely because a release requests them.
- Require operator approval before applying permission, hook, network, external-service, tool, or
  execution-surface additions.

Signed releases and stronger supply-chain verification are future hardening opportunities. V1
provides content integrity and reproducibility, not protection against compromise of the canonical
source account.

## Deferred automation

V1 deliberately excludes:

- update checks during ordinary LoopCompass invocation;
- silent background updates;
- automatic project-wide policy rewrites;
- mandatory package managers, daemons, hooks, or CLIs;
- implicit state migrations;
- automatic channel switching between stable and prerelease versions.

Host plugins may later add version discovery, update notifications, release channels, compatibility
checks, and marketplace-managed delivery. The portable explicit update flow must remain available
when no plugin is installed.

## Acceptance tests

1. A patch update replaces the complete skill and only the managed policy block.
2. Project instructions outside the managed block remain byte-for-byte unchanged.
3. Recovery and incident artifacts remain byte-for-byte unchanged.
4. A malformed or duplicated marker stops the update without mutation.
5. A locally modified installed skill stops the update and shows the conflict.
6. A state-schema change stops and requests an explicit migration.
7. A staged skill that fails validation never replaces the installed skill.
8. A failed replacement restores the previous skill and policy.
9. A personal skill update reports repositories with stale policies without editing them.
10. Rollback reinstalls a prior immutable release without rolling back project state.
11. A project update cannot replace a personal installation.
12. A personal update does not enumerate or edit projects outside explicitly provided roots.
13. An expanded permission or execution surface stops for approval.
14. A rollback failure preserves its journal, backup, staging paths, and manual recovery steps.

## Decision audit

### Decision: explicit agent-assisted updates

Question: How should v1 distribute updates without adding a runtime dependency?

Recommended: Use explicit agent-assisted updates from immutable releases with manifests and managed
policy markers.

Alternatives:

1. Silent update checks during invocation: add network dependency and unpredictable mutation.
2. Git submodules: preserve source identity but complicate installation and host-specific policy
   placement.
3. Mandatory updater CLI: improves deterministic mutation but makes the lightweight core depend on
   another executable.

Chosen: Explicit agent-assisted updates.

Why: This preserves transparency, reviewability, offline normal operation, and provider neutrality
while leaving a clean path to future plugin-managed delivery.
