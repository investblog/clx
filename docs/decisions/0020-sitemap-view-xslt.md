---
title: The sitemap's view for people is an XSLT stylesheet, not a script in a <url>
type: decision
status: accepted
date: 2026-10-11
---

# 0020. The sitemap's view for people is an XSLT stylesheet, not a script in a `<url>`

Supersedes the sitemap part of [ADR 0017](./0017-app-in-the-site-frame.md).

**Context.** ADR 0017 drew `/sitemap.xml` for people with `<xhtml:script src="/sitemap.js"/>` at the
end of its last `<url>`: the sitemaps.org schema takes an element of another namespace there, and
it was to be checked in Search Console after the release. Search Console reported it on 11.10.2026:
"Invalid XML tag", parent `url`, tag `script`. Google takes only the extensions it knows in a
`<url>`. generator.ink, of the same owner, names an XSLT stylesheet in a processing instruction and
has no such error.

**Decision.**
- `/sitemap.xml` starts with `<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>`; a `<url>`
  holds only `loc`, `xhtml:link`, `changefreq` and `priority`. A processing instruction is not an
  element: search engines skip it.
- `public/sitemap.xsl` (a static file) draws the same page the script did: the site's stylesheet,
  one row per page with its languages as links; `/theme.js` sets the reader's theme. The script
  (`site/sitemap-view.ts`, `public/sitemap.js`) is gone.
- The owner chose this over plain XML (11.10.2026), knowing the cost below.

**Consequences.** Chrome shows a banner over the page that XSLT is being removed; when it is, the
browser shows the plain XML — the file stays valid either way. generator.ink is in the same place.
