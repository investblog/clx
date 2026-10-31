---
title: A page restored from the back-forward cache is counted
type: decision
status: accepted
date: 2026-11-01
---

# 0039. A page restored from the back-forward cache is counted

**Context.** The snippet sends on load and on an SPA address change. A page the browser restores
from its back-forward cache (Back after following a link) runs neither, so that view went
uncounted (Codex, 30.10). A `pageshow` listener with `persisted` counts it, but every site's
snippet then gets new bytes — and §5 promised the bytes change only on `rotate`.

**Decision** (owner, 01.11.2026). The snippet counts such a page: on `pageshow` with `persisted` it
sends what an SPA address change sends — an empty body for a zone site (the page comes from the
request's `Referer`), the path for an external site. Zone and external sites alike. The bytes of
every snippet change once:

- an embedded snippet keeps working as it was — it just does not count restored pages;
- the served script (`<script src=…>`) follows by itself. A sync records, in each site row it
  wrote, the snippet code (`SNIPPET_REV` in `src/snippet.ts`) and the config revision it wrote
  (`sites.snippet_rev`, `written_rev`, migration 0021). The minute cron moves every synced site
  whose record does not match to a new config revision, 20 accounts a minute, and the next sync
  writes its new script. That covers every site at this change, and also a site an older Worker
  synced afterwards — a request finishing just after a deploy, or a rollback — since such a sync
  leaves no record. No new clx-edge bundle is needed: the worker serves the script from its config. Browsers and caches may
  keep the old script for up to a day (`max-age=86400`) — it still counts, only not restored pages.

§5 now says the bytes change on `rotate` or when clx changes every snippet's code, and names this
change. The largest zone snippet grew from 336 to 413 bytes — still under 600.

**Consequences.** Restored pages are views, as most counters count them. A future change of every
snippet raises `SNIPPET_REV`, with an ADR of its own.
