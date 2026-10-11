// The comparison pages: clx beside one other service. Every claim about the other service comes from
// docs/comparisons.md — its own pages, with the address and the day checked — and the page lists those
// sources. One template: a hero, charts drawn at build time (clx's bar in the brand colour, the
// others grey), a table, when the other service is the better choice, the sources, a call to sign up.
import Rank from 'affiliate-charts/charts-rank.js';
import { chartOptions, themed } from './demo.ts';
import { escapeHtml, seeAlso } from './layout.ts';
import { promoBlock } from './promo.ts';
import type { Locale } from './pages.ts';
import { appPathFor } from './urls.ts';

interface Chart {
  h: string;
  /** [label, value, display]; clx first, so its bar is the highlighted one. */
  rows: [string, number, string][];
  note: string;
}

interface CompareText {
  title: string;
  description: string;
  h1: string;
  lead: string;
  start: string;
  charts: Chart[];
  table: { h: string; head: [string, string, string]; rows: [string, string, string][] };
  /** A word on a third service, with its own facts (the Russian counter page: Yandex Metrica). */
  aside?: { h: string; p: string; points: string[] };
  theirs: { h: string; points: string[] };
  sources: { h: string; checked: string; links: [string, string][] };
  /** This tool's own page and the other comparison of the language. */
  more: [string, string][];
  /** The other service is ours (site/promo.ts id): its sources are links, and its banner closes the page. */
  ours?: string;
  final: string;
}

const CHECKED = '11.10.2026';

const BITLY: CompareText = {
  title: 'A free Bitly alternative on your own domain — clx',
  description: 'clx is a free, open-source Bitly alternative: short links on your own domain, click history for 400 days, QR codes, destinations you can change, no ads.',
  h1: 'A free Bitly alternative on your own domain',
  lead: 'Bitly’s free plan has no click data and no domain of your own. clx gives you 200 links on a domain you own, with click history for 400 days and a QR code for each, served by a worker in your own Cloudflare account. It is free and open source.',
  start: 'Start free',
  charts: [
    {
      h: 'Days of click history',
      rows: [
        ['clx, free', 400, '400'],
        ['Bitly Free', 0, 'none'],
        ['Bitly Core', 30, '30'],
        ['Bitly Growth', 120, '120'],
        ['Bitly Premium', 365, '365'],
        ['Bitly Enterprise', 730, '730'],
      ],
      note: 'Bitly’s Enterprise plan keeps more: two years.',
    },
    {
      h: 'Links on your own domain, $ a month',
      rows: [
        ['clx', 0, '$0'],
        ['Bitly Growth', 29, '$29'],
        ['Bitly Premium', 199, '$199'],
      ],
      note: 'Bitly’s prices billed yearly; its own domain starts on Growth, with one domain included. With clx the domain is one you already have in Cloudflare.',
    },
  ],
  table: {
    h: 'clx and Bitly side by side',
    head: ['', 'clx', 'Bitly'],
    rows: [
      ['Price', 'Free; the API plan is on request, free for now', 'Free; Core $10, Growth $29, Premium $199 a month billed yearly; Enterprise by quote'],
      ['Short links', '200 at a time; 10,000 on the API plan', '5 a month on Free; 100, 500 or 3,000 a month on paid plans'],
      ['Click history', 'By day for 400 days, by hour for 31', 'None on Free; 30 days to 2 years by plan'],
      ['Your own domain', 'On every plan: a host in your Cloudflare account', 'From Growth'],
      ['Changing where a link goes', 'Any time; the code and the QR code stay', 'Not on Free; 5 to 110 changes a month on paid plans'],
      ['QR codes', 'One for every link, as SVG', '1 on Free; 5 to 200 a month on paid plans'],
      ['What a visitor sees', 'A plain 302 redirect, no cookies', 'Free-plan links may open a preview page with an ad first'],
      ['Deleting a link', 'Yes', 'Shared links cannot be deleted or disabled, even with the account'],
      ['API', 'On every plan, one key on Free', '1,000 to 50,000 requests a month by plan'],
      ['Where the data is', 'Your Cloudflare account; clx.cx keeps totals only', 'Bitly'],
    ],
  },
  theirs: {
    h: 'When Bitly is the better choice',
    points: [
      'You have no domain in Cloudflare, or no domain at all: clx links live only on yours.',
      'You need more than 400 days of click data: Bitly Enterprise keeps two years.',
      'You want a domain that comes with the plan: Bitly Growth includes one.',
    ],
  },
  sources: {
    h: 'Sources',
    checked: `Bitly’s facts are from its own pages, checked on ${CHECKED}; clx’s from its pricing and specification.`,
    links: [
      ['Bitly pricing', 'https://bitly.com/pages/pricing'],
      ['Bitly privacy policy', 'https://bitly.com/pages/privacy'],
      ['Bitly help: the ad on free links', 'https://support.bitly.com/hc/en-us/articles/32874287800333'],
      ['Bitly help: after a downgrade', 'https://support.bitly.com/hc/en-us/articles/360029870551'],
      ['clx pricing', '/pricing'],
    ],
  },
  more: [['Short links on your own domain', '/short-links'], ['clx vs Plausible', '/plausible-alternative']],
  final: 'Shorten links on your own domain, free',
};

