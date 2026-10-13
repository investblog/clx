---
title: A clx-edge that clx made and lost track of is taken back
type: decision
status: accepted
date: 2026-10-13
---

# 0028. A clx-edge that clx made and lost track of is taken back

**Context.** A user's install uploaded `clx-edge` (`200`), then read its deployments and got
`404 10007`: a new script can read as absent for a moment (`docs/cloudflare-facts.md`, 13.10.2026).
The install failed on that read; the undo read the script, found nothing either, deleted nothing
and cleared the mark that the script is clx's. The script stayed. The user pressed install again,
and the install stopped with `name_taken` — "a worker clx did not put there" — on clx's own code.
The way out was to delete the worker in the dashboard by hand. A disconnect that cannot delete the
script (it names it in `left`) leaves the same state behind.

**Decision.**

- After an accepted upload, a `404` on the version read does not fail the step: the version is
  only recorded, and the install goes on without it.
- The operation records `script_put` once Cloudflare accepts its upload. The undo of such a run
  does not believe a `404` on the script before the self-check: it keeps the mark and warns
  `worker_not_undone`. A reinstall then takes the script over; a disconnect deletes it once it reads, and names it in
  `left` while it does not.
- A disconnect does not believe a `404` on a marked script within the self-check's time (15
  minutes) after an accepted upload: it names the worker in `left` instead. It does not delete it
  unread — the mark is on the name, and the name may hold someone else's script by then. Later, a
  `404` means the script is gone.
- An install that finds `clx-edge` without the mark takes it back when both hold: its code is a
  clx bundle (`edge/released.json`), and the operations log has an install of clx whose upload of
  a new script in this Cloudflare account was accepted (`script_created` and `script_put`) —
  `script_created` alone is set before the upload is tried, so it proves nothing. Anything else is
  `name_taken`, as before.

**Consequences.** A user who hits the lag, or a disconnect that could not clean up, reinstalls with
one press. The log is not filtered by user: a worker another clx.cx user's install left in the same
account was uploaded by this clx.cx too, and its record is gone (`edge_accounts.cf_account_id` is
unique, so no live install is taken over). A self-hosted clx that put the same bundle there has no
entry in this clx's log, so its worker stays alone; so does a released bundle someone uploads by
hand where clx never had an upload accepted. One that someone uploads by hand where clx had one is
taken over — the same code is put back. Operations logged before `script_put` existed carry no proof;
the one user account the lag hit was given it by hand, from `cf_calls` showing the accepted upload.
Rejected: taking back any clx bundle (it may be another clx deployment's), and retrying the reads
until the script shows (how long the lag lasts is not known; the steps already resume).
