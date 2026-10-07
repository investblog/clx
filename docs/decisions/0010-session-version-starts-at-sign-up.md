---
title: A new user's session version starts at the sign-up time
type: decision
status: accepted
date: 2026-10-07
---

# 0010. A new user's session version starts at the sign-up time

**Context.** Refresh sessions (KV) and access tokens carry the user's id and session version
(`users.session_version`, which a reset bumps). `users.id` is an `INTEGER PRIMARY KEY` without
`AUTOINCREMENT`, so SQLite hands the highest freed id out again. A deleted user's sessions are not
removed one by one (the KV has no index by user), and every user started at version 0: a session
of a deleted user opened the next user who got the same id (found by the Codex review, 07.10).

**Decision.** A new user starts at the sign-up time in milliseconds as the session version —
`src/auth/signup.ts`, `scripts/user.mjs add`, `scripts/seed-local.mjs`. A deleted user's sessions
carry a small version (0 plus the resets), which never equals a later millisecond time. Any new way
of making a user must set it too.

**Alternatives.** `AUTOINCREMENT` — needs rebuilding `users` and every table that references it in
D1. Deleting the user's KV sessions on account deletion — needs an index of sessions by user, and
still leaves the access tokens (15 min). A random start — works the same, but a time is readable.

**Consequences.** Existing users keep their version (0 or a few); only rows made after this change
start high. A reset still adds 1.
