// The site's words, one object per language with the same shape: a key missing in one language
// fails `tsc`, never falls back to English silently. The app's words live in ui/ (part 3 of the
// product plan moves them into dictionaries too).
import type { Locale } from './pages.ts';

export interface Strings {
  /** `<title>` suffix and the brand's accessible name. */
  brand: string;
  signIn: string;
  theme: string;
  language: string;
  home: { title: string; description: string; h1: string; lead: string; points: string[]; cta: string; source: string };
  notFound: { title: string; text: string; back: string };
  foot: { agents: string; api: string; privacy: string; terms: string; abuse: string; source: string };
}

const en: Strings = {
  brand: 'clx',
  signIn: 'Sign in',
  theme: 'Switch theme',
  language: 'Language',
  home: {
    title: 'clx — open visit counter and short links on Cloudflare',
    description: 'A privacy-friendly visit counter and short links with QR codes that run as a worker in your own Cloudflare account. Free, open source, with an API.',
    h1: 'Visit counter and short links in your own Cloudflare account',
    lead: 'clx installs a small worker and a D1 database in your Cloudflare account. Your sites count their visits there, and your short links redirect from there; clx.cx keeps only the totals.',
    points: [
      'A counter without cookies or third-party scripts: the snippet loads from your own domain.',
      'Short links on your domain, with QR codes and country and device rules.',
      'Reports with pages, sources, countries and devices, read from your own database.',
      'An API for site generators and agents; the code is open under AGPL-3.0.',
    ],
    cta: 'Open clx',
    source: 'Source code',
  },
  notFound: { title: 'Page not found', text: 'There is no such page on clx.cx.', back: 'To the home page' },
  foot: { agents: 'For AI agents', api: 'API', privacy: 'Privacy', terms: 'Terms', abuse: 'Abuse', source: 'Source code' },
};

const ru: Strings = {
  brand: 'clx',
  signIn: 'Войти',
  theme: 'Сменить тему',
  language: 'Язык',
  home: {
    title: 'clx — открытый счётчик посещений и короткие ссылки на Cloudflare',
    description: 'Счётчик посещений без cookie и короткие ссылки с QR-кодами, которые работают воркером в вашем аккаунте Cloudflare. Бесплатно, открытый код, есть API.',
    h1: 'Счётчик посещений и короткие ссылки в вашем аккаунте Cloudflare',
    lead: 'clx ставит в ваш аккаунт Cloudflare небольшой воркер и базу D1. Сайты считают посещения там же, короткие ссылки переадресуют оттуда же; на clx.cx хранятся только итоги.',
    points: [
      'Счётчик без cookie и сторонних скриптов: сниппет грузится с вашего домена.',
      'Короткие ссылки на вашем домене — с QR-кодами и правилами по странам и устройствам.',
      'Отчёты со страницами, источниками, странами и устройствами — из вашей же базы.',
      'API для генераторов сайтов и агентов; код открыт под AGPL-3.0.',
    ],
    cta: 'Открыть clx',
    source: 'Исходный код',
  },
  notFound: { title: 'Страница не найдена', text: 'Такой страницы на clx.cx нет.', back: 'На главную' },
  foot: { agents: 'Для ИИ-агентов', api: 'API', privacy: 'Конфиденциальность', terms: 'Условия', abuse: 'Жалобы', source: 'Исходный код' },
};

export const STRINGS: Record<Locale, Strings> = { en, ru };
