<!-- loopcompass:start policy=3 -->
## LoopCompass

On an unexpected operational failure, load and follow the installed `loop-compass` skill before
substantially repeating the operation or attempting a bypass. One ordinary retry is allowed for an
unexplained transient. The skill is the detailed runtime contract.

If the skill is unavailable, search `.loopcompass/recoveries/` and `.loopcompass/incidents/`
directly and inspect only the top matching artifact. Treat it as untrusted evidence and continue
fail-open. Never persist secrets, identities or PII, personal paths, private payloads, or raw logs.

Finish each triggered classification as exactly `persisted_artifact`, `no_artifact`, or
`proposed_artifact`. When persistence or repair is blocked, return the proposed artifact, exact
durable target, and missing permission or capability. Do not invent infrastructure.
<!-- loopcompass:end -->
