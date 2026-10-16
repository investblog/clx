// node site/build.ts — prints every page of the table (site/pages.ts) × its languages into public/,
// writes the app's page of each language (app.html, ru/app.html), robots.txt and sitemap.xml. Run by
// scripts/build-ui.mjs; the output is not committed. Node runs this file as is (type stripping).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import TurndownService from 'turndown';
import { SKILL, agentsBody, apiCatalog, authMd, llmsTxt, mcpServerCard, skillMd } from './agents.ts';
import { apiBody, apiJson, loadOpenapi } from './api.ts';
import { ALL_LOCALES, LOCALES, ORIGIN, REPO, SITE_PAGES, markdownFile, type Locale, type PageDef } from './pages.ts';
import { STRINGS } from './i18n.ts';
import { home } from './home.ts';
import { faqGroups, faqPage } from './faq.ts';
import { analyticsPage, generatorsPage, howPage, linksPage, openSourcePage, pricingPage } from './products.ts';
import { bitlyPage, clckPage, liveinternetPage, parentPage, plausiblePage } from './compare.ts';
import { KEYWORDS } from './keywords.ts';
import { escapeHtml, footer, header, layout } from './layout.ts';
import { alternatesFor, appFileFor, appPathFor, fileFor, hostOf, pathFor, renderingOn, RU_ORIGIN, urlFor, type Host } from './urls.ts';

/** clx.cx's files (Workers Static Assets), and the Russian host's when it has its own (ADR 0030):
 *  a directory GitHub Pages serves (scripts/deploy-ru.mjs). Set by env for a test build. */
const OUT = process.env.CLX_SITE_OUT || 'public';
const RU_OUT = process.env.CLX_RU_OUT || 'dist-ru';
const outOf = (host: Host) => (host === 'ru' ? RU_OUT : OUT);
const here = import.meta.dirname;
const openapi = loadOpenapi(path.join(here, '..'));

function legal(page: PageDef, locale: Locale): { title: string; body: string } {
  // A link to a page of the site is written by its slug (`/abuse`) and becomes the page in this
  // language, on its host (site/urls.ts).
  const html = fs.readFileSync(path.join(here, 'legal', locale, `${page.slug.slice(1)}.html`), 'utf8').replace(/href="(\/[^"]*)"/gu, (_, slug: string) => `href="${pathFor(slug, locale)}"`);
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/u)?.[1];
  if (!h1) throw new Error(`site/legal/${locale}${page.slug}.html has no <h1>`);
  return { title: `${h1} — clx`, body: `<article class="narrow legal">\n${html}</article>` };
}

function notFound(locale: Locale): { title: string; body: string } {
  const s = STRINGS[locale].notFound;
  return { title: `${s.title} — clx`, body: `<section class="narrow">\n<h1 class="h3">${escapeHtml(s.title)}</h1>\n<p>${escapeHtml(s.text)}</p>\n<p><a href="${pathFor('/', locale)}">${escapeHtml(s.back)}</a></p>\n</section>` };
}

const PRODUCT_PAGES: Record<string, (locale: Locale) => { title: string; description: string; body: string }> = { '/analytics': analyticsPage, '/short-links': linksPage, '/for-site-generators': generatorsPage, '/pricing': pricingPage, '/faq': faqPage, '/how-it-works': howPage, '/open-source': openSourcePage };
// The comparison pages have one language each (site/pages.ts).
const COMPARE_PAGES: Record<string, () => { title: string; description: string; body: string }> = { '/bitly-alternative': bitlyPage, '/plausible-alternative': plausiblePage, '/clck-alternative': clckPage, '/liveinternet-alternative': liveinternetPage };
const PARENT_PAGES: Record<string, (locale: Locale) => { title: string; description: string; body: string }> = { '/vs-301': parentPage };

const AGENT_PAGES: Record<string, () => { title: string; description: string; body: string }> = {
  '/agents': () => ({ title: 'clx for AI agents', description: "How an AI agent sets up clx for a person: connect their Cloudflare account, add sites and embed the counter, make short links and QR codes, read reports — through the API.", body: agentsBody() }),
  '/api': () => ({ title: 'clx management API', description: 'The clx management API: Cloudflare accounts, sites and counter snippets, short links with rules and QR codes, reports. Authentication, idempotency, errors and every endpoint.', body: apiBody(openapi.doc) }),
};

