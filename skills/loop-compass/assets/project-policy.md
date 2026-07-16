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

Finish every triggered classification in the same turn with exactly one reviewable outcome:
create or update a recovery at the appropriate lifecycle status, create or update an incident,
report `no artifact` with a short reason, or return the proposed artifact with the exact missing
permission, capability, or operator action. Candidate recoveries are ineligible for use until
verified. Persistence is automatic within current repository authority. Explicit read-only
instructions, safety boundaries, and missing write permission override automatic writes, but they
require the same-turn proposed artifact and escalation rather than silent omission.

Delegated agents with shared repository write authority follow the same rule directly. Brief-only
or read-only workers must return the normalized signature, classification, minimal evidence,
proposed artifact when applicable, and exact permission or operator escalation to the parent. The
parent must persist, record `no artifact`, or escalate in the same turn.

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
