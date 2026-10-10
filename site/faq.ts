// /faq (docs/spec.md §16): every question of the site in one page, grouped by topic. The questions are
// the pages' own (STRINGS.home.faq, site/products.ts `pageQuestions`), so a page and /faq cannot
// differ; this file has only the page's frame and the group names.
import { STRINGS } from './i18n.ts';
import { escapeHtml } from './layout.ts';
import type { Locale } from './pages.ts';
import { pageQuestions } from './products.ts';
import { appPathFor, pathFor } from './urls.ts';

interface FaqText {
  title: string;
  description: string;
  h1: string;
  lead: string;
  groups: { general: string; analytics: string; links: string; generators: string; pricing: string };
  start: string;
}

const TEXT: Record<Locale, FaqText> = {
  en: {
    title: 'Questions about clx — analytics and short links',
    description: 'Answers about clx: what it creates in your Cloudflare account, how the cookieless counter and the short links work, the API for site generators and the plans.',
    h1: 'Questions',
    lead: 'What clx does in your Cloudflare account, how counting and links work, and what it costs.',
    groups: { general: 'General', analytics: 'Analytics', links: 'Short links', generators: 'Site generators', pricing: 'Pricing' },
    start: 'Start free',
  },
  ru: {
    title: 'Вопросы о clx — статистика сайта и короткие ссылки',
    description: 'Ответы о clx: что он создаёт в вашем аккаунте Cloudflare, как работают счётчик без cookie и короткие ссылки, API для генераторов сайтов и тарифы.',
    h1: 'Вопросы',
    lead: 'Что clx делает в вашем аккаунте Cloudflare, как устроены счётчик и ссылки и сколько это стоит.',
    groups: { general: 'Общее', analytics: 'Статистика', links: 'Короткие ссылки', generators: 'Генераторы сайтов', pricing: 'Тарифы' },
    start: 'Начать бесплатно',
  },
};

/** The groups and their questions, in the order of the page. */
export function faqGroups(locale: Locale): { key: string; name: string; page: string; items: [string, string][] }[] {
  const t = TEXT[locale];
  const q = pageQuestions(locale);
  return [
    { key: 'general', name: t.groups.general, page: '/', items: STRINGS[locale].home.faq.items },
    { key: 'analytics', name: t.groups.analytics, page: '/analytics', items: q.analytics },
    { key: 'links', name: t.groups.links, page: '/short-links', items: q.links },
    { key: 'generators', name: t.groups.generators, page: '/for-site-generators', items: q.generators },
    { key: 'pricing', name: t.groups.pricing, page: '/pricing', items: q.pricing },
  ];
}

export function faqPage(locale: Locale): { title: string; description: string; body: string } {
  const t = TEXT[locale];
  const groups = faqGroups(locale)
    .map(
      (g) => `<section class="home-section faq-group" id="${g.key}">
  <h2><a href="${pathFor(g.page, locale)}">${escapeHtml(g.name)}</a></h2>
  <div class="faq">${g.items.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join('')}</div>
</section>`,
    )
    .join('\n');
  const body = `<section class="hero hero--home">
  <h1>${escapeHtml(t.h1)}</h1>
  <p class="lead">${escapeHtml(t.lead)}</p>
</section>
${groups}
<section class="home-final">
  <p class="actions"><a class="btn btn--primary btn--lg" href="${appPathFor(locale)}#/signup">${escapeHtml(t.start)}</a></p>
</section>`;
  return { title: t.title, description: t.description, body };
}
