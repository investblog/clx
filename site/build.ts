// node site/build.ts — prints every page of the table (site/pages.ts) × its languages into public/,
// copies the app's page to public/app.html, and writes robots.txt and sitemap.xml. Run by
// scripts/build-ui.mjs; the output is not committed. Node runs this file as is (type stripping).
import fs from 'node:fs';
import path from 'node:path';
import { ALL_LOCALES, APP_PATH, ORIGIN, SITE_PAGES, type Locale, type PageDef } from './pages.ts';
import { STRINGS } from './i18n.ts';
import { escapeHtml, layout } from './layout.ts';
import { alternatesFor, fileFor, pathFor, urlFor } from './urls.ts';

const OUT = 'public';
const here = import.meta.dirname;

function home(locale: Locale): { title: string; description: string; body: string } {
  const s = STRINGS[locale].home;
  const body = `<section class="hero narrow">
  <h1>${escapeHtml(s.h1)}</h1>
  <p class="lead">${escapeHtml(s.lead)}</p>
  <ul class="points">${s.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
  <p class="actions"><a class="btn btn--primary" href="${APP_PATH}">${escapeHtml(s.cta)}</a></p>
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

function render(page: PageDef, locale: Locale): string {
  const content = page.slug === '/' ? home(locale) : page.slug === '/404' ? notFound(locale) : page.legal ? legal(page, locale) : null;
  if (!content) throw new Error(`no template for ${page.slug}`);
  return layout({ page, locale, ...content });
}

function write(file: string, text: string): void {
  const full = path.join(OUT, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

for (const page of SITE_PAGES) for (const locale of page.locales) write(fileFor(page.slug, locale), render(page, locale));
fs.copyFileSync(path.join(here, 'app.html'), path.join(OUT, 'app.html'));

write(
  'robots.txt',
  ['User-agent: *', `Disallow: ${APP_PATH}$`, 'Disallow: /v1/', 'Disallow: /auth/', 'Disallow: /admin/', 'Disallow: /hook/', '', `Sitemap: ${ORIGIN}/sitemap.xml`, ''].join('\n'),
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

console.log(`site built: ${SITE_PAGES.reduce((n, p) => n + p.locales.length, 0)} pages in ${ALL_LOCALES.join(', ')}, app.html, robots.txt, sitemap.xml`);