const PLAUSIBLE: CompareText = {
  title: 'A free Plausible alternative on your Cloudflare — clx',
  description: 'clx counts visits without cookies like Plausible, but free: an inline snippet under 600 bytes on your own domain, the data in your own Cloudflare account.',
  h1: 'A free Plausible alternative that runs in your Cloudflare account',
  lead: 'Like Plausible, clx counts visits without cookies. Unlike it, clx is free, its counter is a snippet under 600 bytes served from your own domain, and the data sits in a D1 database in your own Cloudflare account — with no server to run.',
  start: 'Start free',
  charts: [
    {
      h: '100,000 pageviews a month, $ a month',
      rows: [
        ['clx', 0, '$0'],
        ['Plausible Starter', 19, '$19'],
        ['Plausible Growth', 29, '$29'],
        ['Plausible Business', 39, '$39'],
      ],
      note: 'Plausible billed monthly; yearly is ten months’ price. 100,000 views a month is about 3,300 a day, well within Cloudflare’s Workers Free.',
    },
    {
      h: 'The counter’s code, bytes',
      rows: [
        ['clx', 600, 'under 600'],
        ['Plausible', 2841, '2,841'],
      ],
      note: 'Uncompressed, measured the same way. Plausible’s script is a file of its own; clx’s snippet can sit inside the page.',
    },
  ],
  table: {
    h: 'clx and Plausible side by side',
    head: ['', 'clx', 'Plausible'],
    rows: [
      ['Price', 'Free', 'From $9 a month for 10,000 pageviews; no free plan, a 30-day trial'],
      ['Sites', '10; 500 on the API plan', '1, 3 or 10 by plan'],
      ['Cookies', 'None', 'None'],
      ['The counter', 'An inline snippet under 600 bytes, or a script on your own domain', 'A 2.8 KB script'],
      ['History', 'By day for 400 days', '3 years; 5 on Business'],
      ['Where the data is', 'A D1 database in your Cloudflare account; clx.cx keeps totals only', 'Plausible’s servers at Hetzner in Germany'],
      ['Stats API', 'On the free plan', 'From the Business plan'],
      ['Running it yourself', 'Nothing to host: it runs on your Cloudflare account', 'Community Edition: at least 2 GB of memory, Postgres and ClickHouse'],
      ['Short links', 'Built in, on your own domain', 'Not in its plans'],
      ['Code', 'Open source, AGPL-3.0', 'Open source, AGPLv3 (Community Edition)'],
    ],
  },
  theirs: {
    h: 'When Plausible is the better choice',
    points: [
      'Your site is not served by Cloudflare: clx counts only sites in a Cloudflare account you connect.',
      'You need funnels or ecommerce revenue: Plausible’s plans have them; clx counts views, visitors and their breakdowns.',
      'You need more than 400 days of history, or a managed service hosted in the EU.',
    ],
  },
  sources: {
    h: 'Sources',
    checked: `Plausible’s facts are from its own pages and code, checked on ${CHECKED}; clx’s from its pricing and specification.`,
    links: [
      ['Plausible pricing', 'https://plausible.io/#pricing'],
      ['Plausible data policy', 'https://plausible.io/data-policy'],
      ['Plausible Stats API', 'https://plausible.io/docs/stats-api'],
      ['Plausible: its script', 'https://plausible.io/lightweight-web-analytics'],
      ['Plausible: hosting', 'https://plausible.io/eu-hosted-web-analytics'],
      ['Plausible Community Edition', 'https://github.com/plausible/community-edition'],
      ['clx pricing', '/pricing'],
    ],
  },
  more: [['The cookieless visit counter', '/analytics'], ['clx vs Bitly', '/bitly-alternative']],
  final: 'Count your visits without cookies, free',
};

