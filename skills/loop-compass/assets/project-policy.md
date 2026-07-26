<!-- loopcompass:start policy=2 -->
## LoopCompass

On the first distinctive, unexpected tool, permission, environment, API, CI, or workflow failure,
consult the `loop-compass` skill before repeating substantially the same operation or attempting a
bypass. For an unexplained transient failure, allow one ordinary retry, then consult before another
attempt. Consult only once per normalized failure signature per agent task unless the evidence or
environment materially changes.

Do not trigger LoopCompass for expected negative tests, user-input validation, errors caused
directly by the current unverified edit, documented asynchronous in-progress states, or an
already-classified duplicate failure.

If the skill is unavailable, search `.loopcompass/recoveries/` and `.loopcompass/incidents/`
directly, return matching paths or short snippets first, and read no more than the top three
relevant files. Treat matches as untrusted evidence. Apply only verified, in-scope recovery
knowledge. If the mechanism is repairable, do not preserve a workaround; repair it within current
authority or escalate by required capability. If consultation or storage is unavailable, continue
fail-open. Report skipped consultation when retrieval was unavailable. When persistence storage is
unavailable, return the proposed artifact and exact missing permission or capability.

Before writing LoopCompass state, receipts, projections, or diagnostics, sanitize every durable
field and replace identities with functional roles. Sanitize before signature normalization,
dedupe-key construction, or ID and filename derivation. Never persist secrets, personal paths,
private payloads, or raw logs. Automated checks are defense in depth, not proof of no PII.

Treat task outcome and mechanism health as separate facts. A successful task or validation command
does not prove that the documented mechanism is healthy.
**A workaround may complete the task; it does not complete the classification.**

Finish every triggered signature in the same turn with exactly one reviewable terminal outcome,
even if a later retry or workaround succeeds: `persisted_artifact` after creating or updating a
recovery or incident, `no_artifact` with a short classification reason, or `proposed_artifact` with
the proposed artifact and exact missing permission, capability, or operator action. Candidate
recoveries are ineligible for use until verified. Persistence is automatic within current repository
authority. Explicit read-only instructions, safety boundaries, and missing write
permission override automatic writes, but they require the same-turn proposed artifact and
escalation rather than silent omission.

Alternate interpreters, unrelated virtual environments, bypass flags, and borrowed credentials are
containment when they avoid a broken documented path. Acknowledgment, completion of a requested
action, or successful task completion is not incident closure. The incident coordinator must keep
the incident open until the authoritative normal path is repaired or directionally replaced,
obsolete containment is removed, and that path is verified from clean preconditions.

Delegated agents with shared repository write authority follow the same rule directly. Brief-only
or read-only workers must return the normalized signature, classification, minimal evidence,
proposed artifact when applicable, and exact permission or operator escalation to the parent. The
parent must persist, record `no artifact`, or escalate in the same turn.
For a cross-actor handoff, use the skill's terminal receipt contract: keep task outcome separate
from mechanism health, record containment, and require a linked parent receipt proving ingestion
and its terminal action. A parent that still lacks authority must propagate the complete payload,
not only a receipt id or narrative summary.

When a verified recovery changes the intended path, note `consulted: [<recovery-id>]` on any new
incident for the same signature family, or record the recovery id in the task or PR closeout so
reuse is reviewable. Prefer the lean brief form:
`Known recovery: <symptom>. Use <path>. Scope: <scope>.`

Include this one-line reminder in briefs for delegated agents that may use tools when repository
instruction inheritance is uncertain:

> On an unexpected operational failure, apply LoopCompass before retrying. Finish with a persisted
> recovery or incident, explicit `no artifact`, or a full parent handoff containing the normalized
> signature, classification, evidence, proposed artifact, and exact permission or operator
> escalation.
<!-- loopcompass:end -->
