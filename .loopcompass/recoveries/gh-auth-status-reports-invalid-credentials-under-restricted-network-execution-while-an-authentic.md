---
id: gh-auth-status-reports-invalid-credentials-under-restricted-network-execution-while-an-authentic
schema: 1
signature: "gh auth status reports invalid credentials under restricted network execution while an authenticated api probe succeeds with supported network access"
scope:
  os: any
  shell: any
  tool: gh
  versions: unknown
status: verified
first_seen: 2026-07-26
last_verified: 2026-07-26
expires_after_days: 180
supersedes: null
---

# Separate network reachability from GitHub credential validity

## Symptom

`gh auth status --active` reports invalid credentials inside restricted execution, while an
authenticated read-only API probe initially fails because the network is unavailable.

## Recovery

Do not recommend login, token rotation, or credential replacement from the restricted-context
status result alone. Re-run one authenticated, non-mutating probe such as
`gh api user --jq .login` with supported network access. Treat network reachability, credential
validity, and Git commit identity as three independent facts.

## Verification

The authenticated API probe failed with a connection error under restricted execution and
succeeded immediately when rerun with approved network access, returning the expected account.
No credential change was required.

## Limits

This recovery applies only when restricted execution can explain the failed probe. If the same
authenticated probe reaches GitHub with supported network access and returns an authentication
error, investigate credentials normally. A successful GitHub probe does not verify Git author or
committer configuration.