const CLCK: CompareText = {
  title: 'Аналог Яндекс Кликера со статистикой и своим доменом — clx',
  description: 'Сократить ссылку со своим названием, на своём домене и с отслеживанием переходов — бесплатно. Чего нет в Кликере (clck.ru): статистика, правка, удаление.',
  h1: 'Аналог Яндекс Кликера: короткие ссылки со статистикой на вашем домене',
  lead: 'Кликер (clck.ru) сокращает ссылку бесплатно и без регистрации, но не показывает, сколько по ней перешли, и не даёт ни своего домена, ни своего названия. В clx ссылка живёт на вашем домене, с вашим названием и статистикой переходов за 400 дней — тоже бесплатно.',
  start: 'Начать бесплатно',
  charts: [
    {
      h: 'Сколько дней автор ссылки видит переходы',
      rows: [
        ['clx', 400, '400'],
        ['Яндекс Кликер', 0, 'нисколько'],
      ],
      note: 'В Кликере статистики нет: он предлагает метку, чтобы считать переходы своей Яндекс Метрикой на сайте назначения.',
    },
    {
      h: 'Переадресаций до страницы',
      rows: [
        ['clx', 1, '1'],
        ['Яндекс Кликер', 2, '2'],
      ],
      note: 'Кликер ведёт сначала на проверку Яндекса (sba.yandex.ru), и только она — на страницу.',
    },
  ],
  table: {
    h: 'clx и Кликер рядом',
    head: ['', 'clx', 'Яндекс Кликер'],
    rows: [
      ['Цена', 'Бесплатно', 'Бесплатно'],
      ['Регистрация', 'Нужна, и нужен аккаунт Cloudflare со своим доменом', 'Не нужна'],
      ['Домен ссылки', 'Ваш: хост в вашем аккаунте Cloudflare', 'Только clck.ru'],
      ['Своё название ссылки', 'Да', 'Нет'],
      ['Статистика переходов', 'Клики и посетители по дням за 400 дней, с источниками, странами и устройствами', 'Нет'],
      ['Изменить, куда ведёт ссылка', 'Да; код и QR-код остаются', 'Нет'],
      ['Удалить ссылку', 'Да', 'Нет'],
      ['QR-код', 'Для каждой ссылки, в SVG', 'Да, через qr.yandex.ru'],
      ['Переход', 'Одна переадресация 302, без cookie', 'Через проверку Яндекса; ставит cookie Яндекса'],
      ['Кто распоряжается ссылкой', 'Вы: ссылка на вашем домене', 'Яндекс может удалить её без уведомления'],
      ['API', 'Да, с ключом и правами', 'Да, без ключа; лимиты не опубликованы'],
    ],
  },
  theirs: {
    h: 'Когда лучше Кликер',
    points: [
      'Нужна одна короткая ссылка прямо сейчас, без регистрации.',
      'Своего домена в Cloudflare нет: ссылки clx живут только на вашем.',
      'Переходы вы и так считаете Метрикой на своём сайте.',
    ],
  },
  sources: {
    h: 'Источники',
    checked: `Сведения о Кликере — из его условий, интерфейса и ответов сервера, проверено ${CHECKED}; о clx — из тарифов и спецификации.`,
    links: [
      ['Условия использования Кликера', 'https://yandex.ru/legal/clck_termsofuse/ru/'],
      ['Яндекс Кликер', 'https://clck.ru/'],
      ['Тарифы clx', '/ru/pricing'],
    ],
  },
  more: [['Короткие ссылки на своём домене', '/short-links'], ['Вместо LiveInternet', '/liveinternet-alternative']],
  final: 'Сокращайте ссылки на своём домене со статистикой',
};

