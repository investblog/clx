// The site's addresses and pages (site/, docs/spec.md §16): one table, one URL function, and what
// the generator prints from them.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SITE_PAGES } from '../site/pages.ts';
import { generateMatrix } from '../src/qr/generate';
import { alternatesFor, authPathFor, fileFor, ogImagePath, pathFor, urlFor } from '../site/urls.ts';
import { PASSWORD_MIN } from '../src/auth/signup';
import { nextRoute, signInPath } from '../ui/next.ts';

describe('addresses', () => {
  it('English at the root, Russian under /ru, no trailing slash on a home page', () => {
    expect(pathFor('/', 'en')).toBe('/');
    expect(pathFor('/', 'ru')).toBe('/ru');
    expect(pathFor('/privacy', 'en')).toBe('/privacy');
    expect(pathFor('/privacy', 'ru')).toBe('/ru/privacy');
    expect(urlFor('/terms', 'ru')).toBe('https://clx.cx/ru/terms');
  });

  it('files match the addresses static assets serve them at', () => {
    expect(fileFor('/', 'en')).toBe('index.html');
    expect(fileFor('/', 'ru')).toBe('ru.html');
    expect(fileFor('/privacy', 'en')).toBe('privacy.html');
    expect(fileFor('/privacy', 'ru')).toBe('ru/privacy.html');
    expect(fileFor('/404', 'ru')).toBe('ru/404.html');
  });

  it('alternates: x-default on English, then every language of the page', () => {
    expect(alternatesFor('/abuse', ['en', 'ru'])).toEqual([
      { hreflang: 'x-default', href: 'https://clx.cx/abuse' },
      { hreflang: 'en', href: 'https://clx.cx/abuse' },
      { hreflang: 'ru', href: 'https://clx.cx/ru/abuse' },
    ]);
  });
});