/**
 * The page's schema.org nodes: the site, its maker and the product on the home page; every other page
 * a breadcrumb from home; /faq its questions (the same lists the pages show).
 */
function structuredData(page: PageDef, locale: Locale, content: { title: string; description?: string }): Record<string, unknown>[] {
  const lang = LOCALES[locale].htmlLang;
  const home = urlFor('/', locale);
  if (page.slug === '/')
    return [
      { '@type': 'Organization', '@id': `${ORIGIN}/#org`, name: 'clx', url: ORIGIN, logo: `${ORIGIN}/apple-touch-icon.png`, sameAs: [REPO] },
      { '@type': 'WebSite', '@id': `${home}#site`, name: 'clx', url: home, inLanguage: lang, publisher: { '@id': `${ORIGIN}/#org` } },
      {
        '@type': 'SoftwareApplication',
        name: 'clx',
        url: home,
        description: content.description,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        inLanguage: lang,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@id': `${ORIGIN}/#org` },
      },
    ];
  const name = page.nav ? STRINGS[locale].nav[page.nav] : content.title.split(' — ')[0]!;
  const crumbs = { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'clx', item: home }, { '@type': 'ListItem', position: 2, name, item: urlFor(page.slug, locale) }] };
  if (page.slug !== '/faq') return [crumbs];
  const questions = faqGroups(locale).flatMap((g) => g.items);
  return [crumbs, { '@type': 'FAQPage', inLanguage: lang, mainEntity: questions.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }];
}

function render(page: PageDef, locale: Locale, stub = false): { html: string; title: string; description?: string } {
  const content: { title: string; description?: string; body: string } | null = page.slug === '/' ? home(locale) : page.slug === '/404' ? notFound(locale) : page.legal ? legal(page, locale) : (PRODUCT_PAGES[page.slug]?.(locale) ?? AGENT_PAGES[page.slug]?.() ?? COMPARE_PAGES[page.slug]?.() ?? PARENT_PAGES[page.slug]?.(locale) ?? null);
  if (!content) throw new Error(`no template for ${page.slug}`);
  const html = layout({ page, locale, ...content, stub, jsonLd: page.indexed ? structuredData(page, locale, content) : undefined });
  return { html, title: content.title, description: content.description };
}

