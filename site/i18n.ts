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
  home: {
    title: string;
    description: string;
    h1: string;
    lead: string;
    start: string;
    source: string;
    note: string;
    how: { h2: string; steps: [string, string][] };
    tools: { h2: string; items: { h: string; p: string; points: string[] }[] };
    why: { h2: string; items: [string, string][] };
    api: { h2: string; p: string; agents: string; reference: string };
    plans: { h2: string; items: { name: string; price: string; points: string[] }[]; note: string };
    faq: { h2: string; items: [string, string][] };
    final: string;
  };
  /** The example report (site/demo.ts). */
  demo: {
    period: string;
    tiles: [string, string, string, string];
    views: string;
    visitors: string;
    sourcesTitle: string;
    sources: [string, string, string, string, string];
    devicesTitle: string;
    devices: [string, string];
    pagesTitle: string;
    pages: [string, string, string, string, string];
    countriesTitle: string;
    countries: [string, string, string, string, string];
    note: string;
  };
  /** The header's menu: a page's `nav` key → its name; `menu` names the phone's menu button. */
  nav: { analytics: string; links: string; menu: string };
  notFound: { title: string; text: string; back: string };
  foot: { agents: string; api: string; privacy: string; terms: string; abuse: string; source: string };
}

const en: Strings = {
  brand: 'clx',
  signIn: 'Sign in',
  theme: 'Switch theme',
  language: 'Language',
  home: {
    title: 'clx — cookieless analytics and short links on Cloudflare',
    description: 'A visit counter without cookies and short links with QR codes that run in your own Cloudflare account. Free, open source, with an API for site generators.',
    h1: 'Analytics and short links that live in your Cloudflare account',
    lead: 'clx installs a small worker and a D1 database in your Cloudflare account. Your sites count their visits there, your short links redirect from there, and clx.cx keeps only the totals.',
    start: 'Start free',
    source: 'Source code',
    note: 'Free plan, no card. Open source under AGPL-3.0.',
    how: {
      h2: 'How it works',
      steps: [
        ['Connect Cloudflare', 'Paste a one-time bootstrap token. clx issues its own working token from it, then deletes the bootstrap token — or tells you to, if Cloudflare would not let it.'],
        ['clx installs its worker', 'A worker and a D1 database appear in your account and run on your quotas — the free ones are enough for most sites.'],
        ['Add a site or a link', 'Put a one-line snippet on your site, or make a short link on your own domain with a QR code and rules.'],
      ],
    },
    tools: {
      h2: 'Two tools, one worker',
      items: [
        {
          h: 'Visit counter',
          p: 'Views and visitors of every site: by hour today, by day for 7 and 30 days; daily totals are kept for 400 days.',
          points: ['No cookies, no third-party address in your pages', 'Pages, sources, countries, devices, browsers, systems', 'Bots counted apart: search engines, AI crawlers, monitoring'],
        },
        {
          h: 'Short links',
          p: 'Links on a domain of yours, served by the worker in your account.',
          points: ['A QR code for every link, as SVG', 'Rules by country and device', 'Clicks by source, country and device'],
        },
      ],
    },
    why: {
      h2: 'Why clx',
      items: [
        ['Your data stays with you', 'Visits, clicks and their breakdowns live in a D1 database in your Cloudflare account. clx.cx stores only totals by hour and by day.'],
        ['Nothing third-party in your pages', 'The snippet is served from your own domain and sets no cookies.'],
        ['Cloudflare’s free plan is often enough', 'Workers Free allows 100,000 requests and 100,000 D1 writes a day per account, shared with your other workers: for a typical account about 11,000 counted events a day at worst, usually several times that. clx warns you when the account nears its quota.'],
        ['Open source', 'The worker, clx.cx and these pages are open under AGPL-3.0: read what runs in your account.'],
      ],
    },
    api: {
      h2: 'Made for site generators and agents',
      p: 'Everything the app does is an API call. A site generator adds a site and puts the snippet into the page it builds; an AI agent sets clx up for a person from one page of docs.',
      agents: 'Docs for AI agents',
      reference: 'API reference',
    },
    plans: {
      h2: 'Plans',
      items: [
        { name: 'Free', price: '$0', points: ['1 Cloudflare account', '10 sites, 200 links', '1 API key'] },
        { name: 'API', price: 'On request, free for now', points: ['50 Cloudflare accounts', '500 sites, 10,000 links', '5 API keys'] },
      ],
      note: 'Cloudflare’s Workers Paid plan is never required on any plan.',
    },
    faq: {
      h2: 'Questions',
      items: [
        ['Do I need a Cloudflare account?', 'Yes. clx counts sites served by Cloudflare, and short links need a domain of yours there: clx.cx carries none of your traffic.'],
        ['What does clx create in my account?', 'One worker, one D1 database and the routes of your sites and link host, with a working token of its own. Disconnecting removes what clx created and lists anything it could not; the working token you revoke yourself in Cloudflare — clx gives you the link.'],
        ['Does it cost anything?', 'The free plan costs nothing and needs no card; the worker runs on your Cloudflare quotas.'],
        ['Can I read the code?', 'All of it, on GitHub, under AGPL-3.0.'],
      ],
    },
    final: 'Count visits and shorten links — the details stay in your account',
  },
  demo: {
    period: 'Last 14 days',
    tiles: ['Visitors', 'Views', 'Per visitor', 'Bot share'],
    views: 'Views',
    visitors: 'Visitors',
    sourcesTitle: 'Sources',
    sources: ['Direct', 'google.com', 't.me', 'github.com', 'Other'],
    devicesTitle: 'Devices',
    devices: ['Phone', 'Computer'],
    pagesTitle: 'Pages',
    pages: ['/', '/pricing', '/blog/cloudflare-d1-limits', '/docs/install', 'Other'],
    countriesTitle: 'Countries',
    countries: ['United States', 'Germany', 'United Kingdom', 'Brazil', 'Other'],
    note: 'Example data, drawn by the same charts as the report in the app.',
  },
  nav: { analytics: 'Analytics', links: 'Short links', menu: 'Menu' },
  notFound: { title: 'Page not found', text: 'There is no such page on clx.cx.', back: 'To the home page' },
  foot: { agents: 'For AI agents', api: 'API', privacy: 'Privacy', terms: 'Terms', abuse: 'Abuse', source: 'Source code' },
};

