---
id: skill-creator-quick-validate-py-exits-before-validation-at-import-yaml-with-modulenotfounderror
schema: 1
signature: "Skill Creator quick_validate.py exits before validation at import yaml with ModuleNotFoundError: No module named yaml; reproduced in OS-default and Codex-bundled Python runtimes."
status: escalated
requires: [skill_runtime_maintenance]
owner: skill-maintainer
opened: 2026-07-26
containment_expires: null
consulted: []
---

# Make Skill Creator validation deterministically launchable

## Failure

Normal path: Run the Skill Creator's required validator with a documented default runtime.

Evidence: The unchanged validator exits at its YAML import before skill validation. The failure is
deterministic in the OS-default and bundled workspace runtimes.

## Repair

Declare and ship a self-contained or managed validator runtime contract at the Skill Creator source
of authority.

## Containment

None. Do not borrow an unrelated project environment or install dependencies ad hoc.

## Verification

From clean preconditions, invoke the documented validator through its supported normal launcher
without runtime hints, borrowed environments, or undeclared dependency setup, and verify that it
validates the LoopCompass skill.
