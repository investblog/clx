// The view of /sitemap.xml for a person (public/sitemap.js, built by scripts/build-ui.mjs; after the
// casino platform's). site/build.ts puts `<xhtml:script src="/sitemap.js"/>` at the end of the last
// <url> — the one place the sitemap's schema takes an element of another namespace, and by then every
// <url> is parsed (xsd:any ##other). A browser runs it. Not XSLT: browsers are dropping it.
// The script swaps the XML for a page drawn with the site's own stylesheet: one row per page, its
// languages as links. The sitemap is one for all languages, so the page is in English.
const SM = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';

function el(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]): Element {
  const e = document.createElementNS(XHTML, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

interface Row {
  /** [hreflang, address], the page in each language; one entry without a language when it has no other. */
  langs: [string, string][];
  changefreq: string;
  priority: string;
}

const root = document.documentElement;
// A sitemap index, or anything else, keeps the browser's own view.
if (root.localName === 'urlset' && root.namespaceURI === SM) {
  const text = (u: Element, name: string) => u.getElementsByTagNameNS(SM, name)[0]?.textContent?.trim() ?? '';
  const urls = Array.from(root.getElementsByTagNameNS(SM, 'url'));
  // Each language of a page is a <url> of its own with the same alternates: one row for them all.
  const rows = new Map<string, Row>();
  for (const u of urls) {
    const loc = text(u, 'loc');
    const langs = Array.from(u.getElementsByTagNameNS(XHTML, 'link'))
      .filter((l) => l.getAttribute('rel') === 'alternate' && l.getAttribute('hreflang') !== 'x-default')
      .map((l): [string, string] => [l.getAttribute('hreflang') ?? '', l.getAttribute('href') ?? '']);
    const key = langs.length ? langs.map((l) => l[1]).join(' ') : loc;
    if (!rows.has(key)) rows.set(key, { langs: langs.length ? langs : [['', loc]], changefreq: text(u, 'changefreq'), priority: text(u, 'priority') });
  }

  let theme = 'dark';
  try {
    if (localStorage.getItem('clx-theme') === 'light') theme = 'light';
  } catch {
    // private mode: the site's default
  }

  const mark = document.createElementNS(SVG, 'svg');
  mark.setAttribute('class', 'icon brand__mark');
  mark.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', '/icons.svg#i-mono-clx');
  mark.append(use);
  const header = el('header', { class: 'topbar' }, el('div', { class: 'topbar__inner' }, el('p', { class: 'brand' }, el('a', { href: '/' }, mark, el('span', {}, 'clx')))));

  const body = [...rows.values()].map((r) => {
    const first = r.langs[0]![1];
    return el(
      'tr',
      {},
      el('td', {}, el('a', { href: first }, new URL(first).pathname)),
      el('td', {}, ...r.langs.map(([lang, href]) => el('a', { class: 'badge badge--sm badge--primary', href, hreflang: lang }, lang.toUpperCase() || '—'))),
      el('td', { 'data-priority': 'low' }, r.changefreq || '—'),
      el('td', { class: 'th-num', 'data-priority': 'medium' }, r.priority || '—'),
    );
  });
  const languages = new Set([...rows.values()].flatMap((r) => r.langs.map((l) => l[0]).filter(Boolean)));
  const main = el(
    'main',
    { class: 'site-main' },
    el(
      'section',
      { class: 'hero' },
      el('p', {}, el('span', { class: 'badge badge--brand' }, 'XML sitemap')),
      el('h1', {}, `${location.host} sitemap`),
      el('p', { class: 'lead' }, `${rows.size} pages, ${urls.length} addresses in ${languages.size} languages. Search engines read this file as XML; this view is for people.`),
    ),
    el(
      'div',
      { class: 'card table-scroll' },
      el(
        'table',
        { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Page'), el('th', {}, 'Languages'), el('th', { 'data-priority': 'low' }, 'Changes'), el('th', { class: 'th-num', 'data-priority': 'medium' }, 'Priority'))),
        el('tbody', {}, ...body),
      ),
    ),
  );

  const page = el(
    'html',
    { lang: 'en', 'data-theme': theme },
    el(
      'head',
      {},
      el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1.0' }),
      el('title', {}, `Sitemap — ${location.host}`),
      el('link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }),
      el('link', { rel: 'stylesheet', href: '/app.css' }),
    ),
    el('body', {}, header, main),
  );
  document.replaceChild(page, root);
}