const LIVEINTERNET: CompareText = {
  title: 'Аналог LiveInternet — счётчик посещений без cookie — clx',
  description: 'Бесплатный счётчик посещений сайта без cookie и без кнопки: источники, страны, боты, история за 400 дней. Сравнение с LiveInternet и Яндекс Метрикой.',
  h1: 'Счётчик посещений сайта вместо LiveInternet — без cookie и без кнопки',
  lead: 'LiveInternet бесплатен только с его кнопкой на странице, ставит cookie на год и хранит статистику по дням 32 дня. clx считает без cookie и без кнопки, хранит дни 400 дней, а подробные данные лежат в вашем аккаунте Cloudflare и нигде не публикуются.',
  start: 'Начать бесплатно',
  charts: [
    {
      h: 'Сколько дней хранится статистика по дням',
      rows: [
        ['clx', 400, '400'],
        ['LiveInternet', 32, '32'],
      ],
      note: 'Дальше LiveInternet хранит недели (32 недели) и месяцы (32 месяца).',
    },
  ],
  table: {
    h: 'clx и LiveInternet рядом',
    head: ['', 'clx', 'LiveInternet'],
    rows: [
      ['Цена', 'Бесплатно', 'Бесплатно с видимой кнопкой; без неё — от $3 в месяц за сайт'],
      ['Кнопка на странице', 'Не нужна', 'Обязательна на бесплатном тарифе'],
      ['Cookie', 'Нет', 'Да, на год'],
      ['Кто видит статистику', 'Вы, в кабинете; не публикуется', 'Все или по паролю — выбирается при добавлении сайта'],
      ['История по дням', '400 дней', '32 дня'],
      ['Страны', 'По стране, которую видит Cloudflare', '64, остальные — «Другие»'],
      ['API', 'Да', 'Документированного нет'],
      ['Где данные', 'В вашем аккаунте Cloudflare; на clx.cx только итоги', 'У LiveInternet'],
      ['Политика конфиденциальности', 'Есть', 'Не нашли'],
    ],
  },
  aside: {
    h: 'А Яндекс Метрика?',
    p: 'Метрика тоже бесплатна и умеет больше, например записывать визиты Вебвизором. Цена другая:',
    points: [
      'Ставит cookie (_ym_uid и другие) на год и пишет в localStorage.',
      'Вебвизор записывает визиты на страницах сайта.',
      'Яндекс получает бесплатную лицензию на данные и может сопоставлять их со своими.',
      'Оператор персональных данных по 152-ФЗ — владелец сайта, Яндекс обрабатывает их по его поручению.',
    ],
  },
  theirs: {
    h: 'Когда лучше LiveInternet или Метрика',
    points: [
      'Сайт не на Cloudflare: clx считает только сайты в подключённом аккаунте Cloudflare.',
      'Нужна открытая статистика, которую видят все: LiveInternet это умеет.',
      'Нужны записи визитов: это Вебвизор в Метрике.',
    ],
  },
  sources: {
    h: 'Источники',
    checked: `Сведения о LiveInternet и Метрике — с их собственных страниц, проверено ${CHECKED}; о clx — из тарифов и спецификации.`,
    links: [
      ['LiveInternet: вопросы и ответы', 'https://www.liveinternet.ru/help/faq.html'],
      ['LiveInternet: цены', 'https://www.liveinternet.ru/pay/?ac=price'],
      ['LiveInternet: добавить сайт', 'https://www.liveinternet.ru/add'],
      ['Условия Яндекс Метрики', 'https://yandex.ru/legal/metrica_termsofuse/ru/'],
      ['Метрика: cookie', 'https://yandex.ru/support/metrica/ru/general/cookie-usage.html'],
      ['Тарифы clx', '/ru/pricing'],
    ],
  },
  more: [['Счётчик посещений без cookie', '/analytics'], ['Вместо Кликера', '/clck-alternative']],
  final: 'Считайте посещения без cookie и без кнопки',
};

