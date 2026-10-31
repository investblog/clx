---
title: MASTER_KEYS rotation through a second secret
type: decision
status: accepted
date: 2026-11-01
---

# 0038. MASTER_KEYS rotation through a second secret

**Context.** The users' working tokens are sealed with the `MASTER_KEYS` keyring (spec §3 item 5):
the first key seals, any key of the ring opens by the id stored with the ciphertext. The spec said
"rotation — add a new key, re-encrypt in the background, then remove the old key". But the ring is
a Worker secret, made by `scripts/secrets.mjs` and never kept anywhere else, and Cloudflare never
returns a secret's value. A new key cannot be written in front of the old one inside `MASTER_KEYS`
without knowing the old one.

**Decision.** A rotation goes through a second secret, `MASTER_KEYS_NEXT`, which the Worker puts in
front of `MASTER_KEYS` (`keyring()` in `src/lib/crypto.ts`). `scripts/rekey.mjs`:

1. `start` makes the new key — its id has a random part, since the current key's id is not known
   outside the Worker — keeps it in `.secrets/master-keys-next.txt` before anything else
   (a key the Worker seals with must never exist only in Cloudflare; a rerun puts the kept key
   again, never a new one) and puts it as `MASTER_KEYS_NEXT`. New tokens are sealed with it.
2. The minute cron re-seals the stored ciphertexts — the token in use and a renewal's new one —
   about 20 a minute (`src/cf/rekey.ts`). Each write is a compare-and-swap on the ciphertext read,
   so a connect or a renewal that changes the row meanwhile wins and the row is taken again next
   minute. A ciphertext that cannot be opened (or is broken) is left as it was and logged; the batch
   is drawn in random order, so such rows never hold it.
3. `status` counts ciphertexts by key from the live D1. `finish` drops the old key only when the
   Worker from before `start` can no longer write with it: a request it was serving may still seal
   a token after any census. So `finish` waits 30 minutes from `start` (the kept file holds the
   time), clears every lease past its time and refuses while any is live — every write of a
   ciphertext in `src/cf/connect.ts` is made under one, 2 minutes long and renewed by its owner even
   after its time, so a cleared one can no longer be renewed or written under — and refuses while
   any ciphertext names another key, a broken one included. Then it puts the new key as `MASTER_KEYS`, deletes
   `MASTER_KEYS_NEXT` and the kept file.

A ring may not name two keys by one id (the same key twice is allowed: the ring is that for a
moment while `finish` runs). The `key_id` column now comes from the ciphertext it describes (a renewal's swap took the ring's
first id before, whatever key had sealed `next_sealed`).

**Consequences.** A rotation needs no downtime and no knowledge of the old key. Until `finish`, the
new key lives in two places (the Worker and the kept file on the operator's machine); after it the
old key is gone for good — a backup of D1 `clx` older than the rotation can no longer be opened by
the Worker's keys. What is left is a request from before `start` that runs past the 30 minutes without a
lease and only then takes one — a connect or a renewal takes its lease first.