const ru: Strings = {
  brand: 'clx',
  signIn: 'Войти',
  theme: 'Сменить тему',
  language: 'Язык',
  home: {
    title: 'clx — счётчик посещений и короткие ссылки на Cloudflare',
    description: 'Счётчик посещений без cookie и короткие ссылки с QR-кодами, которые работают в вашем аккаунте Cloudflare. Бесплатно, открытый код, API для генераторов сайтов.',
    h1: 'Статистика сайта и короткие ссылки в вашем аккаунте Cloudflare',
    lead: 'clx ставит в ваш аккаунт Cloudflare небольшой воркер и базу D1. Сайты считают посещения там же, короткие ссылки переадресуют оттуда же, а на clx.cx хранятся только итоги.',
    start: 'Начать бесплатно',
    source: 'Исходный код',
    note: 'Бесплатный тариф, без карты. Открытый код под AGPL-3.0.',
    how: {
      h2: 'Как это работает',
      steps: [
        ['Подключите Cloudflare', 'Вставьте разовый bootstrap-токен. clx выпустит по нему свой рабочий токен, а bootstrap-токен удалит — или попросит удалить вас, если Cloudflare не даст.'],
        ['clx ставит свой воркер', 'В вашем аккаунте появляются воркер и база D1 и работают в ваших квотах — бесплатных хватает большинству сайтов.'],
        ['Добавьте сайт или ссылку', 'Поставьте на сайт сниппет в одну строку или сделайте короткую ссылку на своём домене — с QR-кодом и правилами.'],
      ],
    },
    tools: {
      h2: 'Два инструмента, один воркер',
      items: [
        {
          h: 'Счётчик посещений',
          p: 'Просмотры и посетители каждого сайта: по часам за сегодня, по дням за 7 и 30 дней; итоги по дням хранятся 400 дней.',
          points: ['Без cookie и без чужих адресов на ваших страницах', 'Страницы, источники, страны, устройства, браузеры, системы', 'Боты отдельно: поисковики, ИИ-краулеры, мониторинг'],
        },
        {
          h: 'Короткие ссылки',
          p: 'Ссылки на вашем домене, их обслуживает воркер в вашем аккаунте.',
          points: ['QR-код для каждой ссылки, в SVG', 'Правила по стране и устройству', 'Клики по источникам, странам и устройствам'],
        },
      ],
    },
    why: {
      h2: 'Почему clx',
      items: [
        ['Данные остаются у вас', 'Посещения, клики и их разбивки лежат в базе D1 в вашем аккаунте Cloudflare. На clx.cx хранятся только итоги по часам и дням.'],
        ['Ничего чужого на страницах', 'Сниппет грузится с вашего же домена и не ставит cookie.'],
        ['Часто хватает бесплатного Cloudflare', 'Workers Free даёт аккаунту 100 000 запросов и 100 000 записей D1 в сутки — на все его воркеры: типичному аккаунту это ~11 000 событий в сутки в худшем случае, обычно в несколько раз больше. clx предупредит, когда аккаунт подойдёт к квоте.'],
        ['Открытый код', 'Воркер, clx.cx и эти страницы открыты под AGPL-3.0: видно, что работает в вашем аккаунте.'],
      ],
    },
    api: {
      h2: 'Для генераторов сайтов и агентов',
      p: 'Всё, что делает кабинет, — вызовы API. Генератор сайтов добавляет сайт и вставляет сниппет в страницу, которую собирает; ИИ-агент настраивает clx для человека по одной странице документации.',
      agents: 'Документация для ИИ-агентов',
      reference: 'Справочник API',
    },
    plans: {
      h2: 'Тарифы',
      items: [
        { name: 'Free', price: 'Бесплатно', points: ['1 аккаунт Cloudflare', '10 сайтов, 200 ссылок', '1 ключ API'] },
        { name: 'API', price: 'По запросу, пока бесплатно', points: ['50 аккаунтов Cloudflare', '500 сайтов, 10 000 ссылок', '5 ключей API'] },
      ],
      note: 'Тариф Workers Paid у Cloudflare не нужен ни на одном тарифе.',
    },
    faq: {
      h2: 'Вопросы',
      items: [
        ['Нужен ли аккаунт Cloudflare?', 'Да. clx считает сайты, которые обслуживает Cloudflare, а коротким ссылкам нужен ваш домен там же: через clx.cx ваш трафик не идёт.'],
        ['Что clx создаёт в моём аккаунте?', 'Один воркер, одну базу D1 и маршруты ваших сайтов и хоста ссылок — со своим рабочим токеном. При отключении clx удаляет созданное и перечисляет, что удалить не смог; рабочий токен вы отзываете сами в Cloudflare — clx даёт ссылку.'],
        ['Это платно?', 'Бесплатный тариф ничего не стоит и не требует карты; воркер работает в ваших квотах Cloudflare.'],
        ['Можно посмотреть код?', 'Весь, на GitHub, под AGPL-3.0.'],
      ],
    },
    final: 'Считайте посещения и сокращайте ссылки — подробности остаются в вашем аккаунте',
  },
  demo: {
    period: 'Последние 14 дней',
    tiles: ['Посетители', 'Просмотры', 'На посетителя', 'Доля ботов'],
    views: 'Просмотры',
    visitors: 'Посетители',
    sourcesTitle: 'Источники',
    sources: ['Прямые заходы', 'google.com', 't.me', 'github.com', 'Прочее'],
    devicesTitle: 'Устройства',
    devices: ['Телефон', 'Компьютер'],
    pagesTitle: 'Страницы',
    pages: ['/', '/pricing', '/blog/cloudflare-d1-limits', '/docs/install', 'Прочее'],
    countriesTitle: 'Страны',
    countries: ['Россия', 'Казахстан', 'Германия', 'Беларусь', 'Прочие'],
    note: 'Пример данных — нарисован теми же графиками, что и отчёт в кабинете.',
  },
  nav: { analytics: 'Аналитика', links: 'Короткие ссылки', menu: 'Меню' },
  notFound: { title: 'Страница не найдена', text: 'Такой страницы на clx.cx нет.', back: 'На главную' },
  foot: { agents: 'Для ИИ-агентов', api: 'API', privacy: 'Конфиденциальность', terms: 'Условия', abuse: 'Жалобы', source: 'Исходный код' },
};

export const STRINGS: Record<Locale, Strings> = { en, ru };