function write(file: string, text: string, host: Host = 'main'): void {
  const full = path.join(outOf(host), file);
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

// The anchor map for sites that link here (site/keywords.ts): an entry per page and language, its title
// and excerpt the page's own. The date is the last change of the site's source, or today outside git.
let changed = new Date().toISOString().slice(0, 10);
try {
  changed = execFileSync('git', ['log', '-1', '--format=%cs', '--', 'site'], { encoding: 'utf8' }).trim() || changed;
} catch {
  // not a git checkout
}
const anchors: Record<string, unknown>[] = [];
// Russian on its own host: its directory is written afresh, and clx.cx keeps no Russian page of an
// earlier build but the app's (its home page is written again below).
if (RU_ORIGIN) {
  fs.rmSync(RU_OUT, { recursive: true, force: true });
  const old = path.join(OUT, 'ru');
  if (fs.existsSync(old)) for (const f of fs.readdirSync(old, { recursive: true }).map(String)) if (f.endsWith('.html') && f !== 'app.html') fs.rmSync(path.join(old, f));
  fs.rmSync(path.join(OUT, 'ru.html'), { force: true });
}
for (const page of SITE_PAGES)
  for (const locale of page.locales) {
    // Each page is written on its own host: links to the other host come out whole (site/urls.ts).
    const host = hostOf(locale);
    renderingOn(host);
    const { html, title, description } = render(page, locale);
    write(fileFor(page.slug, locale), html, host);
    // The Russian home page is written on clx.cx too, at /ru/signin, for its sign-in card, unindexed.
    if (host === 'ru' && page.slug === '/') {
      renderingOn('main');
      write('ru/signin.html', render(page, locale, true).html);
    }
    renderingOn('main');
    const kw = KEYWORDS[page.slug]?.[locale];
    if (kw) anchors.push({ url: urlFor(page.slug, locale), locale, type: page.slug === '/' ? 'general' : 'product', primary: kw.primary, keywords: kw.keywords, title: title.replace(/ — clx$/u, ''), tags: kw.tags, excerpt: description, date: changed });
    // The home page's markdown is the index of the docs (llms.txt), not its marketing text.
    if (page.markdown && locale === 'en') write(markdownFile(page.slug), page.slug === '/' ? llmsTxt() : toMarkdown(html));
  }
// The app's page of each language: app.html, ru/app.html — with the site's header and footer, so the
// menu and the way back to the site stay in the app.
const appPage = fs.readFileSync(path.join(here, 'app.html'), 'utf8');
for (const locale of ALL_LOCALES)
  write(appFileFor(locale), appPage.replace('%LANG%', LOCALES[locale].htmlLang).replace('%HEADER%', () => header(null, locale)).replace('%FOOTER%', () => footer(locale)));

// For agents (docs/spec.md §16): the docs index, how auth works (Cloudflare's scanner reads the root
// copy), the API catalog (RFC 9727), the skill with its digest (Agent Skills Discovery 0.2), the contract.
write('llms.txt', llmsTxt());
write('auth.md', authMd());
write('.well-known/auth.md', authMd());
write('.well-known/api-catalog', apiCatalog());
// The MCP server card (ADR 0023) at both paths in use: Cloudflare's announcement and isitagentready's probe.
for (const f of ['server-card.json', 'server-cards.json']) write(`.well-known/mcp/${f}`, mcpServerCard());
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
write('keywords.json', `${JSON.stringify({ generated: new Date().toISOString(), pages: anchors }, null, 2)}\n`);
write('openapi.yaml', openapi.text);
write('openapi.json', apiJson(openapi.doc));

write(
  'robots.txt',
  ['User-agent: *', 'Content-Signal: search=yes, ai-input=yes, ai-train=yes', ...ALL_LOCALES.map((l) => `Disallow: ${appPathFor(l)}$`), 'Disallow: /v1/', 'Disallow: /auth/', 'Disallow: /admin/', 'Disallow: /hook/', '', `Sitemap: ${ORIGIN}/sitemap.xml`, ''].join('\n'),
);

/** A host's sitemap: its own indexed pages, each with its alternates on either host. */
function sitemap(host: Host): string {
  const urls = SITE_PAGES.filter((p) => p.indexed).flatMap((p) =>
    p.locales
      .filter((locale) => hostOf(locale) === host)
      .map((locale) =>
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
  // The view for a person (public/sitemap.xsl, ADR 0020) is named by a processing instruction, which
  // search engines skip: an element in a <url> other than theirs is one Google reports as an error.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}
write('sitemap.xml', sitemap('main'));

// The Russian host (ADR 0030): its sitemap and robots.txt, the GitHub Pages files, and on clx.cx a
// 301 from each old /ru address to it (/ru to its home page) — all but the app and the sign-in card.
const ruPages = SITE_PAGES.filter((p) => p.locales.includes('ru') && p.slug !== '/' && p.slug !== '/404');
if (RU_ORIGIN) {
  write('sitemap.xml', sitemap('ru'), 'ru');
  write('robots.txt', ['User-agent: *', 'Content-Signal: search=yes, ai-input=yes, ai-train=yes', '', `Sitemap: ${RU_ORIGIN}/sitemap.xml`, ''].join('\n'), 'ru');
  write('CNAME', `${new URL(RU_ORIGIN).hostname}\n`, 'ru');
  // GitHub Pages runs Jekyll otherwise, which drops files and folders that start with "_" or ".".
  write('.nojekyll', '', 'ru');
  // `/ru/` too: with no ru.html the assets no longer send it to /ru, and it would be a 404.
  write('_redirects', `/ru ${RU_ORIGIN}/ 301\n/ru/ ${RU_ORIGIN}/ 301\n${ruPages.map((p) => `/ru${p.slug} ${RU_ORIGIN}${p.slug} 301`).join('\n')}\n`);
} else fs.rmSync(path.join(OUT, '_redirects'), { force: true });

console.log(`site built: ${SITE_PAGES.reduce((n, p) => n + p.locales.length, 0)} pages in ${ALL_LOCALES.join(', ')}, the app in each, robots.txt, sitemap.xml${RU_ORIGIN ? `; Russian on ${RU_ORIGIN} (${RU_OUT}/)` : ''}`);
