# Failure classification

Use the first matching branch.

## 1. Is the successful path actually the standard path?

Choose a recovery when the behavior is a correct invocation, documented or verified tool contract,
or legitimate external constraint. Examples include polling an asynchronous process session or
running a required generator before a generated-code check.

The recovery must be more useful than current project documentation and narrow enough to avoid
misapplication.

## 2. Is a mechanism within reach broken?

Choose an incident when configuration, permissions, wrappers, scripts, workflows, or infrastructure
should be changed so the original path works normally.

Determine mechanism health independently of whether the current task eventually succeeded. When an
alternate interpreter, unrelated virtual environment, bypass flag, or borrowed credential avoids
the failure, record it only as bounded containment. Preserve the incident until the documented
normal path is repaired and verified.

**A workaround may complete the task; it does not complete the classification.**

Escalate to the nearest actor with the required capability rather than by agent brand or title.
That actor may be an agent, service, team, or human. Useful capability labels include:

- `repository_write`
- `git_metadata_write`
- `user_config_write`
- `global_config_write`
- `credential_access`
- `network_access`
- `process_control`
- `operator_approval`

## 3. Is an external repair pending?

Choose an external incident when the defect is outside the repository's current authority. Any
containment must have an owner, an expiry, and a normal-path verification plan. Expiry invalidates
containment; it never closes the incident.

## 4. Is this merely a bypass or coincidence?

Report `no artifact` with a short classification reason when:

- another actor performed the blocked action;
- a retry happened to succeed without a causal explanation;
- the proposed knowledge is only a workaround that violates the intended permission or execution
  model, and no repair or coordination record needs to survive;
- the detail is unlikely to recur outside the current task;
- evidence cannot distinguish the proposed recovery from correlation.
- a repairable mechanism was repaired and its normal path verified within the current exchange, so
  no coordination record needs to survive.

`no_artifact` rejects the proposed durable knowledge; it does not erase a separate incident
obligation for a documented normal path that remains broken.

## Promotion rule

An incident may become a recovery only when later evidence proves that the supposed workaround is
the correct standard operating path. Reclassify explicitly and remove the incident after the new
recovery is verified.

## Coordination and closure

Under state schema 1, incident `owner` means the coordinator responsible for escalation, lifecycle
state, verification, and closure. The actor who performs or decides the required action may be
different, and neither role implies a human.

Acknowledgment, completion of the requested action, and task success are not closure. The
coordinator removes containment, verifies the authoritative normal path from clean preconditions,
and only then closes the incident.

A directional resolution is valid when the intended normal path deliberately changes. The source
of authority must record the replacement path, obsolete containment must be removed, and the
replacement must be verified. A decision or acknowledgment without those three results leaves the
incident open.

Every triggered signature ends as `persisted_artifact`, `no_artifact`, or `proposed_artifact`,
including when a retry or containment succeeds after the trigger.

## Incident status cheat-sheet

| Status | Meaning |
| --- | --- |
| `detected` | Defect confirmed; repair not finished |
| `escalated` | Waiting on a parent or capability |
| `repairing` | Fix in progress at source of authority |
| `blocked` | Cannot proceed without operator or external input (still open) |
| `verified` | Normal path proven; **delete** the live incident file |

Containment is metadata, not a status. `containment_expires` past today on an open incident is
invalid: renew, clear containment, or close after verification.
