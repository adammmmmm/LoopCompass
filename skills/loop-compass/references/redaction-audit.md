# Redaction audit

The shipped checker is a conservative, local defense-in-depth check for committed LoopCompass
state. It never modifies files, installs dependencies, uses the network, or claims that passing
proves the absence of PII.

Run the checker from any installed skill:

```text
node <installed-skill>/scripts/redact-check.mjs --project <repo> --mode audit
node <installed-skill>/scripts/redact-check.mjs --project <repo> --mode enforce
```

Both modes scan `.loopcompass/incidents/`, `.loopcompass/recoveries/`,
`.loopcompass/receipts/`, and `.loopcompass/terminal-receipts/` when present. `audit` reports
historical findings without failing because of content findings. `enforce` exits nonzero for
high-confidence blocking categories. Warnings do not fail either mode. Invocation, configuration,
and filesystem-preflight errors fail safely in both modes.

Output contains only stable categorical rule IDs and aggregate counts. It never prints matched
values, filenames, project paths, configured pattern IDs or expressions, or raw content. Symlinks
are not followed. Files larger than 1 MiB and binary files are skipped with categorical warnings.

## Project patterns

A consumer may add `.loopcompass/redaction.yaml`. The file is consumer-owned and is not part of
the installed skill:

```yaml
version: 1
patterns:
  - id: private-organization
    literal: "Synthetic Private Organization"
    severity: block
    flags: i
  - id: account-shape
    regex: "\\bACCOUNT-[0-9]{8}\\b"
    severity: warn
```

Each entry requires a non-sensitive `id` plus exactly one `literal` or safely bounded `regex`.
Severity is `block` by default or may be `warn`. Flags are limited to `i`, `m`, and `u`.
Literals and expressions are bounded in count and length. Regular expressions must use an anchor
or word boundary and cannot use groups, backreferences, unbounded quantifiers, or a repetition
upper bound greater than 256. Invalid,
binary, oversized, or symlinked configuration fails without echoing configuration content.

Do not commit sensitive configured values merely to scan for them. Restrict or ignore the
consumer-owned configuration when its patterns are themselves sensitive. Prefer safe structural
patterns or non-sensitive organization terms.

Example domains (`example.com`, `example.net`, `example.org`, and reserved `.example`, `.test`,
and `.invalid` domains) and functional role labels (`Operator`, `User`, `Customer`, `Reviewer`,
and `Worker`) are deterministic allowances. They do not allow arbitrary identity-bearing data.

The checker is intentionally conservative and incomplete. Agents and reviewers remain responsible
for applying the full [PII sanitation contract](pii-sanitation.md) before the first durable write.
