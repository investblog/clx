---
title: Facts for the comparison pages
type: reference
status: current
date: 2026-10-11
---

# Facts for the comparison pages

Every claim the comparison pages (`site/compare.ts`, ADR 0018) make about another service comes from this file, and every line here
comes from that service's own pages (pricing, help, terms, policy, code), with the address and the
day it was checked. A fact we could not confirm is marked *unconfirmed* and stays off the pages.
Re-check before changing a page, and at least every six months.

clx's own figures: the pricing page (`site/products.ts`) and `docs/spec.md` §5, §8.

## clx (for the same rows)

| Fact | Value | Where |
|---|---|---|
| Price | Free; the `api` plan on request, free for now | pricing page |
| Free plan | 1 Cloudflare account, 10 sites, 200 links (10 rules each), 1 API key | pricing page |
| Visits and clicks | not limited by clx; by the user's Cloudflare quotas (Workers Free: 100,000 requests a day) | pricing page, spec §8 |
| History | daily totals and breakdowns for 400 days, hourly for 31 days | spec §5 |
| Counter | an inline snippet under 600 bytes, or a script served by the worker on the site's own domain; no cookies | spec §5, `test/snippet.test.ts` |
| Links | on the user's own domain (a zone in their Cloudflare account), QR codes, the destination can be edited | spec §6 |
| Where data lives | the user's Cloudflare account (worker + D1); clx.cx keeps totals only | spec §1 |
| Code | open source, AGPL-3.0 | repository |

## Bitly — checked 11.10.2026

Pricing: <https://bitly.com/pages/pricing> (rendered page; prices in $).

| Fact | Value | Source |
|---|---|---|
| Plans, $/month billed yearly | Free 0 · Core 10 · Growth 29 · Premium 199 · Enterprise custom | pricing |
| Billed monthly | Core annual only · Growth 35 · Premium 300 | pricing |
| Short links a month | 5 · 100 · 500 · 3,000 · custom | pricing, feature table |
| QR codes | Free 1 (per month or in total: unconfirmed) · 5/mo · 10/mo · 200/mo | pricing |
| Click data history | none · 30 days · 120 days · 1 year · 2 years | pricing |
| Changing a destination ("Redirects") | none · 5/mo · 20/mo · 110/mo | pricing |
| Custom domain | from Growth, one complimentary | pricing |
| Free plan ads | an interstitial page with a preview of the destination and an ad (Google AdSense) | support 32874287800333; bitly.com/pages/privacy |
| After a downgrade | bit.ly links keep working; links on your own domain lose SSL renewal; a complimentary domain stops when its registration expires | support 360029870551 |
| Deleting your links | links you created and shared "cannot be deleted or disabled (even if your Account is deleted)" | bitly.com/pages/privacy (April 2025) |
| Visitor data | IP and location from it, referrer, time, browser, OS, language, cookies and mobile ad IDs | privacy |
| Export | CSV on some paid plans (not Free, not Core), totals only | support 115000268051 |
| Complimentary domain | cannot be transferred to you | support 360056355631 |
| API requests a month | 1,000 · 5,000 · 25,000 · 50,000 | pricing |

## Plausible — checked 11.10.2026

Pricing: <https://plausible.io/#pricing> (`/pricing` is a 404).

| Fact | Value | Source |
|---|---|---|
| Free plan | none; a 30-day trial without a card | #pricing |
| $/month at 10k / 100k / 1M pageviews | Starter 9 / 19 / 69 · Growth 14 / 29 / 104 · Business 19 / 39 / 139 | #pricing |
| Yearly | 10 × monthly ("2 months free") | #pricing |
| Sites | Starter 1 · Growth 3 · Business 10 | #pricing |
| Retention | Starter and Growth 3 years · Business 5 years | #pricing |
| Script | "2.5KB" by Plausible; `/js/script.js` measured 2,841 bytes raw, 1,291 gzipped | plausible.io/lightweight-web-analytics; measured |
| Cookies | none; visitors by a daily hash of salt + domain + IP + UA, the salt deleted every 24 hours | plausible.io/data-policy |
| Hosting | Hetzner, Falkenstein, Germany | plausible.io/eu-hosted-web-analytics |
| Stats API | Business plan and up, 600 requests an hour | plausible.io/docs/stats-api |
| Sites API | Enterprise only | plausible.io/docs/sites-api |
| Self-hosted | Community Edition, AGPLv3; at least 2 GB RAM, Postgres + ClickHouse; no funnels, revenue goals, SSO, Sites API; releases twice a year | github.com/plausible/analytics, github.com/plausible/community-edition |
| Funnels, ecommerce revenue attribution | in the plans ("Funnels", "Ecommerce revenue attribution"; not in Community Edition) | #pricing |
| Short links | not found in the pricing or docs (not stated as "no") | — |

## clck.ru (Yandex) — checked 11.10.2026

Terms: <https://yandex.ru/legal/clck_termsofuse/>. Interface: <https://clck.ru/> and its script.

