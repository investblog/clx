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
    en: { primary: 'cookieless web analytics', keywords: ['website visitor counter', 'privacy-friendly analytics', 'cookieless analytics platform', 'page view counter'], tags: ['analytics', 'privacy'] },
    ru: { primary: 'счетчик посещений сайта', keywords: ['статистика посещаемости сайта', 'веб-аналитика сайта', 'счетчик уникальных посетителей', 'аналитика без файлов куки'], tags: ['аналитика', 'приватность'] },
  },
  '/short-links': {
    en: { primary: 'link shortener with custom domain', keywords: ['url shortener', 'branded short links', 'link tracking with QR codes', 'short links on your own domain'], tags: ['short links', 'QR codes'] },
    ru: { primary: 'сокращение ссылок', keywords: ['короткие ссылки на своем домене', 'сервис коротких ссылок', 'отслеживание переходов по ссылкам', 'сокращатель ссылок с QR-кодом'], tags: ['короткие ссылки', 'QR-коды'] },
  },
  '/for-site-generators': {
    en: { primary: 'analytics for generated websites', keywords: ['separate counter for each website', 'site generator analytics API', 'analytics for many sites'], tags: ['site generators', 'analytics'] },
    ru: { primary: 'аналитика для генератора сайтов', keywords: ['отдельный счетчик для каждого сайта', 'API статистики для конвейера сборки', 'учет визитов на множестве сайтов'], tags: ['генераторы сайтов', 'аналитика'] },
  },
  '/pricing': {
    en: { primary: 'free web analytics plan', keywords: ['clx pricing', 'link shortener free tier', 'counter and shortener pricing'], tags: ['pricing'] },
    ru: { primary: 'бесплатная веб-аналитика', keywords: ['тарифы clx', 'бесплатное сокращение ссылок', 'цены на аналитику и ссылки'], tags: ['цены'] },
  },
  '/faq': {
    en: { primary: 'web analytics FAQ', keywords: ['adding stats to your website', 'answers about short links', 'clx help center'], tags: ['help'] },
    ru: { primary: 'вопросы о статистике сайта', keywords: ['ответы о коротких ссылках', 'справка по clx', 'установка счетчика на сайт'], tags: ['справка'] },
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
    en: { primary: 'Cloudflare redirect manager with analytics', keywords: ['redirect platform and traffic stats', 'edge redirects with click stats', 'traffic distribution and site analytics'], tags: ['comparison', 'redirects'] },
    ru: { primary: 'менеджер редиректов на Cloudflare', keywords: ['301 редирект и статистика', 'редиректы и учет визитов', 'управление редиректами с аналитикой'], tags: ['сравнение', 'редиректы'] },
  },
  '/how-it-works': {
    en: { primary: 'analytics on your own Cloudflare', keywords: ['page views on Cloudflare Workers', 'Cloudflare web analytics alternative', 'visit data in your own database'], tags: ['platform', 'analytics'] },
    ru: { primary: 'аналитика в вашем Cloudflare', keywords: ['статистика на Cloudflare Workers', 'данные посещений в вашей базе', 'устройство счетчика clx'], tags: ['платформа', 'аналитика'] },
  },
  '/open-source': {
    en: { primary: 'open source URL shortener', keywords: ['open source website analytics', 'AGPL-licensed link shortener', 'self-hostable web analytics'], tags: ['open source'] },
    ru: { primary: 'система учета визитов с открытым кодом', keywords: ['открытый исходный код clx', 'сокращатель ссылок с открытым кодом', 'аналитика с открытым исходным кодом', 'свободная лицензия AGPL'], tags: ['открытый код'] },
  },
  // The free QR code tools (ADR 0045): the demand is almost all for SVG (the old qrcgen.com's searches).
  '/qr-code-generator': {
    en: { primary: 'free SVG QR code generator', keywords: ['QR code generator online', 'SVG QR codes in the browser', 'QR code maker without sign-up', 'vector QR code generator'], tags: ['QR codes', 'tools'] },
    ru: { primary: 'генератор QR-кодов в SVG', keywords: ['бесплатный генератор QR-кодов', 'QR-код онлайн без регистрации', 'векторный QR-код', 'создание QR-кода в браузере'], tags: ['QR-коды', 'инструменты'] },
  },
  '/qr-code-api': {
    en: { primary: 'free QR code API', keywords: ['QR code generator API', 'SVG QR code REST API', 'QR codes over HTTP', 'QR image API without a key'], tags: ['QR codes', 'developers', 'API'] },
  },
  '/qr-code-extension': {
    en: { primary: 'QR code generator extension', keywords: ['QR code browser extension', 'Chrome QR code extension', 'side panel QR code maker'], tags: ['QR codes', 'browser extension'] },
    ru: { primary: 'расширение-генератор QR-кодов', keywords: ['расширение для браузера с QR-кодами', 'QR-код в боковой панели', 'расширение для создания QR-кодов'], tags: ['QR-коды', 'расширение для браузера'] },
  },
  '/agents': {
    en: { primary: 'MCP server for short links', keywords: ['link shortener for AI agents', 'analytics MCP server', 'agent-ready URL shortener'], tags: ['AI agents', 'developers'] },
  },
  '/api': {
    en: { primary: 'URL shortener API', keywords: ['link shortener API', 'custom domain shortener API', 'visitor analytics API'], tags: ['developers', 'API'] },
  },
};
