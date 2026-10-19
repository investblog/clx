---
title: A new clx-edge reaches one account first, then the rest, each update confirmed by its worker
type: decision
status: accepted
date: 2026-10-19
---

# 0032. The order of a clx-edge rollout

**Context.** `clx-edge` runs in the users' own Cloudflare accounts. An update there is already safe
one account at a time (§4): the version serving before it is recorded, the worker must confirm the
new bundle (`setup_ok`), and an update whose cron or self-check fails is rolled back to that
version. But `POST /admin/edge/rollout` with no list starts every account at once, so a bundle that
breaks on real accounts — and not on the test one — would be rolled back everywhere at the same
time, with every user's counting and links in the balance. The owner asked (19.10.2026) for one
agreed way to roll out, so that new worker features can be added without anything going down.

## Decision

- **One way: `scripts/rollout.mjs`**, after `pnpm run deploy`, as an admin (`node scripts/user.mjs
  admin probe@clx.cx on` before it, `off` after it):
  1. `GET /admin/edge/bundle-info` — what clx.cx serves is the committed bundle, and released;
  2. a dry run — which accounts would be updated, from which bundle;
  3. **one account first** (the oldest). Its update must end `done` with the account `ready` on
     the new bundle, or the rollout stops there and the others stay as they are;
  4. then the other accounts, each confirmed the same way. A stage that starts fewer accounts than
     it names fails.
- **A new feature of the worker** goes this way: the receiver takes the body version of the current
  and the previous release (§4), so accounts not yet updated keep working while the rollout runs.
- An account with no connection is not updated (its update would wait for a `setup_ok` that does not
  come); its user reinstalls it.

## Not done

- A test account as the first stage: the stage 3 probe (`scripts/probe-install.mjs`) already
  checks an update on a test account, and needs its own connect and disconnect — it is run when the
  update path itself changes, not for every bundle.
