#!/usr/bin/env node
// node scripts/check-site.mjs — checks what scripts/build-ui.mjs put in public/ against the table of
// pages (site/pages.ts), before `build` and `deploy` go on:
//   - every page × language of the table has its file, and no other HTML page is there (the app's
//     pages aside), so a page dropped from the table does not linger on the site;
//   - the app's and site's scripts, robots.txt, sitemap.xml and the hand-written files are there;
//   - no page has an inline script or style (the CSP would block it — a page that only works in
//     development); its JSON-LD parses, and its Open Graph card is there at 1200×630;
//   - every link to a path of clx.cx in a page, or in a file for agents, leads to a file;
//   - the files for agents are there, each page with a markdown copy runs the Worker first (both
//     wrangler configs, else `Accept: text/markdown` never reaches src/markdown.ts), and the
//     skills index carries the digest of the SKILL.md beside it.
// Exits 1 with the list of problems.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_LOCALES, ORIGIN, SITE_PAGES, STATIC_FILES, markdownFile } from '../site/pages.ts';
import { fileFor } from '../site/urls.ts';

const OUT = 'public';
const problems = [];
const exists = (f) => fs.existsSync(path.join(OUT, f));

const expected = new Set(ALL_LOCALES.map((l) => fileFor('/app', l)));
for (const p of SITE_PAGES) for (const l of p.locales) expected.add(fileFor(p.slug, l));
const markdown = SITE_PAGES.filter((p) => p.markdown).map((p) => markdownFile(p.slug));
const agentFiles = ['llms.txt', 'auth.md', '.well-known/auth.md', '.well-known/api-catalog', '.well-known/agent-skills/index.json', 'openapi.yaml', 'openapi.json', ...markdown];
for (const f of [...expected, 'app.js', 'site.js', 'app.css', 'robots.txt', 'sitemap.xml', ...STATIC_FILES, ...agentFiles]) if (!exists(f)) problems.push(`missing public/${f}`);

for (const config of ['wrangler.example.jsonc', 'wrangler.jsonc'].filter((f) => fs.existsSync(f))) {
  const text = fs.readFileSync(config, 'utf8');
  if (!/"binding":\s*"ASSETS"/u.test(text)) problems.push(`${config}: the assets block lacks "binding": "ASSETS" (src/markdown.ts reads the pages through it)`);
  const first = text.match(/"run_worker_first":\s*\[([^\]]*)\]/u)?.[1] ?? '';
  for (const p of SITE_PAGES.filter((x) => x.markdown)) if (!first.includes(`"${p.slug}"`)) problems.push(`${config}: run_worker_first lacks "${p.slug}" (a page with a markdown copy)`);
}

if (exists('.well-known/agent-skills/index.json')) {
  for (const s of JSON.parse(fs.readFileSync(path.join(OUT, '.well-known/agent-skills/index.json'), 'utf8')).skills) {
    const file = path.join(OUT, s.url.slice(1));
    const digest = fs.existsSync(file) ? `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}` : null;
    if (digest !== s.digest) problems.push(`skill ${s.name}: ${digest ? 'digest does not match SKILL.md' : `missing ${s.url}`}`);
  }
}

const indexedFiles = new Set(SITE_PAGES.filter((p) => p.indexed).flatMap((p) => p.locales.map((l) => fileFor(p.slug, l))));
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
  // JSON-LD is a data block the browser never runs (and the CSP does not block): not an inline script.
  if (/<script(?![^>]*\ssrc=)(?![^>]*type="application\/ld\+json")[^>]*>/iu.test(html)) problems.push(`public/${f}: inline <script>`);
  // At most one block, whole (an unclosed one is counted as opened but not as whole), and it parses.
  const ldOpened = html.split('<script type="application/ld+json">').length - 1;
  const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)].map((m) => m[1]);
  if (ldOpened !== ldBlocks.length || ldBlocks.length > 1) problems.push(`public/${f}: ${ldOpened} JSON-LD blocks opened, ${ldBlocks.length} whole — one whole block expected`);
  for (const ld of ldBlocks)
    try {
      JSON.parse(ld);
    } catch {
      problems.push(`public/${f}: JSON-LD that does not parse`);
    }
  // An indexed page of the table must carry both; and its Open Graph card is there, a 1200×630 PNG
  // (scripts/build-og.mjs). The app's pages and the 404 carry neither.
  const og = html.match(/<meta property="og:image" content="https:\/\/[^/]+(\/og\/[^"]+\.png)"/u)?.[1];
  if (indexedFiles.has(f)) {
    if (!og) problems.push(`public/${f}: an indexed page without og:image`);
    if (ldBlocks.length !== 1) problems.push(`public/${f}: an indexed page without its JSON-LD block`);
  }
  if (og) {
    const png = exists(og.slice(1)) ? fs.readFileSync(path.join(OUT, og.slice(1))) : null;
    if (!png) problems.push(`public/${f}: missing its card ${og}`);
    else if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) problems.push(`public/${f}: ${og} is not 1200×630`);
  }
  if (/<style[\s>]/iu.test(html) || /\sstyle=/iu.test(html)) problems.push(`public/${f}: inline style`);
  for (const [, href] of html.matchAll(/\s(?:href|src)="(\/[^"/][^"]*|\/)"/gu)) if (!served(href)) problems.push(`public/${f}: ${href} leads nowhere`);
}

// The files for agents link with absolute addresses.
const own = new RegExp(`${ORIGIN.replaceAll('.', '\\.')}(/[^\\s)"'<>]*)`, 'gu');
for (const f of agentFiles.filter((x) => exists(x) && !x.startsWith('openapi')))
  for (const [, href] of fs.readFileSync(path.join(OUT, f), 'utf8').matchAll(own))
    if (!/^\/(v1|app|ru\/app)\b/u.test(href) && !served(href.replace(/[.,;:]+$/u, ''))) problems.push(`public/${f}: ${ORIGIN}${href} leads nowhere`);

if (problems.length) {
  console.error(`check-site: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-site: ${pages.length} pages ok`);
