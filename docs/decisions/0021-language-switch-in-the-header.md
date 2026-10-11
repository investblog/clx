---
title: The language switch is in the header, the app's too; the profile has none
type: decision
status: accepted
date: 2026-10-11
---

# 0021. The language switch is in the header, the app's too; the profile has none

Supersedes, in part, [ADR 0015](./0015-app-language.md) (where the account's language is changed)
and [ADR 0017](./0017-app-in-the-site-frame.md) (no language switch in the app's header).

**Context.** The app's header had no language switch: a signed-in person changed the language in a
select on the profile page, and the signed-out pages carried the other language as a link under
each form, beside a link to the page itself. The site's header had a bare "Русский" / "English"
link. The owner: the switch belongs in the panel, and it should look as on the owner's other
projects — a flag, as spintax.net has it.

**Decision.**
- One switch for the site and the app, in the header (`site/layout.ts`): the current language's flag
  and code in a pill, a menu of the languages with their flags (spintax.net's `lang-dd`; flags from
  `country-flag-icons`, 3x2, English by the British one). A `<details>`, so it opens without
  scripts; `/theme.js` closes it on a click elsewhere and on Escape.
- On a page of the site it links the page in its languages; a page of one language has none. In
  the app it links `/app` and `/ru/app`; `ui/main.ts` keeps the page (the hash) and, signed in,
  saves the account's language first (`PATCH /v1/me {locale}`) — the account's language wins over
  the address's, so the app would otherwise come straight back.
- The profile page has no language field. The account's language still sets the e-mails'.
- Under the signed-out forms: only the sister pages — sign-in, sign-up, reset — not the page itself
  and not the other language.

**Consequences.** A signed-in switch is a write (one `PATCH`); if it fails, the app stays and says
why. The e-mails follow the language last picked in the header.
