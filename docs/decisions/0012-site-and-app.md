---
title: A site at the root, the app at /app; English and Russian
type: decision
status: accepted
date: 2026-10-10
---

# 0012. A site at the root, the app at /app; English and Russian

**Context.** clx.cx served only the app: `index.html` at `/` with the hash-routed pages, everything
`noindex`, Russian only, and three Russian legal pages. A product needs public pages that search
engines and agents can read, in more than one language, and the owner chose to model the service on
a sibling project, catchall.in.

**Decision.**
- The app moves to `/app` (`/app#/…`); `/` and the other public paths are the site. E-mails link to
  `/app#/…`; links sent before (`/#/confirm`, `/#/reset`, `/#/accounts/…`) are sent on by the home
  page's script, since the fragment never reaches the server.
- The site is generated at build time from one table of pages and languages (`site/pages.ts`) by a
  small generator of TypeScript template functions (`site/build.ts`, run by node) — no framework.
  canonical, hreflang, the sitemap, the footer and the language links all derive from that table;
  `scripts/check-site.mjs` fails the build when a page of the table has no file or a file has an
  inline script or style.
- English at the root, Russian under `/ru` (`/ru` itself has no trailing slash: static assets use
  `drop-trailing-slash`). The language comes from the address only — no cookie, no Accept-Language.
  A missing string fails `tsc`; nothing falls back to English silently.
- The app and the e-mails get English and Russian too (the user's language kept with the account) —
  in a later part of the work; until then the app stays Russian and links to the Russian legal pages.
- Static assets serve the site with the nearest `404.html` (`ru/404.html` under `/ru`); `/app` is
  `noindex` through `_headers`; robots.txt keeps crawlers off `/app` and the API.

**Alternatives.** The app at a subdomain (`app.clx.cx`) — its own cookies, CORS and route for no
gain. A static-site framework — more machinery than five pages need, and the CSP forbids inline
scripts most of them emit. A Russian host of its own (catchall.in keeps `ru.catchall.in` on GitHub
Pages because Cloudflare is blocked in Russia) — clx's users run Cloudflare accounts anyway.

**Consequences.** Bookmarks of `/` land on the site, one click from the app. The generated files in
`public/` are not committed; a deploy builds them. Spec §16.