/** clx beside 301.st, its parent service: not rivals — what each does, and how they fit. Facts from
 *  301.st's (and 301.ru's) own pages, docs/comparisons.md. */
const PARENT: Record<Locale, CompareText> = {
  en: {
    title: 'clx and 301.st: visit counter and redirect platform — clx',
    description: 'clx counts visits and serves short links; 301.st manages domains, edge redirects, TDS and postbacks. Both run on your own Cloudflare account.',
    h1: 'clx and 301.st: what each does',
    lead: '301.st is clx’s parent service. It runs a domain portfolio, edge redirects, traffic distribution and conversion tracking; clx counts the visits of your sites and serves short links. Both work on your own Cloudflare account — use one, or both.',
    start: 'Start with clx, free',
    charts: [],
    table: {
      h: 'clx and 301.st side by side',
      head: ['', 'clx', '301.st'],
      rows: [
        ['What it does', 'A cookieless visit counter and short links with QR codes', 'A domain portfolio, edge redirects, TDS and postback attribution'],
        ['For whom', 'Site owners, site generators and AI agents', 'SEO webmasters, affiliate teams, media buyers and agencies'],
        ['Where it runs', 'A worker and a D1 database in your Cloudflare account', 'Workers in your Cloudflare account; your DNS does not move'],
        ['Traffic rules', 'Up to 10 a link, by country and device', 'Redirects by geo and user agent across many domains; TDS with A/B and geo splits'],
        ['Statistics', 'Views, visitors, sources, countries, devices and bots of your sites; clicks of your links', 'Real-time analytics, kept 30 to 365 days by plan; conversions from S2S postbacks'],
        ['Domains', 'Your sites, and one host for links', 'A portfolio with expiry dates, DNS checks and VirusTotal checks through your own key'],
        ['Price', 'Free', 'Free during Open Beta; then Free, Pro $30 or Business $100 a month'],
        ['Cloudflare accounts', '1; 50 on the API plan', '1, 10 or 100 by plan'],
      ],
    },
    aside: {
      h: 'Together',
      p: 'Both keep your traffic on your own Cloudflare account and leave your DNS where it is. They fit each other:',
      points: [
        '301.st moves the traffic between domains and offers; clx counts the visits of the sites it leads to.',
        'A clx short link, with its QR code for print or a post, can point to any address — a 301.st flow included.',
      ],
    },
    theirs: {
      h: 'When you need 301.st',
      points: [
        'You run many domains and move traffic between them: bulk redirects, rules by geo and device.',
        'You split traffic between offers or landing pages: A/B and geo splits at the Cloudflare edge.',
        'You need to know which click converted: postbacks from affiliate networks.',
      ],
    },
    sources: {
      h: 'Sources',
      checked: `301.st’s facts are from its own pages, checked on ${CHECKED}; clx’s from its pricing and specification.`,
      links: [
        ['301.st pricing', 'https://301.st/pricing'],
        ['301.st features', 'https://301.st/features'],
        ['301.st: Cloudflare integration', 'https://301.st/docs/cloudflare-integration'],
        ['clx pricing', '/pricing'],
      ],
    },
    more: [['How clx works', '/how-it-works'], ['clx pricing', '/pricing']],
    ours: '301',
    final: 'Count your visits with clx, free',
  },
  ru: {
    title: 'clx и 301.ru: счётчик посещений и платформа редиректов — clx',
    description: 'clx считает посещения и обслуживает короткие ссылки; 301.ru управляет доменами, edge-редиректами, TDS и постбэками. Оба работают в вашем аккаунте Cloudflare.',
    h1: 'clx и 301.ru: что делает каждый',
    lead: '301.ru — родительский сервис clx. Он ведёт портфель доменов, edge-редиректы, распределение трафика и трекинг конверсий; clx считает посещения ваших сайтов и обслуживает короткие ссылки. Оба работают в вашем аккаунте Cloudflare — берите один или оба.',
    start: 'Начать с clx бесплатно',
    charts: [],
    table: {
      h: 'clx и 301.ru рядом',
      head: ['', 'clx', '301.ru'],
      rows: [
        ['Что делает', 'Счётчик посещений без cookie и короткие ссылки с QR-кодами', 'Портфель доменов, edge-редиректы, TDS и атрибуция через постбэки'],
        ['Для кого', 'Владельцы сайтов, генераторы сайтов и ИИ-агенты', 'SEO-вебмастера, арбитражные команды, медиабайеры и агентства'],
        ['Где работает', 'Воркер и база D1 в вашем аккаунте Cloudflare', 'Воркеры в вашем аккаунте Cloudflare; DNS остаётся на месте'],
        ['Правила трафика', 'До 10 на ссылку, по стране и устройству', 'Редиректы по гео и UA на многих доменах; TDS с A/B- и гео-сплитами'],
        ['Статистика', 'Просмотры, посетители, источники, страны, устройства и боты сайтов; клики ссылок', 'Аналитика в реальном времени, хранение от 30 до 365 дней по тарифу; конверсии из S2S-постбэков'],
        ['Домены', 'Ваши сайты и один хост для ссылок', 'Портфель со сроками, проверками DNS и VirusTotal по вашему ключу'],
        ['Цена', 'Бесплатно', 'Бесплатно на Open Beta; затем Бесплатный, Pro 2 500 ₽ или Бизнес 8 500 ₽ в месяц'],
        ['Аккаунты Cloudflare', '1; 50 на тарифе API', '1, 10 или 100 по тарифу'],
      ],
    },
    aside: {
      h: 'Вместе',
      p: 'Оба держат трафик в вашем аккаунте Cloudflare и не трогают ваш DNS. И дополняют друг друга:',
      points: [
        '301.ru переводит трафик между доменами и офферами; clx считает посещения сайтов, куда он ведёт.',
        'Короткая ссылка clx с QR-кодом для печати или поста может вести на любой адрес — в том числе в поток 301.ru.',
      ],
    },
    theirs: {
      h: 'Когда нужен 301.ru',
      points: [
        'У вас много доменов и трафик между ними: массовые редиректы, правила по гео и устройству.',
        'Вы делите трафик между офферами или лендингами: A/B- и гео-сплиты на edge Cloudflare.',
        'Нужно знать, какой клик принёс конверсию: постбэки от партнёрских сетей.',
      ],
    },
    sources: {
      h: 'Источники',
      checked: `Сведения о 301.ru — с его собственных страниц, проверено ${CHECKED}; о clx — из тарифов и спецификации.`,
      links: [
        ['Тарифы 301.ru', 'https://301.ru/pricing'],
        ['Возможности 301.ru', 'https://301.ru/features'],
        ['301.ru: интеграция с Cloudflare', 'https://301.ru/docs/cloudflare-integration'],
        ['Тарифы clx', '/ru/pricing'],
      ],
    },
    more: [['Как работает clx', '/how-it-works'], ['Тарифы clx', '/pricing']],
    ours: '301',
    final: 'Считайте посещения с clx бесплатно',
  },
};

