# PII sanitation

LoopCompass artifacts and handoff receipts are normally committed or copied into durable project
state. Sanitize them before the first write. Deleting a file later does not remove it from Git
history.

## Order of operations

Sanitation is a mandatory pre-persistence transform, not a cleanup pass:

1. Reduce the source material in memory to the minimum evidence needed for classification.
2. Replace unnecessary identities with functional roles and remove or generalize sensitive data.
3. Review every value that could become durable, including prose, commands, evidence, frontmatter,
   filenames, terminal receipts, human-attention projections, obligation markers,
   known-obligation registries, and diagnostics. Sanitize `requested_action` prose before it enters
   either a projection or marker; the registry keeps only the already-sanitized canonical slug and
   the minimum pending-action metadata required for first-write crash recovery.
4. Only then normalize the failure signature and derive its dedupe key, artifact ID, or filename.
5. Search for an exact sanitized signature in both LoopCompass directories immediately before
   writing. Update the matching artifact instead of creating a duplicate.
6. Persist only the sanitized artifact, receipt, projection, or `no_artifact` explanation.

Never derive an ID from sensitive text and then sanitize only the body. Slugs, filenames, receipt
keys, and diagnostic messages can disclose the source material too.

## What to remove or generalize

Preserve mechanism-level evidence, not identity:

- Replace personal names, emails, handles, and other identities with roles such as `Operator`,
  `User`, `Customer`, `Reviewer`, or `Worker`.
- Replace personal home-directory usernames and private absolute paths with functional roots such
  as `<project-root>` or `<user-home>`.
- Replace customer, tenant, account, and private organization identifiers with functional labels.
- Remove secrets, tokens, credential-bearing URLs, borrowed credentials, private payloads, and raw
  logs. Retain only a short description of the relevant behavior.
- Sanitize command arguments, environment assignments, quoted output, stack traces, and evidence
  references as carefully as narrative prose.
- Keep diagnostics non-sensitive: name the field, category, or file that needs attention without
  printing the matched value.

If a draft still contains a private payload or raw log, reject it for persistence and replace it
with the minimum sanitized behavioral evidence.

If identity-specific evidence is essential, keep it in an authorized restricted system and refer
from LoopCompass only to a non-sensitive record ID. LoopCompass does not define or operate that
restricted store.

## Preserve useful evidence

Sanitation must leave enough information to distinguish and verify the mechanism:

- Keep the tool and command family, but generalize identity-bearing arguments and paths.
- Keep the stable error class and behavior, but summarize private payloads and raw logs.
- Keep capability requirements and lifecycle roles, but omit the identity of the person filling a
  role.
- Keep the verification gate, environment class, and relevant version range when they are safe.

Do not use a reversible encoding, partial token, email prefix, home-directory basename, or
identity-derived nickname as a substitute for removal.

## Deterministic identity and collisions

Two distinct source events can become the same sanitized signature. This is expected.

1. When the exact sanitized signature matches an existing recovery or incident, treat it as the
   same artifact identity and update or supersede according to the normal lifecycle.
2. When different sanitized signatures produce the same slug, use the normal deterministic
   collision rule: append the lowest available integer suffix beginning with `-2`.
3. Do not reintroduce a person, customer, organization, account, or private-path fragment to make a
   slug unique.
4. Preserve simultaneous writes as a visible file or Git conflict; do not invent
   identity-derived filenames to avoid the conflict.

Sanitation can intentionally merge evidence that differs only by identity. If that would erase a
mechanism-level distinction, preserve a safe technical discriminator such as tool, operation,
environment class, or error class - never the private identity.

## Limits

Automated checks are defense in depth, not proof that state contains no PII or secrets. Agents and
reviewers remain responsible for minimizing and sanitizing content before its first durable write.
This contract does not require Git-history rewriting, a scanner daemon or hook, a comprehensive
privacy certification, or storage of restricted identity evidence in LoopCompass.

The shipped, explicitly invoked [redaction audit](redaction-audit.md) can flag conservative
categories in committed state. It is non-mutating and cannot repair a missed pre-persistence
sanitation obligation.
