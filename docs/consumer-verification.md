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
2. Required skill files are present; skill tree contains only `.md` / `.yaml` (portable core).
3. When multiple installs exist, corresponding files are **byte-identical**.
4. `AGENTS.md` / `CLAUDE.md` (if present) each contain exactly one managed policy marker pair and
   the canonical policy body.
5. If `.loopcompass` exists, capsules pass `validate-state` rules (slug, status, verification
   section, open-incident containment expiry).

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
