// Banners of our other services, after wpps.ru's (its src/templates/promo.ts): every banner is in the
// page, the first shown without scripts; /site.js shows one of them at random (site/client.ts) —
// the CSP allows no inline script. The words are the services' own, from their pages; a Russian page
// links to a service's Russian site. 301.st is clx's parent: its Russian site is 301.ru.
import fs from 'node:fs';
import path from 'node:path';
import { STRINGS } from './i18n.ts';
import { escapeHtml } from './layout.ts';
import type { Locale } from './pages.ts';
import { appPathFor } from './urls.ts';

const logo = (file: string) => fs.readFileSync(path.join(import.meta.dirname, 'brand', 'promo', file), 'utf8').trim();

interface PromoCopy {
  eyebrow?: string;
  title: string;
  text: string;
  cta: string;
}

interface Promo {
  id: string;
  logo: string;
  url: Record<Locale, string>;
  copy: Record<Locale, PromoCopy>;
}

const PROMOS: Promo[] = [
  {
    // From 301.st's and 301.ru's home pages.
    id: '301',
    logo: logo('301.svg'),
    url: { en: 'https://301.st/', ru: 'https://301.ru/' },
    copy: {
      en: {
        eyebrow: 'From the same team',
        title: 'Domains and redirects on your own Cloudflare',
        text: 'Domain portfolio, bulk edge redirects, geo routing and conversion tracking in one dashboard, on your own Cloudflare account. Free during Open Beta.',
        cta: 'Open 301.st',
      },
      ru: {
        eyebrow: 'От той же команды',
        title: 'Домены и редиректы на вашем Cloudflare',
        text: 'Портфель доменов, массовые edge-редиректы, гео-маршрутизация и трекинг конверсий — в одном дашборде, на вашем аккаунте Cloudflare. Бесплатно на Open Beta.',
        cta: 'Открыть 301.ru',
      },
    },
  },
  {
    // From wpps.ru's banner (the words of catchall.in's own pages).
    id: 'catchall',
    logo: logo('catchall.svg'),
    url: { en: 'https://catchall.in/', ru: 'https://ru.catchall.in/' },
    copy: {
      en: {
        eyebrow: 'From the same team',
        title: 'Need OTP mail on your own domain?',
        text: 'Catchall hosts a catch-all mailbox on a subdomain of your domain. Your tools pick up confirmation codes over POP3S / IMAPS. $10 per domain / 30 days.',
        cta: 'Try Catchall',
      },
      ru: {
        eyebrow: 'От той же команды',
        title: 'Нужна OTP-почта на своём домене?',
        text: 'Catchall поднимает catch-all ящик на поддомене вашего домена. Ваши инструменты забирают коды по POP3S / IMAPS. $10 за домен на 30 дней.',
        cta: 'Открыть Catchall',
      },
    },
  },
  {
    // From wpps.ru's banner (generator.ink's line on flagtheme.com).
    id: 'generator',
    logo: logo('generator-ink.svg'),
    url: { en: 'https://generator.ink/', ru: 'https://generator.ink/ru' },
    copy: {
      en: {
        title: 'Site Generator',
        text: 'Publishes static sites straight to your own Cloudflare Pages — plain HTML and CSS, your domain, your hosting. No vendor runtime, no lock-in.',
        cta: 'generator.ink',
      },
      ru: {
        title: 'Генератор сайтов',
        text: 'Публикует статические сайты прямо в ваш собственный Cloudflare Pages — чистые HTML и CSS, ваш домен, ваш хостинг. Без чужого рантайма и привязки к вендору.',
        cta: 'generator.ink',
      },
    },
  },
];

const withUtm = (url: string): string => {
  const u = new URL(url);
  u.searchParams.set('utm_source', 'clx.cx');
  u.searchParams.set('utm_medium', 'banner');
  u.searchParams.set('utm_campaign', 'site');
  return u.toString();
};


/** The rotation: the banners of `ids` (all by default, 301.st first), the first shown. */
export function promoBlock(locale: Locale, ids: readonly string[] = PROMOS.map((p) => p.id)): string {
  const banners = PROMOS.filter((p) => ids.includes(p.id)).map((p, i) => {
    const c = p.copy[locale];
    return `<a class="promo promo--${p.id}" href="${escapeHtml(withUtm(p.url[locale]))}" rel="noopener" data-promo${i ? ' hidden' : ''}>
    <span class="promo__glow" aria-hidden="true"></span>
    <span class="promo__mark" aria-hidden="true">${p.logo}</span>
    <span class="promo__body">${c.eyebrow ? `<span class="promo__eyebrow">${escapeHtml(c.eyebrow)}</span>` : ''}<span class="promo__title">${escapeHtml(c.title)}</span><span class="promo__text">${escapeHtml(c.text)}</span></span>
    <span class="promo__cta">${escapeHtml(c.cta)} <span aria-hidden="true">→</span></span>
  </a>`;
  });
  return `<section class="home-section promo-slot">\n  ${banners.join('\n  ')}\n</section>`;
}

const CLX_MARK = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'favicon.svg'), 'utf8').trim();

/** The page's closing call to sign up, drawn as clx's own banner: the mark, the heading, the plan in a
 *  line, the button. Not one link like the banners above: the button is its only link. */
export function finalBlock(locale: Locale, title: string, cta: string): string {
  const s = STRINGS[locale].home;
  return `<section class="home-section final-slot">
  <div class="promo promo--clx">
    <span class="promo__glow" aria-hidden="true"></span>
    <span class="promo__mark" aria-hidden="true">${CLX_MARK}</span>
    <div class="promo__body"><h2 class="promo__title">${escapeHtml(title)}</h2><p class="promo__text">${escapeHtml(s.note)}</p></div>
    <a class="promo__cta" href="${appPathFor(locale)}#/signup">${escapeHtml(cta)} <span aria-hidden="true">→</span></a>
  </div>
</section>`;
}
