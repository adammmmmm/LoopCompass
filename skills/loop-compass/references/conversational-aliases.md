# Conversational incident aliases

Canonical incident slugs remain the only durable identity. A coordinator may introduce a short
presentation alias such as `LC-1` to make a current conversation easier to follow, but the alias
is local to that conversation and is never incident state.

## Safe use

- Introduce the alias and canonical slug together: `LC-1
  (deploy-token-lacks-required-permission)`.
- Keep that mapping stable within the current conversation.
- Reintroduce the canonical slug after context compaction, when participants change, or whenever
  the mapping could be ambiguous.
- Require the canonical slug for Git, pull requests, tasks, artifacts, receipts, durable
  projections, and every cross-session reference.
- Treat an alias-only reference outside its established conversation as unresolved. Ask for the
  canonical slug; never guess.
- When several coordinators allocate aliases in one conversation, they may use local namespaces
  such as `LC-B1` and `LC-G1`. A namespace prevents conversational collisions but does not make an
  alias durable.

An alias must not appear as an identity field in an incident, recovery, receipt, projection, or
other persisted schema. Durable prose may quote an earlier conversation when necessary, but it
must identify the incident by canonical slug and must not rely on the quoted alias as a join key.

## Human presentation

For an incident needing human action, present the alias plus canonical slug, requested action,
recommendation, action blast radius, consequence of inaction, and a verification promise from the
coordinator. Optional conversational requests such as `LC-1 breakdown` or `LC-1 simple` are valid
only while the mapping is established and unambiguous in the current conversation.
