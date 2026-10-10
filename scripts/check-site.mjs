#!/usr/bin/env node
// node scripts/check-site.mjs — checks what scripts/build-ui.mjs put in public/ against the table of
// pages (site/pages.ts), before `build` and `deploy` go on:
//   - every page × language of the table has its file, and no other HTML page is there (app.html
//     aside), so a page dropped from the table does not linger on the site;
//   - the app's and site's scripts, robots.txt, sitemap.xml and the hand-written files are there;
//   - no page has an inline script or style (the CSP would block it — a page that only works in
//     development);
//   - every link to a path of clx.cx in a page leads to a file.
// Exits 1 with the list of problems.
import fs from 'node:fs';
import path from 'node:path';
import { SITE_PAGES, STATIC_FILES } from '../site/pages.ts';
import { fileFor } from '../site/urls.ts';

const OUT = 'public';
const problems = [];
const exists = (f) => fs.existsSync(path.join(OUT, f));

const expected = new Set(['app.html']);
for (const p of SITE_PAGES) for (const l of p.locales) expected.add(fileFor(p.slug, l));
for (const f of [...expected, 'app.js', 'site.js', 'robots.txt', 'sitemap.xml', ...STATIC_FILES]) if (!exists(f)) problems.push(`missing public/${f}`);

const pages = fs.readdirSync(OUT, { recursive: true }).map((f) => String(f).replaceAll('\\', '/')).filter((f) => f.endsWith('.html'));
for (const f of pages) if (!expected.has(f)) problems.push(`public/${f} is not in site/pages.ts`);

/** The file a path of clx.cx is served from (html_handling = drop-trailing-slash). */
const served = (p) => {
  const clean = p.replace(/[?#].*$/u, '');
  if (clean === '/') return exists('index.html');
  return exists(clean.slice(1)) || exists(`${clean.slice(1)}.html`);
};

for (const f of pages) {
  const html = fs.readFileSync(path.join(OUT, f), 'utf8');
  if (/<script(?![^>]*\ssrc=)[^>]*>/iu.test(html)) problems.push(`public/${f}: inline <script>`);
  if (/<style[\s>]/iu.test(html) || /\sstyle=/iu.test(html)) problems.push(`public/${f}: inline style`);
  for (const [, href] of html.matchAll(/\s(?:href|src)="(\/[^"/][^"]*|\/)"/gu)) if (!served(href)) problems.push(`public/${f}: ${href} leads nowhere`);
}

if (problems.length) {
  console.error(`check-site: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-site: ${pages.length} pages ok`);
