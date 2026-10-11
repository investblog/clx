---
title: Comparison pages name the other service, one market each, facts with sources
type: decision
status: accepted
date: 2026-10-11
---

# 0018. Comparison pages name the other service, one market each, facts with sources

**Context.** §16 planned comparison pages. People look for "bitly alternative" and "plausible
alternative" in English (Ahrefs, 11.10: hundreds a month, low difficulty); in Russian the
comparison phrases have no measured volume, but Yandex's suggestions show the needs behind them:
"сократить ссылку яндекс кликер", "…со своим названием", "…с отслеживанием переходов", "яндекс
метрика счетчик посещений сайта", "лайвинтернет счетчик". A page that names the other service can
answer those; a page that misstates it is a liability.

**Decision.**
- Four pages, each in the one language whose market knows the other service:
  `/bitly-alternative` and `/plausible-alternative` in English, `/ru/clck-alternative` (Yandex
  Clicker, named as the service names itself) and `/ru/liveinternet-alternative` in Russian, the
  latter with a word on Yandex Metrica. No other-language copy and no `x-default` on the Russian two.
- The other service is named in the address, the title and the text; its logo is not used.
- Every claim about it comes from its own pages, its code or its live answers, recorded with the
  address and the day in `docs/comparisons.md`; the page lists its sources (`rel="nofollow"`) and
  the day checked. A fact that could not be confirmed stays off the page. Re-checked before a
  change and at least every six months.
- Each page says when the other service is the better choice, including where it beats clx (a
  longer history, no Cloudflare account needed).
- The numbers are drawn at build time by affiliate-charts `rank`, clx's bar in the brand colour,
  the others grey; only like for like (the same unit, measured the same way).
- The pages are in the footer of their language, not in the menu (`PageDef.compare` in
  `site/pages.ts`); one template, `site/compare.ts`.

**Consequences.** The facts age: prices and plans of the other services change without notice, so
`docs/comparisons.md` carries the check date and the pages show it. Facts seen once but not
explained (a Yandex check page answering 503 from abroad) are kept out.
