// The site's addresses and pages (site/, docs/spec.md §16): one table, one URL function, and what
// the generator prints from them.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { SITE_PAGES } from '../site/pages.ts';
import { generateMatrix } from '../src/qr/generate';
import { alternatesFor, fileFor, pathFor, urlFor } from '../site/urls.ts';

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

  it('every page of the table, in its languages, with canonical and hreflang; the 404 is noindex', () => {
    for (const p of SITE_PAGES)
      for (const l of p.locales) {
        const html = read(fileFor(p.slug, l));
        expect(html).toContain(`<html lang="${l}"`);
        if (p.indexed) {
          expect(html).toContain(`<link rel="canonical" href="${urlFor(p.slug, l)}" />`);
          expect(html).toContain(`hreflang="x-default" href="${urlFor(p.slug, 'en')}"`);
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
      expect(html).toContain(`href="${app}#/signup"`);
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
        expect(html).toContain(`#/signup"`);
        // The CSP allows no inline style or script: none in the page's content, charts included.
        expect(html.match(/<main[\s\S]*?<\/main>/u)![0]).not.toMatch(/style=|<style|<script/u);
        expect(html.match(/<title>([^<]*)<\/title>/u)![1]!.length).toBeLessThanOrEqual(60);
        const description = html.match(/<meta name="description" content="([^"]*)"/u)![1]!.replaceAll('&#39;', "'");
        expect(description.length, `${l}${p.slug}`).toBeGreaterThanOrEqual(120);
        expect(description.length, `${l}${p.slug}`).toBeLessThanOrEqual(160);
      }
    }
  });

  it('the home page leads from its plans to /pricing and from its questions to /faq, not only through the menu', () => {
    for (const l of ['en', 'ru'] as const) {
      const main = read(fileFor('/', l)).match(/<main[\s\S]*?<\/main>/u)![0];
      for (const slug of ['/pricing', '/faq']) expect(main, `${l} ${slug}`).toMatch(new RegExp(`<a href="${pathFor(slug, l)}">[^<]+ →</a>`, 'u'));
    }
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

  it('the example link’s QR code is the one the app would make for its address', () => {
    const svg = read('short-links.html').match(/<div class="link-card__qr">(<svg[\s\S]*?<\/svg>)/u)![1]!;
    const drawn = new Set([...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/gu)].map((m) => `${Number(m[1]) - 4},${Number(m[2]) - 4}`));
    const { data } = generateMatrix('https://go.example.com/spring?q', { ecc: 'M' });
    const expected = new Set(data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`${x},${y}`] : []))));
    expect(drawn.size).toBeGreaterThan(100);
    expect([...drawn].sort()).toEqual([...expected].sort());
  });

  it('the app has a page per language, which sets the language until sign-in (ADR 0015)', () => {
    expect(read('app.html')).toContain('<html lang="en"');
    expect(read('ru/app.html')).toContain('<html lang="ru"');
  });

  it('robots.txt keeps crawlers off the app and the API; the sitemap lists indexed pages only', () => {
    const robots = read('robots.txt');
    // `$` ends the rule at /app: a prefix rule would also keep crawlers off /app.css, which the site loads.
    for (const p of ['/app$', '/ru/app$', '/v1/', '/auth/', '/admin/', '/hook/']) expect(robots).toContain(`Disallow: ${p}\n`);
    const sitemap = read('sitemap.xml');
    expect(sitemap).toContain('<loc>https://clx.cx/ru/terms</loc>');
    expect(sitemap).not.toContain('404');
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

  it('the Russian footer links the English-only agent docs in English', () => {
    expect(read('ru.html')).toContain('<a href="/agents" hreflang="en">');
    expect(read('agents.html')).not.toContain('hreflang="ru"');
  });
});