describe('generated pages', () => {
  const read = (f: string) => fs.readFileSync(`public/${f}`, 'utf8');
  beforeAll(() => {
    execFileSync(process.execPath, ['site/build.ts'], { stdio: 'pipe' });
  });

  it('keywords.json: every page worth a link, in its languages; anchors pass the link pipeline’s rules', () => {
    const raw = read('keywords.json');
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    const map = JSON.parse(raw) as { generated: string; pages: { url: string; locale: string; type: string; primary: string; keywords: string[]; title: string; tags: string[]; excerpt: string; date: string }[] };
    expect(Number.isNaN(Date.parse(map.generated))).toBe(false);
    const targets = SITE_PAGES.filter((p) => p.indexed && !p.legal).flatMap((p) => p.locales.map((l) => urlFor(p.slug, l)));
    expect(map.pages.map((e) => e.url).sort()).toEqual([...targets].sort());
    const word = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/u.source;
    const plain = new RegExp(`^${word}(?: ${word})*$`, 'u');
    for (const l of ['en', 'ru']) {
      const all = map.pages.filter((e) => e.locale === l).flatMap((e) => [e.primary, ...e.keywords]);
      expect(new Set(all.map((a) => a.toLowerCase())).size, `${l}: an anchor of two targets`).toBe(all.length);
    }
    for (const e of map.pages) {
      expect(/^\/ru(\/|$)/u.test(new URL(e.url).pathname) === (e.locale === 'ru'), e.url).toBe(true);
      expect(e.type).toBe(e.url === urlFor('/', e.locale as 'en' | 'ru') ? 'general' : 'product');
      expect(e.keywords.length, e.url).toBeGreaterThanOrEqual(3);
      expect(e.keywords.length, e.url).toBeLessThanOrEqual(5);
      expect(e.title && e.excerpt && e.tags.length, e.url).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      for (const a of [e.primary, ...e.keywords]) {
        expect(a, e.url).toMatch(plain);
        const words = a.toLowerCase().split(' ');
        expect(words.length, a).toBeGreaterThanOrEqual(2);
        expect(words.length, a).toBeLessThanOrEqual(7);
        // No word twice, nor its root (the first five letters of a longer word), the parts of a
        // hyphenated word counted on their own.
        const roots = words.flatMap((w) => w.split('-')).map((w) => (w.length > 5 ? w.slice(0, 5) : w));
        expect(new Set(roots).size, a).toBe(roots.length);
        // The page's language: English in Latin letters; Russian in Cyrillic, Latin only for names
        // (clx, Cloudflare, LiveInternet, QR, AGPL, API).
        if (e.locale === 'en') expect(a, a).toMatch(/^[\p{Script=Latin}\p{N} '-]+$/u);
        else {
          expect(a, a).toMatch(/^[\p{Script=Cyrillic}\p{Script=Latin}\p{N} '-]+$/u);
          expect(a.split(' ').filter((w) => /\p{Script=Cyrillic}/u.test(w)).length, a).toBeGreaterThanOrEqual(1);
          for (const w of a.split(/[ -]/u).filter((x) => /\p{Script=Latin}/u.test(x))) expect(['clx', 'Cloudflare', 'Workers', 'LiveInternet', 'QR', 'AGPL', 'API'], a).toContain(w);
        }
      }
    }
  });

  it('every page of the table, in its languages, with canonical and hreflang; the 404 is noindex', () => {
    for (const p of SITE_PAGES)
      for (const l of p.locales) {
        const html = read(fileFor(p.slug, l));
        expect(html).toContain(`<html lang="${l}"`);
        if (p.indexed) {
          expect(html).toContain(`<link rel="canonical" href="${urlFor(p.slug, l)}" />`);
          // x-default is the English page; a page without one (a Russian comparison) has none.
          if (p.locales.includes('en')) expect(html).toContain(`hreflang="x-default" href="${urlFor(p.slug, 'en')}"`);
          else expect(html).not.toContain('x-default');
          expect(html).not.toContain('noindex');
        } else expect(html).toContain('<meta name="robots" content="noindex" />');
      }
  });

  it('the home page links to the app, the other language and the legal pages of its own language', () => {
    const ru = read('ru.html');
    expect(ru).toContain('href="/ru/app"');
    expect(read('index.html')).toContain('href="/app"');
    expect(ru).toContain('href="/" hreflang="en"');
    expect(ru).toContain('href="/ru/privacy"');
    expect(read('index.html')).toContain('href="/ru" hreflang="ru"');
  });

  it('the home page: sign-up first, an example report drawn for both themes and both widths, nothing inline', () => {
    for (const [file, app] of [['index.html', '/app'], ['ru.html', '/ru/app']] as const) {
      const html = read(file);
      // Signed out the first button opens the card's sign-up form; signed in it leads to the app.
      expect(html).toContain('<a class="btn btn--primary btn--lg when-signed-out" href="#register">');
      expect(html).toContain(`<a class="btn btn--primary btn--lg when-signed-in" href="${app}">`);
      // The sign-in card (ADR 0026): hidden, three forms that post (never a GET with the password).
      const card = html.match(/<section class="card auth-card auth" data-auth[\s\S]*?<\/section>/u)![0];
      expect(card).toContain(`data-app="${app}"`);
      expect(card).toMatch(/data-t="[^"]+" hidden>/u);
      expect([...card.matchAll(/<form class="auth-form" method="post" data-auth-form="(\w+)" hidden>/gu)].map((m) => m[1])).toEqual(['login', 'register', 'recover']);
      expect(card).not.toMatch(/style=|<script/u);
      // The minimum the forms ask for is the server's, in the card and on the app's new-password page.
      expect(card).toContain(`minlength="${PASSWORD_MIN}"`);
      expect(fs.readFileSync('ui/signup.ts', 'utf8')).toContain(`const PASSWORD_MIN = ${PASSWORD_MIN};`);
      const demo = html.match(/<figure class="demo" aria-hidden="true">[\s\S]*?<\/figure>/u)?.[0] ?? '';
      for (const theme of ['dark', 'light']) expect(demo).toContain(`themed--${theme}`);
      for (const size of ['wide', 'narrow']) expect(demo).toContain(`demo__size--${size}`);
      // The CSP allows no inline style or script: the charts are attributes and classes only.
      expect(demo).not.toMatch(/style=|<style|<script/u);
      // Devices are what the worker reports (edge/contract.ts): a phone or a computer, nothing else.
      expect(demo).not.toMatch(/Tablet|Планшет/u);
      const title = html.match(/<title>([^<]*)<\/title>/u)![1]!;
      const description = html.match(/<meta name="description" content="([^"]*)"/u)![1]!.replaceAll('&#39;', "'");
      expect(title.length).toBeLessThanOrEqual(60);
      expect(description.length).toBeGreaterThanOrEqual(120);
      expect(description.length).toBeLessThanOrEqual(160);
    }
  });

  it('the menu’s pages: in the menu of every page, marked where they are; sign-up, lengths, nothing inline', () => {
    const tools = SITE_PAGES.filter((p) => p.nav);
    expect(tools.map((p) => p.slug)).toEqual(['/analytics', '/short-links', '/for-site-generators', '/pricing', '/faq']);
    for (const l of ['en', 'ru'] as const) {
      expect(read(fileFor('/', l))).toMatch(new RegExp(tools.map((p) => `href="${pathFor(p.slug, l)}"`).join('[\\s\\S]*'), 'u'));
      for (const p of tools) {
        const html = read(fileFor(p.slug, l));
        expect(html).toContain(`href="${pathFor(p.slug, l)}" aria-current="page"`);
        expect(html).toContain(`href="${authPathFor(l, 'register')}"`);
        // The CSP allows no inline style or script: none in the page's content, charts included.
        expect(html.match(/<main[\s\S]*?<\/main>/u)![0]).not.toMatch(/style=|<style|<script/u);
        expect(html.match(/<title>([^<]*)<\/title>/u)![1]!.length).toBeLessThanOrEqual(60);
        const description = html.match(/<meta name="description" content="([^"]*)"/u)![1]!.replaceAll('&#39;', "'");
        expect(description.length, `${l}${p.slug}`).toBeGreaterThanOrEqual(120);
        expect(description.length, `${l}${p.slug}`).toBeLessThanOrEqual(160);
      }
    }
  });

  it('internal links: every indexed page but the home page and the legal ones is linked from the text of another page of its language', () => {
    const mains = new Map<string, string>();
    for (const p of SITE_PAGES.filter((x) => x.indexed)) for (const l of p.locales) mains.set(pathFor(p.slug, l), read(fileFor(p.slug, l)).match(/<main[\s\S]*?<\/main>/u)![0]);
    for (const p of SITE_PAGES.filter((x) => x.indexed && !x.legal && x.slug !== '/'))
      for (const l of p.locales) {
        const target = pathFor(p.slug, l);
        const from = [...mains].filter(([path, main]) => path !== target && new RegExp(`href="${target}(#[^"]*)?"`, 'u').test(main)).map(([path]) => path);
        expect(from.length, target).toBeGreaterThan(0);
      }
    // Every link in a page's text to a page of the site leads to a page of the table in the same
    // language (the English-only agent docs aside), and a /faq#fragment to one of its groups.
    const groups = new Set([...read('faq.html').matchAll(/<section class="home-section faq-group" id="([^"]+)"/gu)].map((m) => m[1]));
    for (const [path, main] of mains) {
      const lang = path === '/ru' || path.startsWith('/ru/') ? 'ru' : 'en';
      for (const [, href, hash] of main.matchAll(/<a [^>]*?href="(\/[^"#?]*)(?:#([^"]*))?"/gu)) {
        if (/^\/(agents|api)$|\.(yaml|json|md)$|\/app$/u.test(href!)) continue;
        const page = SITE_PAGES.find((p) => p.locales.includes(lang) && pathFor(p.slug, lang) === href);
        expect(page, `${path} → ${href}`).toBeDefined();
        // A fragment: a group of /faq, or a form of the home page's sign-in card.
        if (hash) expect((groups.has(hash) && page!.slug === '/faq') || (['login', 'register', 'recover'].includes(hash) && page!.slug === '/'), `${path} → ${href}#${hash}`).toBe(true);
      }
    }
    // A tool page leads to its comparison and to its group on /faq.
    expect(mains.get('/analytics')).toContain('href="/plausible-alternative"');
    expect(mains.get('/ru/short-links')).toContain('href="/ru/clck-alternative"');
    expect(mains.get('/ru/analytics')).toContain('href="/ru/faq#analytics"');
  });

  it('how it works and the open source: in every footer of their language; lengths, nothing inline; the footer’s glyph leads to 301.st', () => {
    for (const l of ['en', 'ru'] as const) {
      const home = read(fileFor('/', l));
      for (const slug of ['/how-it-works', '/open-source']) {
        expect(home.match(/<footer[\s\S]*<\/footer>/u)![0]).toContain(`<a href="${pathFor(slug, l)}">`);
        const html = read(fileFor(slug, l));
        expect(html.match(/<main[\s\S]*?<\/main>/u)![0], `${l}${slug}`).not.toMatch(/style=|<style|<script/u);
        expect(html.match(/<title>([^<]*)<\/title>/u)![1]!.length, `${l}${slug}`).toBeLessThanOrEqual(60);
        const description = html.match(/<meta name="description" content="([^"]*)"/u)![1]!.replaceAll('&#39;', "'");
        expect(description.length, `${l}${slug}`).toBeGreaterThanOrEqual(120);
        expect(description.length, `${l}${slug}`).toBeLessThanOrEqual(160);
      }
      // The glyph opens the footer's first line; the Russian one leads to 301.ru, the parent's Russian site.
      const parent = l === 'en' ? '301.st' : '301.ru';
      expect(home).toContain(`<footer class="site-foot"><p><a class="site-foot__brand" href="https://${parent}" rel="noopener" aria-label="${parent}" title="${parent}"><svg class="icon" aria-hidden="true"><use href="/icons.svg#i-brand-301"></use></svg></a>`);
      // The only way to reach us: the parent's contact form, in the footer of the site and of the app.
      const contact = `<a href="https://${parent}/contact" rel="noopener">${l === 'en' ? 'Contact' : 'Связаться'}</a>`;
      for (const page of [home, read(fileFor('/app', l))]) expect(page.match(/<footer[\s\S]*<\/footer>/u)![0]).toContain(contact);
    }
    expect(fs.readFileSync('public/icons.svg', 'utf8')).toContain('<symbol id="i-brand-301"');
  });

  it('clx and 301.st, the parent: both languages, each linking its own site of 301 and closing with its banner', () => {
    for (const [l, parent] of [['en', '301.st'], ['ru', '301.ru']] as const) {
      expect(read(fileFor('/', l))).toContain(`<a href="${pathFor('/vs-301', l)}">${SITE_PAGES.find((p) => p.slug === '/vs-301')!.compare![l]}</a>`);
      const main = read(fileFor('/vs-301', l)).match(/<main[\s\S]*?<\/main>/u)![0];
      expect(main).toContain(`<a href="https://${parent}/pricing" rel="noopener">`);
      expect(main).not.toMatch(new RegExp(`https://${l === 'en' ? '301\\.ru' : '301\\.st'}`, 'u'));
      // One banner, 301's, shown: no rotation on its own page.
      expect([...main.matchAll(/data-promo/gu)]).toHaveLength(1);
      expect(main).toMatch(new RegExp(`<a class="promo promo--301" href="https://${parent.replace('.', '\\.')}/\\?utm_source=clx\\.cx&amp;utm_medium=banner&amp;utm_campaign=site" rel="noopener" data-promo>`, 'u'));
    }
  });

  it('the home page rotates the banners of our services: all in the page, the first shown, nothing inline', () => {
    for (const l of ['en', 'ru'] as const) {
      const slot = read(fileFor('/', l)).match(/<section class="home-section promo-slot">[\s\S]*?<\/section>/u)![0];
      const banners = [...slot.matchAll(/<a class="promo promo--(\w+)"[^>]*>/gu)];
      expect(banners.map((m) => m[1])).toEqual(['301', 'catchall', 'generator']);
      expect(banners.map((m) => m[0].includes(' hidden'))).toEqual([false, true, true]);
      expect(slot).not.toMatch(/style=|<style|<script/u);
    }
    expect(fs.readFileSync('public/site.js', 'utf8')).toContain('[data-promo]');
  });

  it('/short-links shows which rule took which clicks: a sankey of the example link in both themes, its ids apart', () => {
    for (const l of ['en', 'ru'] as const) {
      const html = read(fileFor('/short-links', l));
      const figure = html.match(/<figure class="demo flows-demo">[\s\S]*?<\/figure>/u)![0];
      expect([...figure.matchAll(/<div class="demo__chart themed--(\w+)">/gu)].map((m) => m[1])).toEqual(['dark', 'light']);
      expect([...figure.matchAll(/class="cx-node"/gu)]).toHaveLength(2 * (4 + 3));
      const ids = [...html.matchAll(/\bid="([^"]+)"/gu)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
      // The same 3,440 clicks as the example's countries; rule 1 is Germany and Austria.
      expect(figure).toMatch(/>1[,\s]370 · 40%</u);
      expect(figure).not.toMatch(/style=|<script/u);
    }
  });

  it('the closing call to sign up is clx’s own banner: its mark, a heading, one link to sign-up, out of the rotation', () => {
    const mark = fs.readFileSync('public/favicon.svg', 'utf8').trim();
    for (const slug of ['/', '/analytics', '/faq', '/pricing', '/vs-301', '/bitly-alternative', '/clck-alternative'])
      for (const l of SITE_PAGES.find((p) => p.slug === slug)!.locales) {
        const html = read(fileFor(slug, l));
        expect(html).not.toContain('home-final');
        const slot = html.match(/<section class="home-section final-slot">[\s\S]*?<\/section>/u)![0];
        expect(slot).toContain('<div class="promo promo--clx">');
        expect(slot).toContain(`<span class="promo__mark" aria-hidden="true">${mark}</span>`);
        expect(slot).toMatch(/<h2 class="promo__title">[^<]+<\/h2>/u);
        expect([...slot.matchAll(/<a /gu)]).toHaveLength(1);
        expect(slot).toContain(`<a class="promo__cta" href="${authPathFor(l, 'register')}">`);
        expect(slot).not.toMatch(/data-promo|style=|<script/u);
      }
  });

  it('the comparison pages: in their language’s footer only; clx’s bar highlighted; sources linked; lengths, nothing inline', () => {
    const pages = SITE_PAGES.filter((p) => p.compare && p.locales.length === 1);
    expect(pages.map((p) => `${p.locales.join()}${p.slug}`)).toEqual(['en/bitly-alternative', 'en/plausible-alternative', 'ru/clck-alternative', 'ru/liveinternet-alternative']);
    for (const p of pages) {
      const l = p.locales[0]!;
      const other = l === 'en' ? 'ru' : 'en';
      expect(read(fileFor('/', l))).toContain(`<a href="${pathFor(p.slug, l)}">${p.compare![l]}</a>`);
      expect(read(fileFor('/', other))).not.toContain(p.slug);
      const html = read(fileFor(p.slug, l));
      const main = html.match(/<main[\s\S]*?<\/main>/u)![0];
      expect(main, p.slug).not.toMatch(/style=|<style|<script/u);
      expect(main).toContain(`href="${authPathFor(l, 'register')}"`);
      // Every chart in both themes; in each, at most one bar in the brand colour (clx’s; none at $0).
      const charts = [...main.matchAll(/<div class="demo__chart themed--(dark|light)">([\s\S]*?)<\/svg><\/div>/gu)];
      expect(charts.length, p.slug).toBeGreaterThanOrEqual(2);
      expect(charts.length % 2).toBe(0);
      // Both themes' copies are in the page at once: no id may repeat.
      const ids = [...html.matchAll(/\sid="([^"]+)"/gu)].map((m) => m[1]);
      expect(ids.length, p.slug).toBe(new Set(ids).size);
      // The first row of every chart is clx.
      for (const [, , svg] of charts) expect(svg!.match(/<title[^>]*>([^<:]+):/u)?.[1], p.slug).toMatch(/^clx/u);
      // Only clx's row may be in the brand colour, and its bar is, when it has one (none at $0).
      for (const [, , svg] of charts) {
        const [, first, ...rest] = svg!.split('<g>');
        expect(first, p.slug).not.toContain('cx-bar-muted');
        expect(rest.join(''), p.slug).not.toContain('class="cx-bar"');
      }
      // The sources: the other service's pages as addresses in brackets, never a link to it.
      expect(main).toMatch(/<li>[^<]+ \([a-z0-9.-]+\.[a-z]+[^)<]*\)<\/li>/u);
      expect(main).not.toMatch(/<a href="https?:/u);
      expect(main.match(/compare__sources[\s\S]*?<\/ul>/u)![0]).toContain(`<a href="${pathFor('/pricing', l)}">`);
      expect(html.match(/<title>([^<]*)<\/title>/u)![1]!.length, p.slug).toBeLessThanOrEqual(60);
      const description = html.match(/<meta name="description" content="([^"]*)"/u)![1]!.replaceAll('&#39;', "'");
      expect(description.length, p.slug).toBeGreaterThanOrEqual(120);
      expect(description.length, p.slug).toBeLessThanOrEqual(160);
    }
  });

  it('the home page leads from its plans to /pricing and from its questions to /faq, not only through the menu', () => {
    for (const l of ['en', 'ru'] as const) {
      const main = read(fileFor('/', l)).match(/<main[\s\S]*?<\/main>/u)![0];
      for (const slug of ['/pricing', '/faq']) expect(main, `${l} ${slug}`).toMatch(new RegExp(`<a href="${pathFor(slug, l)}">[^<]+ →</a>`, 'u'));
    }
  });

  it('every indexed page: Open Graph and the Twitter card, and JSON-LD of its kind', () => {
    const graph = (html: string) => (JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)![1]!) as { '@graph': { '@type': string; mainEntity?: unknown[] }[] })['@graph'];
    for (const p of SITE_PAGES.filter((x) => x.indexed))
      for (const l of p.locales) {
        const html = read(fileFor(p.slug, l));
        const head = html.match(/<head>[\s\S]*?<\/head>/u)![0];
        expect(head, `${l}${p.slug}`).toContain(`<meta property="og:url" content="${urlFor(p.slug, l)}" />`);
        expect(head).toContain(`<meta property="og:image" content="https://clx.cx${ogImagePath(p.slug, l)}" />`);
        expect(head).toContain('<meta name="twitter:card" content="summary_large_image" />');
        expect(head).toMatch(/<meta property="og:title" content="[^"]+" \/>/u);
        const types = graph(head).map((n) => n['@type']);
        if (p.slug === '/') expect(types).toEqual(['Organization', 'WebSite', 'SoftwareApplication']);
        else expect(types[0]).toBe('BreadcrumbList');
        if (p.slug === '/faq') {
          const faq = graph(head).find((n) => n['@type'] === 'FAQPage')!;
          expect(faq.mainEntity!.length).toBe([...html.matchAll(/<summary>/gu)].length);
        }
      }
    expect(read('404.html')).not.toContain('og:image');
  });

  it('/faq holds every page’s questions, word for word, each group linking to its page', () => {
    for (const l of ['en', 'ru'] as const) {
      const faq = read(fileFor('/faq', l));
      for (const slug of ['/', '/analytics', '/short-links', '/for-site-generators', '/pricing']) {
        const page = read(fileFor(slug, l));
        const questions = [...page.matchAll(/<summary>([^<]*)<\/summary>/gu)].map((m) => m[1]!);
        expect(questions.length, `${l}${slug}`).toBeGreaterThan(2);
        for (const q of questions) expect(faq, `${l}${slug}: ${q}`).toContain(`<summary>${q}</summary>`);
        expect(faq).toContain(`<h2><a href="${pathFor(slug, l)}">`);
      }
    }
  });

  it('the menu: beside the brand, its button last in the header; only a page marked js folds it on a phone', () => {
    const html = read('analytics.html');
    const header = html.match(/<header[\s\S]*?<\/header>/u)![0];
    expect(header.indexOf('id="site-nav"')).toBeLessThan(header.indexOf('id="theme"'));
    expect(header.indexOf('id="site-nav-toggle"')).toBeGreaterThan(header.indexOf('href="/app"'));
    expect(header).toMatch(/id="site-nav-toggle" aria-controls="site-nav" aria-expanded="false"/u);
    // Folded only under .js (public/theme.js marks the page): without scripts the links stay a row.
    // Every rule that hides the menu (the source, ui/css/app.css) is a .js one.
    const css = fs.readFileSync('ui/css/app.css', 'utf8');
    const hiding = [...css.matchAll(/([^{}]*)\{[^}]*\bdisplay:none/gu)].map((m) => m[1]!.trim()).filter((sel) => /\.site-nav(?![\w-])/u.test(sel));
    expect(hiding).toEqual(['.js .site-nav']);
  });

  it('site.js shows exactly the banner chance picks — the first, the middle, the last, and a lone one', () => {
    const run = (count: number, random: number) => {
      const banners = Array.from({ length: count }, (_, i) => ({ hidden: i > 0 }));
      const slot = { querySelectorAll: (sel: string) => (sel === '[data-promo]' ? banners : []) };
      const document = { querySelector: () => null, querySelectorAll: (sel: string) => (sel === '.promo-slot' ? [slot] : []) };
      const math = Object.create(Math) as Math;
      math.random = () => random;
      vm.runInNewContext(read('site.js'), { document, location: { pathname: '/', hash: '' }, Math: math });
      return banners.map((b) => (b.hidden ? 0 : 1));
    };
    expect(run(3, 0)).toEqual([1, 0, 0]);
    expect(run(3, 0.5)).toEqual([0, 1, 0]);
    expect(run(3, 0.99)).toEqual([0, 0, 1]);
    expect(run(1, 0.7)).toEqual([1]);
  });

  /** site.js on a stand-in of the home page's card (site/auth.ts): what it shows, sends and opens. */
  async function cardStand(opts: { hash: string; sitekey: string | null; configFailures?: number; search?: string }) {
    let failures = opts.configFailures ?? 0;
    const el = (attrs: Record<string, string> = {}) => ({
      hidden: true,
      disabled: false,
      value: '',
      textContent: '',
      dataset: { ...attrs } as Record<string, string>,
      attrs: new Map<string, string>(),
      setAttribute(k: string, v: string) {
        this.attrs.set(k, v);
      },
      removeAttribute(k: string) {
        this.attrs.delete(k);
      },
      addEventListener: () => {},
      focus: () => {},
    });
    const form = (kind: string) => {
      const f = Object.assign(el({ authForm: kind }), { msg: el(), button: el(), fields: { email: el(), password: el() } as Record<string, ReturnType<typeof el>>, onSubmit: (_e: unknown) => Promise.resolve() });
      return Object.assign(f, {
        addEventListener: (type: string, fn: (e: unknown) => Promise<void>) => type === 'submit' && (f.onSubmit = fn),
        querySelector: (sel: string) => (sel === '[data-msg]' ? f.msg : sel === '[type=submit]' ? f.button : sel === 'input[name=email]' ? f.fields.email : sel === 'input[name=password]' ? f.fields.password : sel === '[data-turnstile]' ? el() : null),
        reset: () => Object.values(f.fields).forEach((x) => (x.value = '')),
        submit: () => f.onSubmit({ preventDefault: () => {} }),
      });
    };
    const forms = ['login', 'register', 'recover'].map(form);
    const tabs = ['login', 'register'].map((k) => el({ tab: k }));
    const texts = { closed: { register: 'closed', recover: 'closed' }, waitHuman: 'wait', signedUp: 'sent {email}', signedUpNext: 'next', errors: {} };
    const card = Object.assign(el({ t: JSON.stringify(texts), app: '/app' }), { querySelectorAll: (sel: string) => (sel === '[data-auth-form]' ? forms : sel === '[data-tab]' ? tabs : []) });
    const classes = new Set<string>();
    const landing = { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) } };
    const state = { onHash: () => {}, posts: [] as [string, unknown][], assigned: [] as string[], resets: 0, human: (_t: string) => {} };
    const location = { pathname: '/', hash: opts.hash, search: opts.search ?? '', assign: (to: string) => state.assigned.push(to) };
    const langs = ['/', '/ru'].map((href) => ({ href, dataset: {} as Record<string, string>, getAttribute: () => href }));
    const document = { documentElement: { lang: 'ru' }, querySelector: (sel: string) => (sel === '[data-auth]' ? card : sel === '[data-landing]' ? landing : null), querySelectorAll: (sel: string) => (sel === '#lang-dd a[data-locale]' ? langs : []) };
    const turnstile = { render: (_el: unknown, o: { callback: (t: string) => void }) => ((state.human = o.callback), 'w1'), reset: () => state.resets++ };
    const window = { turnstile, addEventListener: (type: string, fn: () => void) => type === 'hashchange' && (state.onHash = fn) };
    const fetch = async (url: string, init?: { body: string }) => {
      if (url === '/auth/config') return failures-- > 0 ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ turnstile_site_key: opts.sitekey }) };
      state.posts.push([url, JSON.parse(init!.body)]);
      return { ok: true, status: 200, json: async () => ({}) };
    };
    vm.runInNewContext(read('site.js'), { document, window, location, fetch, Math, JSON, Array, Map, Set, Promise, String, Number, Object, URLSearchParams });
    const settle = () => new Promise((r) => setTimeout(r, 0));
    return {
      card, forms, tabs, classes, location, settle, langs,
      onHash: () => state.onHash(),
      get posts() { return state.posts; },
      get assigned() { return state.assigned; },
      get resets() { return state.resets; },
      set token(v: string) { if (v) state.human(v); },
    };
  }

  it('site.js shows the card’s form the fragment names, and none without one; the hero makes room for it', async () => {
    const run = await cardStand({ hash: '#register', sitekey: null });
    const { card, forms, tabs, classes, location } = run;
    const shown = () => [card.hidden, ...forms.map((f) => f.hidden), classes.has('landing--auth')];
    expect(shown()).toEqual([false, true, false, true, true]);
    expect(tabs.map((t) => t.attrs.get('aria-current') ?? null)).toEqual([null, 'page']);
    // Without a Turnstile key the server refuses sign-up: the form says so and cannot be sent.
    await run.settle();
    expect([forms[1]!.msg.textContent, forms[1]!.button.disabled]).toEqual(['closed', true]);
    location.hash = '#login';
    run.onHash();
    expect(shown()).toEqual([false, false, true, true, true]);
    location.hash = '#/confirm?t=x'; // not a form of the card: it stays hidden
    run.onHash();
    expect(shown()).toEqual([true, true, true, true, false]);
  });

  it('site.js sends the card’s forms to /auth: sign-in leads to the app; sign-up carries the page’s language and the Turnstile token', async () => {
    const run = await cardStand({ hash: '#login', sitekey: 'key' });
    const [login, register] = run.forms;
    login!.fields.email!.value = 'a@b.c';
    login!.fields.password!.value = 'pass-word-1';
    const sent = login!.submit();
    expect(login!.button.disabled).toBe(true); // a second click waits
    await sent;
    expect(run.posts.shift()).toEqual(['/auth/login', { email: 'a@b.c', password: 'pass-word-1' }]);
    expect(run.assigned).toEqual(['/app#/']);
    // Sign-up: nothing goes before the human check; then the token, the language, and a fresh check.
    run.location.hash = '#register';
    run.onHash();
    register!.fields.email!.value = ' new@b.c ';
    register!.fields.password!.value = 'a-long-password';
    run.token = '';
    await run.settle();
    await register!.submit();
    expect([run.posts.length, register!.msg.textContent]).toEqual([0, 'wait']);
    run.token = 'tok';
    await register!.submit();
    expect(run.posts.shift()).toEqual(['/auth/signup', { email: ' new@b.c ', password: 'a-long-password', turnstile: 'tok', locale: 'ru' }]);
    expect([register!.msg.dataset.type, register!.msg.textContent, run.resets]).toEqual(['success', 'sent new@b.c next', 1]);
  });

  it('site.js: sign-in comes back to the app page that sent here (?next=), and only to an app page', async () => {
    const signIn = async (search: string) => {
      const run = await cardStand({ hash: '#login', sitekey: 'key', search });
      await run.forms[0]!.submit();
      return run.assigned[0];
    };
    expect(await signIn('?next=%2Fsites%2Fs_1%2Freport%3Fp%3D7d')).toBe('/app#/sites/s_1/report?p=7d');
    // Not an app route: the app's first page, never another address.
    for (const bad of ['?next=%2F%2Fevil.example', '?next=https%3A%2F%2Fevil.example', '?next=%2Fa%23b', '?next=sites', '']) expect(await signIn(bad)).toBe('/app#/');
  });

  it('the app, signed out, sends a deep link to the card with the way back; the root needs none', () => {
    expect(signInPath('/', '#/sites/s_1/report?p=7d')).toBe('/?next=%2Fsites%2Fs_1%2Freport%3Fp%3D7d#login');
    expect(signInPath('/ru', '#/links')).toBe('/ru?next=%2Flinks#login');
    for (const root of ['', '#', '#/']) expect(signInPath('/', root)).toBe('/#login');
    // What one side writes, the other reads back.
    const back = new URL(signInPath('/', '#/sites/s_1/report?p=7d'), 'https://clx.cx');
    expect(nextRoute(back.search)).toBe('/sites/s_1/report?p=7d');
  });

  it('site.js: the language switch opens the same form, with the way back, in the other language', async () => {
    const run = await cardStand({ hash: '#login', sitekey: 'key', search: '?next=%2Fsites' });
    expect(run.langs.map((a) => a.href)).toEqual(['/?next=%2Fsites#login', '/ru?next=%2Fsites#login']);
    run.location.hash = '';
    run.onHash();
    expect(run.langs.map((a) => a.href)).toEqual(['/', '/ru']);
  });

  it('site.js: a failed /auth/config is not "closed" — the form stays usable and the next visit asks again', async () => {
    const run = await cardStand({ hash: '#register', sitekey: 'key', configFailures: 1 });
    const register = run.forms[1]!;
    await run.settle();
    expect([register.msg.textContent, register.button.disabled]).toEqual(['', false]);
    run.location.hash = '#login';
    run.onHash();
    run.location.hash = '#register';
    run.onHash();
    await run.settle();
    register.fields.email!.value = 'x@y.z';
    register.fields.password!.value = 'a-long-password';
    run.token = 'tok';
    await register.submit();
    expect(run.posts.map(([url]) => url)).toEqual(['/auth/signup']);
  });

  it('theme.js marks the page and opens the menu: false → true → false, focus into the menu', () => {
    // A stand-in for the few DOM calls theme.js makes; the vitest suite runs in node, without a DOM.
    let click: ((e: { target: unknown }) => void) | undefined;
    const classes = new Set<string>();
    const attrs = new Map<string, string>([['aria-expanded', 'false']]);
    let navOpen = false;
    let focused = false;
    const button = { getAttribute: (k: string) => attrs.get(k) ?? null, setAttribute: (k: string, v: string) => attrs.set(k, v), closest: (sel: string) => (sel === '#site-nav-toggle' ? button : null) };
    class Element {}
    Object.setPrototypeOf(button, Element.prototype);
    const nav = { toggleAttribute: (_k: string, on: boolean) => (navOpen = on), querySelector: () => ({ focus: () => (focused = true) }) };
    const document = {
      documentElement: { classList: { add: (c: string) => classes.add(c) }, dataset: {} },
      addEventListener: (type: string, fn: (e: { target: unknown }) => void) => type === 'click' && (click = fn),
      getElementById: (id: string) => (id === 'site-nav' ? nav : null),
    };
    vm.runInNewContext(read('theme.js'), { document, Element, localStorage: { getItem: () => null } });
    expect(classes.has('js')).toBe(true);
    click!({ target: button });
    expect([attrs.get('aria-expanded'), navOpen, focused]).toEqual(['true', true, true]);
    click!({ target: button });
    expect([attrs.get('aria-expanded'), navOpen]).toEqual(['false', false]);
    click!({ target: {} }); // a click elsewhere changes nothing
    expect(attrs.get('aria-expanded')).toBe('false');
  });

  it('theme.js switches the theme from the header’s button, on the site and in the app alike', () => {
    let click: ((e: { target: unknown }) => void) | undefined;
    const stored = new Map<string, string>();
    class Element {}
    const theme = Object.assign(Object.create(Element.prototype) as object, { closest: (sel: string) => (sel === '#theme' ? theme : null) });
    const dataset: Record<string, string> = { theme: 'dark' };
    // The language switch, open: a click elsewhere (the theme button) closes it.
    const langDd: { open: boolean; contains: (x: unknown) => boolean; closest: () => null } = Object.assign(Object.create(Element.prototype) as object, { open: true, contains: (x: unknown) => x === langDd, closest: () => null });
    const document = {
      documentElement: { classList: { add: () => {} }, dataset },
      getElementById: (id: string) => (id === 'lang-dd' ? langDd : null),
      addEventListener: (type: string, fn: typeof click) => type === 'click' && (click = fn),
    };
    vm.runInNewContext(read('theme.js'), { document, Element, localStorage: { getItem: () => null, setItem: (k: string, v: string) => stored.set(k, v) } });
    click!({ target: langDd });
    expect(langDd.open).toBe(true);
    click!({ target: theme });
    expect([dataset.theme, stored.get('clx-theme'), langDd.open]).toEqual(['light', 'light', false]);
    click!({ target: theme });
    expect(dataset.theme).toBe('dark');
  });

  it('the language switch: a flag and the code, a menu of the page’s languages; none on a page of one language', () => {
    const header = (f: string) => read(f).match(/<header[\s\S]*?<\/header>/u)![0];
    const ru = header('ru/analytics.html');
    expect(ru).toMatch(/<details class="lang-dd" id="lang-dd"><summary class="lang-dd__btn" aria-label="Язык: Русский"><span class="lang-dd__flag" aria-hidden="true"><svg [^>]*>[\s\S]*?<\/svg><\/span>RU<\/summary>/u);
    expect([...ru.matchAll(/<a class="lang-dd__item" href="([^"]+)"[^>]*data-locale="(\w+)"([^>]*)>/gu)].map((m) => [m[1], m[2], m[3]!.includes('aria-current')])).toEqual([
      ['/analytics', 'en', false],
      ['/ru/analytics', 'ru', true],
    ]);
    expect(header('bitly-alternative.html')).not.toContain('lang-dd');
    expect(ru).not.toMatch(/style=|<script/u);
  });

  it('the footer has no link to /abuse: clx.cx carries no one’s traffic to complain about; the page stays', () => {
    for (const f of ['index.html', 'ru.html', 'ru/app.html']) expect(read(f).match(/<footer[\s\S]*?<\/footer>/u)![0]).not.toContain('abuse');
    expect(read('abuse.html')).toContain('<link rel="canonical" href="https://clx.cx/abuse" />');
  });

  it('the example link’s QR code is the one the app would make for its address', () => {
    const svg = read('short-links.html').match(/<div class="link-card__qr">(<svg[\s\S]*?<\/svg>)/u)![1]!;
    const drawn = new Set([...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/gu)].map((m) => `${Number(m[1]) - 4},${Number(m[2]) - 4}`));
    const { data } = generateMatrix('https://k7q.example.com/spring?q', { ecc: 'M' });
    const expected = new Set(data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`${x},${y}`] : []))));
    expect(drawn.size).toBeGreaterThan(100);
    expect([...drawn].sort()).toEqual([...expected].sort());
  });

  it('the app has a page per language, which sets the language until sign-in (ADR 0015)', () => {
    expect(read('app.html')).toContain('<html lang="en"');
    expect(read('ru/app.html')).toContain('<html lang="ru"');
  });

  it('the app keeps the site’s header and footer in its language, without the link to itself; its language switch leads to the app', () => {
    const app = read('ru/app.html');
    const header = app.match(/<header[\s\S]*?<\/header>/u)![0];
    expect(header).toContain('href="/ru/analytics"');
    expect(header).toContain('id="site-nav-toggle"');
    expect(header).toContain('id="theme"');
    expect(header).not.toContain('when-signed-out');
    expect([...header.matchAll(/<a class="lang-dd__item" href="([^"]+)"/gu)].map((m) => m[1])).toEqual(['/app', '/ru/app']);
    expect(app).toContain('<div class="app-nav" id="shell"></div>');
    expect(app).toContain('<footer class="site-foot">');
    expect(app).toContain('href="/ru/privacy"');
  });

  it('the header signs in on the home page’s card, or leads to the app; the page shows one by the mark theme.js sets', () => {
    const header = read('ru/analytics.html').match(/<header[\s\S]*?<\/header>/u)![0];
    expect(header).toContain('<a class="btn btn--ghost btn--sm when-signed-out" href="/ru#login">Войти</a><a class="btn btn--ghost btn--sm when-signed-in" href="/ru/app">Кабинет</a>');
    const marked = (stored: string | null) => {
      const classes = new Set<string>();
      const document = { documentElement: { classList: { add: (c: string) => classes.add(c) }, dataset: {} }, addEventListener: () => {} };
      vm.runInNewContext(read('theme.js'), { document, Element: class {}, localStorage: { getItem: (k: string) => (k === 'clx-signed-in' ? stored : null) } });
      return classes.has('signed-in');
    };
    expect([marked('1'), marked(null)]).toEqual([true, false]);
  });

  it('the sitemap names its view for a person in a processing instruction; a <url> holds only what search engines know', () => {
    const sitemap = read('sitemap.xml');
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<urlset ')).toBe(true);
    // Google reported <xhtml:script> in a <url> as an error (11.10.2026).
    const tags = new Set([...sitemap.matchAll(/<\/?([\w:]+)/gu)].map((m) => m[1]));
    expect([...tags].sort()).toEqual(['changefreq', 'loc', 'priority', 'url', 'urlset', 'xhtml:link']);
    // The view: one stylesheet, the site's own files only.
    const xsl = read('sitemap.xsl');
    expect(xsl).toContain('<xsl:output method="html"');
    expect([...xsl.matchAll(/(?:href|src)="(\/[^"#]*)/gu)].map((m) => m[1])).toEqual(['/favicon.svg', '/app.css', '/theme.js', '/', '/icons.svg']);
  });

  it('robots.txt keeps crawlers off the app and the API; the sitemap lists indexed pages only', () => {
    const robots = read('robots.txt');
    // `$` ends the rule at /app: a prefix rule would also keep crawlers off /app.css, which the site loads.
    for (const p of ['/app$', '/ru/app$', '/v1/', '/auth/', '/admin/', '/hook/']) expect(robots).toContain(`Disallow: ${p}\n`);
    const sitemap = read('sitemap.xml');
    expect(sitemap).toContain('<loc>https://clx.cx/ru/terms</loc>');
    expect(sitemap).not.toContain('404');
    // Every indexed page × language is listed; a Russian-only page has itself as its one alternate.
    for (const p of SITE_PAGES.filter((x) => x.indexed)) for (const l of p.locales) expect(sitemap).toContain(`<loc>${urlFor(p.slug, l)}</loc>`);
    const clck = sitemap.match(/<url>\n {4}<loc>https:\/\/clx\.cx\/ru\/clck-alternative<\/loc>[\s\S]*?<\/url>/u)![0];
    expect(clck).toContain('hreflang="ru" href="https://clx.cx/ru/clck-alternative"');
    expect(clck).not.toContain('x-default');
    expect(robots).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes\n');
  });

  it('/api lists every operation of docs/openapi.yaml', () => {
    const api = read('api.html');
    const yaml = fs.readFileSync('docs/openapi.yaml', 'utf8').split(/\r?\n/u);
    let route = '';
    let n = 0;
    for (const line of yaml.slice(yaml.indexOf('paths:') + 1)) {
      const p = line.match(/^ {2}(\/\S+):$/u);
      const m = line.match(/^ {4}(get|post|put|patch|delete):/u);
      if (p) route = p[1]!;
      else if (m) {
        n++;
        expect(api).toContain(`<code>${m[1]!.toUpperCase()} ${route}</code>`);
      }
    }
    expect(n).toBeGreaterThan(20);
    expect(JSON.parse(read('openapi.json')).paths['/v1/sites']).toBeDefined();
  });

  it('the files for agents: markdown copies, the catalog, the skill and its index', () => {
    expect(read('agents.md')).toMatch(/^# clx for AI agents\n/u);
    expect(read('api.md')).toContain('### `POST /v1/sites`');
    expect(read('index.md')).toBe(read('llms.txt'));
    expect(read('auth.md')).toMatch(/^# clx auth\.md\n/u);
    expect(read('.well-known/auth.md')).toBe(read('auth.md'));
    const catalog = JSON.parse(read('.well-known/api-catalog'));
    expect(catalog.linkset[0].anchor).toBe('https://clx.cx/v1');
    expect(catalog.linkset[0]['service-desc'][0].href).toBe('https://clx.cx/openapi.json');
    const [skill] = JSON.parse(read('.well-known/agent-skills/index.json')).skills;
    expect(skill.name).toBe('clx-sites');
    expect(read(skill.url.slice(1))).toMatch(/^---\nname: clx-sites\ndescription: .+\n---\n/u);
  });

  it('the MCP server card, at both paths in use, names the live server; the catalog and llms.txt point to it', () => {
    const card = JSON.parse(read('.well-known/mcp/server-card.json'));
    expect(read('.well-known/mcp/server-cards.json')).toBe(read('.well-known/mcp/server-card.json'));
    expect(card).toMatchObject({ name: 'cx.clx/mcp', url: 'https://clx.cx/mcp', transport: 'streamable-http', serverInfo: { name: 'clx' }, protocolVersions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] });
    expect(card.servers[0].remotes[0]).toMatchObject({ type: 'streamable-http', url: 'https://clx.cx/mcp', headers: [{ name: 'Authorization', isSecret: true }] });
    // The registry caps a summary at 100 characters.
    expect(card.servers[0].summary.length).toBeLessThanOrEqual(100);
    const catalog = JSON.parse(read('.well-known/api-catalog'));
    expect(catalog.linkset[1]).toMatchObject({ anchor: 'https://clx.cx/mcp', 'service-desc': [{ href: 'https://clx.cx/.well-known/mcp/server-card.json' }] });
    expect(read('llms.txt')).toContain('(https://clx.cx/mcp)');
    expect(read('agents.md')).toContain('claude mcp add --transport http clx https://clx.cx/mcp');
  });

  it('the Russian footer links the English-only agent docs in English', () => {
    expect(read('ru.html')).toContain('<a href="/agents" hreflang="en">');
    expect(read('agents.html')).not.toContain('hreflang="ru"');
  });
});

describe('the Russian host (ADR 0030)', () => {
  // A build with the host on, into folders of its own: public/ and the real build are not touched.
  const main = 'temp/site-test-main';
  const ru = 'temp/site-test-ru';
  const read = (dir: string, f: string) => fs.readFileSync(`${dir}/${f}`, 'utf8');
  beforeAll(() => {
    for (const d of [main, ru]) fs.rmSync(d, { recursive: true, force: true });
    execFileSync(process.execPath, ['site/build.ts'], { stdio: 'pipe', env: { ...process.env, CLX_RU_ORIGIN: 'https://ru.clx.cx', CLX_SITE_OUT: main, CLX_RU_OUT: ru } });
  });
  afterAll(() => {
    for (const d of [main, ru]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('Russian pages live on their host without /ru; links there are paths, to clx.cx whole URLs', () => {
    const home = read(ru, 'index.html');
    expect(home).toContain('<link rel="canonical" href="https://ru.clx.cx/" />');
    expect(home).toContain('<meta http-equiv="Content-Security-Policy"');
    // No sign-in card: the bot first, then sign-up and sign-in on clx.cx.
    expect(home).not.toContain('data-auth');
    expect(home).toMatch(/href="https:\/\/t\.me\/clxcxbot"[^]*href="https:\/\/clx\.cx\/ru#register"[^]*href="https:\/\/clx\.cx\/ru#login"/u);
    const pricing = read(ru, 'pricing.html');
    expect(pricing).toContain('<link rel="canonical" href="https://ru.clx.cx/pricing" />');
    expect(pricing).toContain('href="/faq"');
    expect(pricing).toContain('href="https://clx.cx/agents" hreflang="en"');
    expect(pricing).not.toMatch(/href="\/ru[/"#]/u);
    expect(read(ru, 'terms.html')).toContain('<a href="/abuse">');
    expect(fs.existsSync(`${ru}/ru`)).toBe(false);
    expect(read(ru, 'CNAME')).toBe('ru.clx.cx\n');
  });

  it('clx.cx keeps the Russian home page for its sign-in card, unindexed, and sends the rest there', () => {
    const stub = read(main, 'ru.html');
    expect(stub).toContain('<meta name="robots" content="noindex" />');
    expect(stub).toContain('<link rel="canonical" href="https://ru.clx.cx/" />');
    expect(stub).toContain('data-auth');
    expect(fs.existsSync(`${main}/ru/pricing.html`)).toBe(false);
    expect(fs.existsSync(`${main}/ru/app.html`)).toBe(true);
    expect(read(main, '_redirects')).toContain('/ru/pricing https://ru.clx.cx/pricing 301\n');
    expect(read(main, '_redirects')).not.toMatch(/^\/ru(\/app)? /mu);
    // Each host's sitemap lists its own pages; the alternates cross over.
    expect(read(main, 'sitemap.xml')).not.toContain('<loc>https://ru.clx.cx');
    expect(read(main, 'sitemap.xml')).toContain('hreflang="ru" href="https://ru.clx.cx/pricing"');
    expect(read(ru, 'sitemap.xml')).toContain('<loc>https://ru.clx.cx/pricing</loc>');
    expect(read(ru, 'sitemap.xml')).not.toContain('<loc>https://clx.cx');
    expect(read(main, 'pricing.html')).toContain('hreflang="ru" href="https://ru.clx.cx/pricing"');
  });
});
