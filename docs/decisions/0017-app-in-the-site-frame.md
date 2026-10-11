---
title: The app sits in the site's frame; the sitemap has a view for people
type: decision
status: accepted
date: 2026-10-11
---

# 0017. The app sits in the site's frame; the sitemap has a view for people

**Context.** The site (ADR 0012) and the app had headers of their own: the site's with the menu, the
language and "Sign in"; the app's with its sections and sign-out, its brand leading to the app's
first page. Once inside, the site's pages were out of reach but for the sign-in card's legal links.
The sitemap was plain XML.

**Decision.**
- The app's page (`/app`, `/ru/app`) carries the site's header and footer, printed in by
  `site/build.ts` from the same functions as every site page (`site/layout.ts`), without the
  language switch and without the link to the app. The app draws its sections and sign-out in a row
  under the header (`ui/main.ts`); signed out, the row is empty and the page shows the form between
  the site's header and footer. The sign-in card no longer repeats the legal links.
- The header is printed in the address's language, so a signed-in app whose account speaks another
  language moves to that language's address, the same page (`/ru/app#/sites` → `/app#/sites`). This
  amends ADR 0015, where the app switched its words in place.
- The theme switch and the phone menu are one script for both, `/theme.js`.
- On the site the header's link to the app says "Sign in", or "Dashboard" in a browser where the app
  has seen a session: the app keeps a mark in `localStorage` (`clx-signed-in`), set when `/v1/me`
  answers and cleared on sign-out; `/theme.js` reads it before the first paint, and both labels are
  in the page, one hidden by CSS. A hint for a label only — the app still asks the server.
- `/sitemap.xml` ends its last `<url>` with `<xhtml:script src="/sitemap.js"/>`
  (`site/sitemap-view.ts`): a browser runs it and redraws the file as a page in the site's style —
  one row per page with its languages as links. The sitemap's schema allows an element of another
  namespace at the end of `<url>` (`xsd:any ##other`), as it does `xhtml:link`; whether Search
  Console warns about it is checked after the release.

**Rejected.**
- *The site's menu in the app drawn by the app's script*, in the account's language: the header would
  live twice (a build-time template and a runtime one) and the app would carry the site's words.
- *Asking `/v1/me` from every site page* to label the link (catchall.in shows its panel link that
  way): a call to the Worker and D1 for each page view, for a label.
- *An XSLT stylesheet for the sitemap*: Chrome warns about XSLT and is removing it; Firefox follows.
- *An HTML sitemap page*: the menu and the footer already link every page; the XML view is enough.

**Consequences.** Changing the language on the profile page reloads the app at the other address.
Search engines see the same sitemap as before plus one element they ignore.
