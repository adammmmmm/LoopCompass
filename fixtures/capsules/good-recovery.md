---
id: sandbox-package-cache-outside-writable-root
schema: 1
signature: "sandbox package cache outside writable root"
scope:
  os: linux
  shell: bash
  tool: package-manager
  versions: unknown
status: verified
first_seen: 2026-07-02
last_verified: 2026-07-02
expires_after_days: 180
supersedes: null
---

# Redirect the package cache inside the sandbox writable area

## Symptom

In a sandboxed workspace-write job, the default package cache under the home directory is outside
the writable root and blocks an otherwise valid dependency or test run.

## Recovery

Set the package manager cache directory to a path inside the sandbox writable area before install.
Do not use the redirect to mask a resolver failure.

## Verification

Dependency install and unit tests completed green after redirecting the cache inside the writable
root on the same host class.

## Limits

Only when the sandbox cannot write the normal cache location. Not required for a normal trusted
checkout.
