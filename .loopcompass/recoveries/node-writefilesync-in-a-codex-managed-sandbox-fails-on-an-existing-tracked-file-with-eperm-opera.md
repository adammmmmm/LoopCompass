---
id: node-writefilesync-in-a-codex-managed-sandbox-fails-on-an-existing-tracked-file-with-eperm-opera
schema: 1
signature: "Node writeFileSync in a Codex managed sandbox fails on an existing tracked file with EPERM: operation not permitted"
scope:
  os: windows
  shell: powershell
  tool: node
  versions: "22.15.0; Codex managed sandbox"
status: verified
first_seen: 2026-07-16
last_verified: 2026-07-16
expires_after_days: 90
supersedes: null
---

# Escalate the exact Node generator or verification command

## Symptom

A Node generator or test using `writeFileSync` can read an existing tracked file in a linked task
worktree but fails to open it for writing with `EPERM: operation not permitted`, even though the
file is not read-only and its ACL grants the sandbox identity modify access.

## Recovery

Request managed-sandbox escalation for the exact Node generator or verification command. Keep the
approval prefix limited to the project script when a reusable rule is appropriate. Do not rewrite
ACLs, copy the tracked file elsewhere, or replace the script with an ad hoc writer.

## Verification

On 2026-07-16, `node scripts/release.mjs generate` failed with the normalized signature inside the
managed sandbox. The same command completed under exact-command escalation and wrote the expected
LoopCompass v0.3.0 manifest. The full escalated `node scripts/verify.mjs` gate then passed 47 tests,
release inventory validation, and the example redaction check.

## Limits

Use only after confirming the intended worktree is writable and the failure comes from the managed
sandbox boundary. This does not apply to application defects, malformed paths, genuinely read-only
files, antivirus locks, or arbitrary Node commands. Preserve explicit read-only and safety rules.