function chartCard(locale: Locale, c: Chart): string {
  const { o } = chartOptions(locale);
  const rows = c.rows.map(([label, value, display]) => ({ label, value, display }));
  // The library names a chart's ids from what it draws; a chart whose highlighted bar is $0 draws the
  // same in both themes, so each copy gets the theme in its ids, or the page would repeat them.
  const draw = (theme: 'dark' | 'light') => Rank.rank(rows, { ...o(theme), highlight: 0, title: c.h }).replace(/\bcx-([0-9a-z]{12,})/gu, `cx-$1-${theme}`);
  return `<div class="card feature"><h3>${escapeHtml(c.h)}</h3>${themed('demo__chart', draw)}<p class="compare__note">${escapeHtml(c.note)}</p></div>`;
}

/** A source: our own page is a link; another service's is its address as text, in brackets — no link
 *  to it, unless the page is about a service of ours (`linked`). */
const source = ([label, href]: [string, string], linked: boolean) =>
  href.startsWith('/') || linked ? `<a href="${escapeHtml(href)}"${linked && !href.startsWith('/') ? ' rel="noopener"' : ''}>${escapeHtml(label)}</a>` : `${escapeHtml(label)} (${escapeHtml(href.replace(/^https:\/\/(www\.)?/u, '').replace(/\/$/u, ''))})`;

