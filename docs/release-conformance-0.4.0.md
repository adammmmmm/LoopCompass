# Release conformance for 0.4.0

This record integrates the already-landed feature contracts without introducing a new runtime or
state schema. Schema 2 remains deferred and unauthorized by the ownership decision; release 0.4.0
retains `state_schema: 1`.

## Cross-feature evaluation

The integrated focused gate ran the existing classification, aliases, optional human-attention,
schema-1 ownership, evaluation, terminal-receipt, PII sanitation, and committed-state redaction
suites together. It passed 200 tests. This combines receipt and same-turn parent closure,
enabled/disabled projections, the selected schema-1 coordinator model, task-versus-mechanism
outcomes, aliases, sanitation, and redaction without inventing a schema-2 join.

One previously uncovered acceptance scenario was added to the existing classification-completion
fixture: a restricted-network `gh auth status` failure cannot establish invalid credentials.
Network reachability, credential validity, and Git commit identity remain separate facts. A
supported-network non-mutating authenticated API probe succeeded, so no login, logout, rotation,
or credential replacement was recommended.

## Host evidence

| Host | Result | Evidence |
| --- | --- | --- |
| Codex CLI 0.146.0-alpha.3.1 | Pass | An ephemeral read-only worker loaded the installed 0.4.0 skill and inherited policy, then returned schema-validated recovery classification, supported-probe credential validity, no credential mutation, and a same-turn proposed-artifact action for parent persistence or deduplication. |
| Claude Code | Explicitly unassessed | Best-effort execution was time-boxed; no provider-behavior claim is made. |
| Grok CLI | Explicitly unassessed | Best-effort execution was time-boxed; no provider-behavior claim is made. |

The first Codex launcher attempt was blocked before model execution because the enclosing sandbox
could not open the host state database. Re-running the same ephemeral prompt with host access and
a read-only project sandbox passed. This is recorded as host-execution evidence, not as a model
failure or a credential diagnosis.

## Consumer update

A detached validation worktree linked to the `hedge-collector` consumer was updated with both
project host skill installs. The release comparison reported 0.4.0, policy 2, state schema 1, and
`status: up to date`.

The complete consumer `.loopcompass` file-set digest was
`e9b6a1deb80ce9e3ede2ed4b3e78426fb1bb691a33b5f484cae7fe27982c1155` both before and after the
update. `git diff --quiet -- .loopcompass` also passed. The consumer's main checkout was not
modified.

## Release validation

- `node scripts/release.mjs validate` passed for version 0.4.0, policy 2, state schema 1, and all
  13 manifested skill files.
- `node scripts/release.mjs package` built `loopcompass-v0.4.0.tar.gz` and `SHA256SUMS`.
- The checksum file validated the archive, whose installed skill bytes match the manifest.
- `node scripts/verify.mjs` is the final full verification gate.
