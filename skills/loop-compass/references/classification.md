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

Escalate by required capability rather than agent brand or title. Useful capability labels include:

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

Create no durable artifact when:

- another actor performed the blocked action;
- a retry happened to succeed without a causal explanation;
- the workaround violates the intended permission or execution model;
- the detail is unlikely to recur outside the current task;
- evidence cannot distinguish the proposed recovery from correlation.

## Promotion rule

An incident may become a recovery only when later evidence proves that the supposed workaround is
the correct standard operating path. Reclassify explicitly and remove the incident after the new
recovery is verified.

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
