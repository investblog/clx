---
title: A partner's code on a static page — the page's script carries it to the Worker's pages
type: decision
status: accepted
date: 2026-11-18
---

# 0048. A partner's code on a static page

Extends [ADR 0036](./0036-partners.md) (attribution by `?ref=`).

**Context.** The Worker sets the `clx_ref` cookie for a `?ref=CODE` visit only on the pages it
serves: clx.cx's home page, which the Partners page links to, and `/ru/signin`. Every other page is
a static file the Worker never sees — the product pages, the QR pages and, since ADR 0047, the
Serbian pages. A partner who links to `/analytics?ref=…` or `/sr?ref=…` brought the visitor, but the
visitor's sign-up was not theirs: the code stayed in the address and nothing read it (checked live,
18.11.2026: `/?ref=` answers 302, `/analytics?ref=`, `/sr?ref=` and `/sr/pricing?ref=` answer 200).
The Russian host already solved the same problem in its pages' script.

**Decision.** The pages' script (`site/client.ts` → `/site.js`) does on every page that is not one of
the Worker's two what it did on the Russian host: it keeps a `?ref=` for the tab (`sessionStorage`,
last touch) and adds it to the page's links to `https://clx.cx/` and `https://clx.cx/ru/signin`. The
click to sign up, to sign in or to the home page reaches the Worker with the code, which checks it
and sets the cookie as for any visit. On the Worker's own pages the script changes nothing: the
Worker has seen the code, and the card's tabs stay in-page links.

**Rejected.** Running the Worker first on more pages (`run_worker_first`): every view of such a page
would spend a Worker request of the free plan's daily allowance, and only the pages listed would be
covered.

**Consequences.** The code counts from the click to sign up, not from the landing: a visitor who
reads `/sr` and leaves sets no cookie; one who comes back later from elsewhere is not attributed
unless they come by a partner's link again. A visitor without scripts is not attributed from a
static page. The Partners page still gives the home page's link, which needs neither.