| Fact | Value | Source |
|---|---|---|
| Price, account | free, no account | terms 2.1, 1.4 |
| Statistics for the creator | none in clck.ru; it offers a UTM tag or a `clckid` parameter to count clicks in your own Yandex Metrica on the destination site | clck.ru interface script |
| Own domain, own slug | no field for either | interface script |
| Editing or deleting a link | not offered (no account to manage links) | interface script |
| QR codes | yes, through qr.yandex.ru | clck.ru |
| Redirect | `302` to `sba.yandex.ru/redirect?…` (the safe-browsing check), then the destination | live headers |
| Cookies on a click | `_yasc` and `bh` on `.clck.ru`; `yandexuid` and others on `.yandex.ru` at the check | live headers |
| Rights | Yandex may stop access or delete content without notice; the user grants Yandex a free worldwide licence to the URL, to combine with Yandex's data; "as is" | terms 4.2, 3.3, 3.1; yandex.ru/legal/rules 4.2 |
| Limits | URL up to 2,000 characters; no already-shortened links | terms 2.2 |
| API | `GET/POST https://clck.ru/--?url=…`, no key; rate limits unpublished | interface script; live call |

Not for the pages: on 11.10.2026 `sba.yandex.ru` answered 503 to requests from outside Russia, cause
unconfirmed.

## LiveInternet — checked 11.10.2026

| Fact | Value | Source |
|---|---|---|
| Price | free with a visible LiveInternet button; an invisible counter $3/month, "Аналитик" $4.95, "Профессионал" $9.95, per site | liveinternet.ru/code; liveinternet.ru/pay/?ac=price; help/faq.html |
| Stats visibility | chosen at sign-up: public (first option) or by password | liveinternet.ru/add; help/descr/private.html |
| Cookies | yes: visitors are told apart by a cookie; seen `FTID`, `VID` on `.yadro.ru`, one year, `SameSite=None` | help/faq.html; browser capture |
| Counter requests | a script that calls `counter.yadro.ru/hit` (referrer, URL, title, screen), a GIF, the logo image | liveinternet.ru/add (its own counter) |
| History | daily for 32 days, weekly for 32 weeks, monthly for 32 months | help/faq.html |
| Export, API | CSV/TSV per report table; no documented API found | stat pages; help/api.html empty |
| Countries | 64 told apart, the rest "Другие" | help/faq.html |
| State | sign-up works, stats update; latest copyright year found 2020; `/news/` leads to the home page; `/help/` answers 500 | liveinternet.ru |
| Privacy policy | none found for the counter (common addresses answer 404) | — |

## Yandex Metrica (for the Russian pages) — checked 11.10.2026

| Fact | Value | Source |
|---|---|---|
| Price | free | yandex.ru/legal/metrica_termsofuse 1.3 |
| Session recording | Webvisor records visits to the site's pages | terms 4.1.1 |
| Personal data | the site owner is the operator, Yandex processes on their behalf (152-ФЗ) | terms 5.4 |
| Data licence | free, worldwide, may be combined with Yandex's data | terms 2.6 |
| Cookies | `_ym_uid` and others, a year, plus localStorage | yandex.ru/support/metrica/general/cookie-usage.html |

## 301.st (301.ru in Russian) — the parent service, checked 11.10.2026

Not a rival: `/vs-301` says what each does. 301.ru is the same service's Russian site (its pages
name it 301.st).

| Fact | Value | Source |
|---|---|---|
| What it does | domain portfolio, bulk edge redirects (geo, UA), TDS (A/B and geo splits; Smart Shield filters by geo, device, OS or bot signals; SmartLink), attribution from "S2S postbacks from affiliate networks" | 301.st home, /features |
| Analytics | "real-time analytics" on every plan | /pricing |
| For whom | SEO webmasters, affiliate teams, media buyers, agencies | /features |
| Cloudflare | a bootstrap token (Account Settings Read + API Tokens Edit) mints scoped tokens; redirects and TDS deploy as Workers in the user's account; DNS does not move | /docs/cloudflare-integration |
| Price | free during Open Beta; Free $0, Pro $30, Business $100 a month (301.ru: 0 ₽, 2 500 ₽, 8 500 ₽) | /pricing |
| Limits by plan | domains 10 / 100 / 500; Cloudflare accounts 1 / 10 / 100; analytics retention 30 / 180 / 365 days | /pricing |
| Domains | expiry, DNS checks, VirusTotal through the user's own key | /features |

## Search demand (Ahrefs, 11.10.2026; volume US/RU, global)

| Phrase | Volume | Difficulty |
|---|---|---|
| bitly alternative / alternatives | 300 / 450 (US); 1,100 / 700 global | 2 / 1 |
| plausible alternative | 100 (US); 400 global | 18 |
| cookieless analytics | 100 (US) | 10 |
| google analytics alternative | 900 (US) | 78 |
| альтернатива clck.ru, альтернатива liveinternet, аналог яндекс метрики | no data | — |
| сократить ссылку | 15,000 (RU) | 0 |
| clck / clck.ru | 2,000 / 800 (RU) | 33 / 8 |
| liveinternet | 100 (RU) | 5 |