function page(locale: Locale, t: CompareText): { title: string; description: string; body: string } {
  const start = `<a class="btn btn--primary btn--lg" href="${appPathFor(locale)}#/signup">${escapeHtml(t.start)}</a>`;
  const grid = t.charts.length > 1 ? 'features' : 'features compare__one';
  const charts = t.charts.length
    ? `<section class="home-section">
  <div class="${grid}">${t.charts.map((c) => chartCard(locale, c)).join('')}</div>
</section>
`
    : '';
  const [, us, them] = t.table.head;
  const aside = t.aside
    ? `<section class="home-section narrow-section">
  <h2>${escapeHtml(t.aside.h)}</h2>
  <div class="card feature"><p>${escapeHtml(t.aside.p)}</p><ul class="compare__list">${t.aside.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>
</section>
`
    : '';
  const body = `<section class="hero hero--home">
  <h1>${escapeHtml(t.h1)}</h1>
  <p class="lead">${escapeHtml(t.lead)}</p>
  <p class="actions">${start}</p>
</section>
${charts}<section class="home-section">
  <h2>${escapeHtml(t.table.h)}</h2>
  <div class="card table-scroll"><table class="table compare">
    <thead><tr><td></td><th scope="col">${escapeHtml(us)}</th><th scope="col">${escapeHtml(them)}</th></tr></thead>
    <tbody>${t.table.rows.map(([k, a, b]) => `<tr><th scope="row">${escapeHtml(k)}</th><td data-label="${escapeHtml(us)}">${escapeHtml(a)}</td><td data-label="${escapeHtml(them)}">${escapeHtml(b)}</td></tr>`).join('')}</tbody>
  </table></div>
</section>
${aside}<section class="home-section narrow-section">
  <h2>${escapeHtml(t.theirs.h)}</h2>
  <div class="card feature"><ul class="compare__list">${t.theirs.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>
  ${seeAlso(t.more, locale)}
</section>
<section class="home-section narrow-section compare__sources">
  <h2 class="h3">${escapeHtml(t.sources.h)}</h2>
  <p>${escapeHtml(t.sources.checked)}</p>
  <ul>${t.sources.links.map((s) => `<li>${source(s, !!t.ours)}</li>`).join('')}</ul>
</section>
${t.ours ? `${promoBlock(locale, [t.ours])}\n` : ''}<section class="home-final">
  <h2>${escapeHtml(t.final)}</h2>
  <p class="actions">${start}</p>
</section>`;
  return { title: t.title, description: t.description, body };
}

export const bitlyPage = () => page('en', BITLY);
export const plausiblePage = () => page('en', PLAUSIBLE);
export const clckPage = () => page('ru', CLCK);
export const liveinternetPage = () => page('ru', LIVEINTERNET);
export const parentPage = (locale: Locale) => page(locale, PARENT[locale]);
