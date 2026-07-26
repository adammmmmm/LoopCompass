# Consumer verification

Checks a **consumer repository** (not this source repo) after install.

## One command

From a LoopCompass checkout (or any copy of these scripts):

```sh
node scripts/verify-consumer.mjs --project /path/to/your/repo
```

Optional explicit skill paths (comma-separated, relative to project):

```sh
node scripts/verify-consumer.mjs --project /path/to/your/repo \
  --skill-paths .agents/skills/loop-compass,.claude/skills/loop-compass
```

## What it asserts

1. At least one `loop-compass` skill install exists under `.agents`, `.claude`, or `skills`.
2. Required skill files are present and match the manifest digests. The only permitted execution
   surface is a manifested `.mjs` directly beneath the skill's `scripts/` directory; unexpected
   or unmanifested scripts are rejected.
3. When multiple installs exist, their complete file inventories and bytes are identical.
4. `AGENTS.md` / `CLAUDE.md` (if present) each contain exactly one managed policy marker pair and
   the canonical policy body.
5. If `.loopcompass` exists, capsules pass `validate-state` rules (slug, status, verification
   section, open-incident containment expiry).

The installed skill also contains an explicitly invoked, non-mutating committed-state audit:

```sh
node <installed-skill>/scripts/redact-check.mjs --project /path/to/your/repo --mode audit
node <installed-skill>/scripts/redact-check.mjs --project /path/to/your/repo --mode enforce
```

`audit` reports historical findings without failing on content. `enforce` fails on
high-confidence findings. Both are local, require Git, and otherwise use only the Node standard
library. Scanned state must be tracked, clean, and byte-identical to `HEAD`. See the installed
`references/redaction-audit.md` for configuration, limits, and non-sensitive output guarantees.

## Related maintainer commands

```sh
node scripts/validate-state.mjs --project /path/to/your/repo
node scripts/release.mjs stage-install --project /path/to/your/repo --hosts agents,claude
node scripts/release.mjs check --installed <skill-dir> --release-manifest <manifest.yaml>
```

## CI snippet (consumer)

```yaml
- name: LoopCompass consumer checks
  run: node /path/to/LoopCompass/scripts/verify-consumer.mjs --project .
```

Pin the LoopCompass scripts version (release tag) you trust. Do not fetch floating `main` in
production CI without review.
