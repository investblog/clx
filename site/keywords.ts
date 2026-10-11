// The anchors other sites may link to each page with: printed to public/keywords.json by site/build.ts
// (the url, title, excerpt and date come from the page itself). The format and the rules are a link
// pipeline's: plain words, hyphen and apostrophe only inside a word, no word twice in one anchor, the
// language of the page, 2–7 words, noun phrases rather than queries. Picked from Ahrefs search volumes
// (US and RU, 11.10.2026) and rewritten from queries into phrases that sit inside a sentence.
// Legal pages and the 404 are not link targets: they have no entry.
import type { Locale } from './pages.ts';

export interface PageKeywords {
  /** The best single anchor. */
  primary: string;
  /** Other wordings: a synonym or a narrower form, 3–5. */
  keywords: string[];
  /** Topics, for the sections of a campaign's document. */
  tags: string[];
}

export const KEYWORDS: Record<string, Partial<Record<Locale, PageKeywords>>> = {
  '/': {
    en: { primary: 'clx visit counter', keywords: ['clx on your Cloudflare account', 'clx analytics and link shortener', 'open source counter and shortener'], tags: ['analytics', 'short links'] },
    ru: { primary: 'счетчик посещений clx', keywords: ['clx в вашем аккаунте Cloudflare', 'сервис clx', 'счетчик и короткие ссылки clx'], tags: ['аналитика', 'короткие ссылки'] },
  },
  '/analytics': {
    en: { primary: 'cookieless web analytics', keywords: ['website visitor counter', 'privacy-friendly analytics', 'cookieless analytics platform', 'site visitor counter'], tags: ['analytics', 'privacy'] },
    ru: { primary: 'счетчик посещений сайта', keywords: ['статистика посещаемости сайта', 'веб-аналитика сайта', 'счетчик уникальных посетителей', 'аналитика без файлов куки'], tags: ['аналитика', 'приватность'] },
  },
  '/short-links': {
    en: { primary: 'link shortener with custom domain', keywords: ['url shortener', 'branded short links', 'link tracking with QR codes', 'short links on your own domain'], tags: ['short links', 'QR codes'] },
    ru: { primary: 'сокращение ссылок', keywords: ['короткие ссылки на своем домене', 'сервис коротких ссылок', 'отслеживание переходов по ссылкам', 'сокращатель ссылок с QR-кодом'], tags: ['короткие ссылки', 'QR-коды'] },
  },
  '/for-site-generators': {
    en: { primary: 'analytics for generated websites', keywords: ['visit counter without shared footprint', 'site generator analytics API', 'counter for every site you build', 'analytics for many sites'], tags: ['site generators', 'analytics'] },
    ru: { primary: 'счетчик для генератора сайтов', keywords: ['статистика без общего следа', 'API счетчика для конвейера сборки', 'аналитика для множества сайтов', 'свой счетчик каждому сайту'], tags: ['генераторы сайтов', 'аналитика'] },
  },
  '/pricing': {
    en: { primary: 'free visitor counter', keywords: ['clx pricing', 'free link shortener plan', 'counter and shortener pricing'], tags: ['pricing'] },
    ru: { primary: 'бесплатный счетчик посещений', keywords: ['тарифы clx', 'бесплатное сокращение ссылок', 'цены на счетчик и ссылки'], tags: ['цены'] },
  },
  '/faq': {
    en: { primary: 'visitor counter FAQ', keywords: ['adding a counter to your website', 'answers about short links', 'clx help and answers'], tags: ['help'] },
    ru: { primary: 'вопросы о счетчике посещений', keywords: ['ответы о коротких ссылках', 'справка по clx', 'установка счетчика на сайт'], tags: ['справка'] },
  },
  '/bitly-alternative': {
    en: { primary: 'Bitly alternative', keywords: ['alternative to Bitly', 'free Bitly alternative', 'Bitly alternative on your own domain', 'open source Bitly replacement'], tags: ['comparison', 'short links'] },
  },
  '/plausible-alternative': {
    en: { primary: 'Plausible alternative', keywords: ['Plausible Analytics alternative', 'free Plausible alternative', 'open source Plausible replacement'], tags: ['comparison', 'analytics'] },
  },
  '/clck-alternative': {
    ru: { primary: 'альтернатива Яндекс Кликеру', keywords: ['замена Кликера', 'сокращение ссылок вместо Кликера', 'аналог Яндекс Кликера'], tags: ['сравнение', 'короткие ссылки'] },
  },
  '/liveinternet-alternative': {
    ru: { primary: 'альтернатива LiveInternet', keywords: ['аналог счетчика LiveInternet', 'счетчик вместо LiveInternet', 'открытая статистика вместо LiveInternet'], tags: ['сравнение', 'аналитика'] },
  },
  '/vs-301': {
    en: { primary: 'Cloudflare redirect manager with analytics', keywords: ['redirect platform and visit counter', 'edge redirects with click stats', 'traffic distribution and site analytics'], tags: ['comparison', 'redirects'] },
    ru: { primary: 'менеджер редиректов на Cloudflare', keywords: ['301 редирект и статистика', 'редиректы и счетчик посещений', 'управление редиректами с аналитикой'], tags: ['сравнение', 'редиректы'] },
  },
  '/how-it-works': {
    en: { primary: 'analytics on your own Cloudflare', keywords: ['Cloudflare Workers visit counter', 'Cloudflare web analytics alternative', 'visit data in your own database'], tags: ['platform', 'analytics'] },
    ru: { primary: 'аналитика в вашем Cloudflare', keywords: ['счетчик на Cloudflare Workers', 'данные посещений в вашей базе', 'устройство счетчика clx'], tags: ['платформа', 'аналитика'] },
  },
  '/open-source': {
    en: { primary: 'open source URL shortener', keywords: ['open source website analytics', 'AGPL visitor counter', 'self-hostable visitor counter'], tags: ['open source'] },
    ru: { primary: 'счетчик с открытым кодом', keywords: ['открытый исходный код clx', 'сокращатель ссылок с открытым кодом', 'аналитика с открытым исходным кодом', 'свободная лицензия AGPL'], tags: ['открытый код'] },
  },
  '/agents': {
    en: { primary: 'MCP server for short links', keywords: ['link shortener for AI agents', 'analytics MCP server', 'agent-ready URL shortener'], tags: ['AI agents', 'developers'] },
  },
  '/api': {
    en: { primary: 'URL shortener API', keywords: ['link shortener API', 'custom domain shortener API', 'visitor analytics API', 'QR code API'], tags: ['developers', 'API'] },
  },
};
