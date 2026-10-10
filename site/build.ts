// node site/build.ts — prints every page of the table (site/pages.ts) × its languages into public/,
// writes the app's page of each language (app.html, ru/app.html), robots.txt and sitemap.xml. Run by
// scripts/build-ui.mjs; the output is not committed. Node runs this file as is (type stripping).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import TurndownService from 'turndown';
import { SKILL, agentsBody, apiCatalog, authMd, llmsTxt, skillMd } from './agents.ts';
import { apiBody, apiJson, loadOpenapi } from './api.ts';
import { ALL_LOCALES, LOCALES, ORIGIN, SITE_PAGES, markdownFile, type Locale, type PageDef } from './pages.ts';
import { STRINGS } from './i18n.ts';
import { escapeHtml, layout } from './layout.ts';
import { alternatesFor, appPathFor, fileFor, pathFor, urlFor } from './urls.ts';

const OUT = 'public';
const here = import.meta.dirname;
const openapi = loadOpenapi(path.join(here, '..'));

function home(locale: Locale): { title: string; description: string; body: string } {
  const s = STRINGS[locale].home;
  const body = `<section class="hero narrow">
  <h1>${escapeHtml(s.h1)}</h1>
  <p class="lead">${escapeHtml(s.lead)}</p>
  <ul class="points">${s.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
  <p class="actions"><a class="btn btn--primary" href="${appPathFor(locale)}">${escapeHtml(s.cta)}</a></p>
</section>`;
  return { title: s.title, description: s.description, body };
}

function legal(page: PageDef, locale: Locale): { title: string; body: string } {
  const html = fs.readFileSync(path.join(here, 'legal', locale, `${page.slug.slice(1)}.html`), 'utf8');
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/u)?.[1];
  if (!h1) throw new Error(`site/legal/${locale}${page.slug}.html has no <h1>`);
  return { title: `${h1} — clx`, body: `<article class="narrow legal">\n${html}</article>` };
}

function notFound(locale: Locale): { title: string; body: string } {
  const s = STRINGS[locale].notFound;
  return { title: `${s.title} — clx`, body: `<section class="narrow">\n<h1 class="h3">${escapeHtml(s.title)}</h1>\n<p>${escapeHtml(s.text)}</p>\n<p><a href="${pathFor('/', locale)}">${escapeHtml(s.back)}</a></p>\n</section>` };
}

const AGENT_PAGES: Record<string, () => { title: string; description: string; body: string }> = {
  '/agents': () => ({ title: 'clx for AI agents', description: "How an AI agent sets up clx for a person: connect their Cloudflare account, add sites and embed the counter, make short links and QR codes, read reports — through the API.", body: agentsBody() }),
  '/api': () => ({ title: 'clx management API', description: 'The clx management API: Cloudflare accounts, sites and counter snippets, short links with rules and QR codes, reports. Authentication, idempotency, errors and every endpoint.', body: apiBody(openapi.doc) }),
};

function render(page: PageDef, locale: Locale): string {
  const content = page.slug === '/' ? home(locale) : page.slug === '/404' ? notFound(locale) : page.legal ? legal(page, locale) : (AGENT_PAGES[page.slug]?.() ?? null);
  if (!content) throw new Error(`no template for ${page.slug}`);
  return layout({ page, locale, ...content });
}

function write(file: string, text: string): void {
  const full = path.join(OUT, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });

/** The markdown of a rendered page: its <main> only, links made absolute. One source, so the HTML and
 *  the markdown cannot drift (catchall.in's way). */
function toMarkdown(html: string): string {
  const main = html.match(/<main[^>]*>([\s\S]*)<\/main>/u)?.[1];
  if (!main) throw new Error('a page without <main>');
  return `${turndown.turndown(main).replace(/\]\(\//gu, `](${ORIGIN}/`)}\n`;
}

for (const page of SITE_PAGES)
  for (const locale of page.locales) {
    const html = render(page, locale);
    write(fileFor(page.slug, locale), html);
    // The home page's markdown is the index of the docs (llms.txt), not its marketing text.
    if (page.markdown && locale === 'en') write(markdownFile(page.slug), page.slug === '/' ? llmsTxt() : toMarkdown(html));
  }
// The app's page of each language: app.html, ru/app.html.
const appPage = fs.readFileSync(path.join(here, 'app.html'), 'utf8');
for (const locale of ALL_LOCALES) write(fileFor('/app', locale), appPage.replace('%LANG%', LOCALES[locale].htmlLang));

// For agents (docs/spec.md §16): the docs index, how auth works (Cloudflare's scanner reads the root
// copy), the API catalog (RFC 9727), the skill with its digest (Agent Skills Discovery 0.2), the contract.
write('llms.txt', llmsTxt());
write('auth.md', authMd());
write('.well-known/auth.md', authMd());
write('.well-known/api-catalog', apiCatalog());
const skill = skillMd();
write(`.well-known/agent-skills/${SKILL.name}/SKILL.md`, skill);
write(
  '.well-known/agent-skills/index.json',
  `${JSON.stringify(
    {
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: [{ name: SKILL.name, type: 'skill-md', description: SKILL.description, url: `/.well-known/agent-skills/${SKILL.name}/SKILL.md`, digest: `sha256:${crypto.createHash('sha256').update(skill).digest('hex')}` }],
    },
    null,
    2,
  )}\n`,
);
write('openapi.yaml', openapi.text);
write('openapi.json', apiJson(openapi.doc));

write(
  'robots.txt',
  ['User-agent: *', 'Content-Signal: search=yes, ai-input=yes, ai-train=yes', ...ALL_LOCALES.map((l) => `Disallow: ${appPathFor(l)}$`), 'Disallow: /v1/', 'Disallow: /auth/', 'Disallow: /admin/', 'Disallow: /hook/', '', `Sitemap: ${ORIGIN}/sitemap.xml`, ''].join('\n'),
);

const urls = SITE_PAGES.filter((p) => p.indexed).flatMap((p) =>
  p.locales.map((locale) =>
    [
      '  <url>',
      `    <loc>${urlFor(p.slug, locale)}</loc>`,
      ...alternatesFor(p.slug, p.locales).map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`),
      p.changefreq ? `    <changefreq>${p.changefreq}</changefreq>` : '',
      p.priority !== undefined ? `    <priority>${p.priority.toFixed(1)}</priority>` : '',
      '  </url>',
    ]
      .filter(Boolean)
      .join('\n'),
  ),
);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);

console.log(`site built: ${SITE_PAGES.reduce((n, p) => n + p.locales.length, 0)} pages in ${ALL_LOCALES.join(', ')}, the app in each, robots.txt, sitemap.xml`);
