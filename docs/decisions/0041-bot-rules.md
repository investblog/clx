---
title: Link rules by bot category — a redirect for bots of the listed categories, behind a worker-version check
type: decision
status: accepted
date: 2026-11-06
---

# 0041. Link rules by bot category

**Context.** A link's rule had two conditions, country and device (§6). A bot went along those
rules like a person and was only counted apart, by category (§5, `edge/bots.ts`). The owner asked
for rules by bot category, so a bot of a chosen kind can be sent to an address of its own. For
example, link previews can go to a page with their own Open Graph tags, search engines to the
canonical page, and monitoring to a light page.

**Decision.**
- **A third condition, `bots`**: a non-empty list of the categories of `edge/bots.ts` (`search`,
  `ai_training`, `monitoring`, `ad_review`, `social_preview`, `headless`, `other`), matched by
  User-Agent as the counting already does. A rule needs at least one of `countries`, `devices`,
  `bots`. Conditions combine: `{bots: ['ai_training'], countries: ['AT']}` takes an AI crawler from
  Austria only.
- **Only a redirect, to the rule's `url`.** There is no block and no 404 for bots. A rule keeps its
  one shape, and the report, the editor and the worker have nothing new to tell apart.
- **A rule with `bots` never takes a browser; a rule without it takes bots, as before.** Links
  that already work keep their behaviour. The first match wins, so a rule for bots goes above the
  others. The editor's hint says so.
- **All seven categories, `ad_review` included.** The owner decided this on 06.11.2026, and the risk
  was named before the choice: sending ad reviewers somewhere other than people is cloaking. Google
  Ads, Meta and TikTok ban ad accounts for it, and the link's domain can land on block lists. The
  category also holds link-preview fetchers (`facebookexternalhit`, `LinkedInBot`, `PinterestBot`),
  for which a page of their own is an ordinary use.
- **The old worker.** `destination()` of an older `clx-edge` treats a missing condition as a match.
  It would read `{bots: [...], url}` as a rule with no conditions and send **every visitor** to it.
  So a rule with `bots` goes only to an account whose confirmed `edge_accounts.bundle` is the
  release that knows it, or a later one. `BOTS_SINCE = 12` is its index in `edge/released.json`,
  the same check as external sites (`servesSince`, ADR 0037). Otherwise `POST`/`PATCH /v1/links`
  answer `409 update_required`, and the update comes first. That is the check the user sees. The
  safety itself is in the config's shape (`linkConfigOf`). A link's `rules` in the worker's config
  never holds a rule with `bots`. The whole ordered list goes in a new field, `all`, only when some
  rule has `bots`, and only a worker that knows `bots` reads it. An older worker, however it got
  there, reads `rules` alone and can only miss the rules for bots: its bots go along the other rules,
  as they always did there. A gate by `edge_accounts.bundle` in the sync was tried first and is not
  enough (Codex 06.11). That field is the bundle clx confirmed, not the one running, and a version
  taken back in the Cloudflare dashboard reads the stored config at once, with no new revision.
  The config of a link without such a rule is byte for byte what it was.
- **Order in the editor.** A rule row has a "Move up" button. A rule for bots added to a link
  that has rules lands at the end, where a rule without `bots` would take its bots first (Codex
  06.11).
- **Counting is unchanged.** A bot's click counts as a bot by category and records no destination.
  So a rule with `bots` never appears in "Where the clicks went". The UI skips it when numbering
  today's rules (`ruleOf` in `edge/contract.ts`): `{bots, countries: [DE]}` and `{countries: [DE]}`
  share the key `DE;>url`, and the clicks behind it are the second one's. `destinationOf` and
  `parseDestination` stay as they were, and so do the keys already recorded.

**Consequences.**
- A bot is told by its User-Agent alone. One that poses as a browser goes where a person goes, the
  same as in counting. The rule is a convenience, not a defence.
- An account still on an older bundle sees `update_required` when it saves a bot rule. The UI text
  for that code is now general, no longer about external sites only.
