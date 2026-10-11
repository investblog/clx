<?xml version="1.0" encoding="UTF-8"?>
<!-- The view of /sitemap.xml for a person (ADR 0020): the sitemap names it in a processing
     instruction, which search engines skip — an element of another namespace in a <url> is one
     Google reports as an error. A browser draws the page in the site's style: one row per page, its
     languages as links; /theme.js sets the reader's theme. A browser without XSLT shows the XML. -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"
  exclude-result-prefixes="sm xhtml">
  <xsl:output method="html" encoding="UTF-8" doctype-system="about:legacy-compat"/>
  <!-- Each language of a page is a <url> of its own with the same alternates: the row is the <url>
       of the page's first language, or the <url> of a page with no other. -->
  <xsl:variable name="rows" select="/sm:urlset/sm:url[not(xhtml:link[@hreflang != 'x-default']) or sm:loc = xhtml:link[@hreflang != 'x-default'][1]/@href]"/>
  <xsl:key name="lang" match="xhtml:link[@hreflang != 'x-default']" use="@hreflang"/>
  <xsl:template match="/">
    <html lang="en" data-theme="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>Sitemap — clx.cx</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
        <link rel="stylesheet" href="/app.css"/>
        <script src="/theme.js"></script>
      </head>
      <body>
        <header class="topbar"><div class="topbar__inner"><p class="brand"><a href="/"><svg xmlns="http://www.w3.org/2000/svg" class="icon brand__mark" aria-hidden="true"><use href="/icons.svg#i-mono-clx"/></svg><span>clx</span></a></p></div></header>
        <main class="site-main">
          <section class="hero">
            <p><span class="badge badge--brand">XML sitemap</span></p>
            <h1>clx.cx sitemap</h1>
            <p class="lead"><xsl:value-of select="count($rows)"/> pages, <xsl:value-of select="count(/sm:urlset/sm:url)"/> addresses in <xsl:value-of select="count(//xhtml:link[@hreflang != 'x-default'][generate-id() = generate-id(key('lang', @hreflang)[1])])"/> languages. Search engines read this file as XML; this view is for people.</p>
          </section>
          <div class="card table-scroll">
            <table class="table">
              <thead><tr><th>Page</th><th>Languages</th><th data-priority="low">Changes</th><th class="th-num" data-priority="medium">Priority</th></tr></thead>
              <tbody>
                <xsl:for-each select="$rows">
                  <tr>
                    <td><a href="{sm:loc}"><xsl:value-of select="substring-after(substring-after(sm:loc, '://'), 'clx.cx')"/><xsl:if test="substring-after(substring-after(sm:loc, '://'), 'clx.cx') = ''">/</xsl:if></a></td>
                    <td>
                      <xsl:for-each select="xhtml:link[@hreflang != 'x-default']">
                        <a class="badge badge--sm badge--primary" href="{@href}" hreflang="{@hreflang}"><xsl:value-of select="translate(@hreflang, 'enru', 'ENRU')"/></a>
                      </xsl:for-each>
                      <xsl:if test="not(xhtml:link[@hreflang != 'x-default'])"><a class="badge badge--sm badge--primary" href="{sm:loc}">—</a></xsl:if>
                    </td>
                    <td data-priority="low"><xsl:value-of select="sm:changefreq"/><xsl:if test="not(sm:changefreq)">—</xsl:if></td>
                    <td class="th-num" data-priority="medium"><xsl:value-of select="sm:priority"/><xsl:if test="not(sm:priority)">—</xsl:if></td>
                  </tr>
                </xsl:for-each>
              </tbody>
            </table>
          </div>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
