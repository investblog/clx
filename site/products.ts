// The pages of the two tools (docs/spec.md §16): /analytics — the visit counter, /short-links — the
// links. One template: a hero, an illustration drawn at build time (site/demo.ts), sections, a code
// example, questions, a call to sign up. Every claim follows docs/spec.md (§5 the counter, §6 links,
// §7 totals, §8 limits); the words are here, one object per language of one shape.
import Rank from 'affiliate-charts/charts-rank.js';
import { generateMatrix } from '../src/qr/generate.ts';
import { chartOptions, demoReport, themed } from './demo.ts';
import { escapeHtml } from './layout.ts';
import type { Locale } from './pages.ts';
import { appPathFor } from './urls.ts';

interface ProductText {
  title: string;
  description: string;
  h1: string;
  lead: string;
  start: string;
  /** How to begin, shown under the call to sign up as the 301.st step flow. */
  steps?: string[];
  sections: { h: string; p: string; points?: string[] }[];
  setup?: { h: string; p: string; code: string };
  faq: { h: string; items: [string, string][] };
  final: string;
}

interface LinkCard {
  short: string;
  target: string;
  qr: string;
  rulesTitle: string;
  rules: [string, string][];
  clicksTitle: string;
  countries: [string, string, string, string];
  note: string;
}

const ANALYTICS: Record<Locale, ProductText> = {
  en: {
    title: 'Cookieless website analytics on Cloudflare — clx',
    description: 'A visit counter without cookies that runs in your own Cloudflare account: pages, sources, countries, devices and bots, with the details in your D1. Free.',
    h1: 'Cookieless website analytics in your own Cloudflare account',
    lead: 'A one-line snippet counts the views and visitors of your site. The counter is a worker in your Cloudflare account, the data sits in your D1 database, and clx.cx keeps only the totals.',
    start: 'Start free',
    steps: ['Connect Cloudflare', 'Add your site', 'Put in the snippet'],
    sections: [
      {
        h: 'No cookies, nothing third-party',
        p: 'The snippet is served from your own domain, under a path of your site, and sets no cookies. A visitor is counted once a day by a hash of a random daily salt, the site, the IP address and the browser string; the hash and the salt are deleted when the day closes, and the IP address and the browser string are never written down.',
      },
      {
        h: 'What the report shows',
        p: 'Views and visitors by hour today and by day for 7 or 30 days, with the breakdowns:',
        points: ['Pages and sources', 'Countries and devices', 'Browsers and operating systems', 'Bots apart from people: search engines, AI crawlers, monitoring, ad review, link previews, headless browsers'],
      },
      {
        h: 'Your data, your quotas',
        p: 'The breakdowns are read from the D1 database in your account when you open a report. clx.cx keeps only totals: hours for two days, days for 400. The worker runs on your Cloudflare quotas — Workers Free is usually enough, and clx warns you when the account nears it.',
      },
    ],
    setup: {
      h: 'One line in your pages',
      p: 'Add your site in the app or through the API and put its snippet into your template — a script tag or an inline script under 600 bytes. A site generator does it at build time.',
      code: '<!-- the snippet of your site; the path is its own -->\n<script defer src="/lumora/k3.js"></script>',
    },
    faq: {
      h: 'Questions',
      items: [
        ['Which sites can clx count?', 'Sites served by Cloudflare in the account you connect: a zone there or a subdomain of one. Ten sites on the free plan, 500 on the API plan.'],
        ['How are bots told apart?', 'By known signatures in the browser string, headless browsers included: they are counted in their own report by kind and never mixed into views or visitors.'],
        ['Can I get raw visits?', 'No: clx keeps no visit log, only counters. Reports come from the app and from the API.'],
        ['What if I disconnect?', 'clx removes its worker, database and routes from your account and lists anything it could not; the totals on clx.cx go with your clx account when you delete it.'],
      ],
    },
    final: 'Count your visits on your own Cloudflare account',
  },
  ru: {
    title: 'Статистика сайта без cookie на Cloudflare — clx',
    description: 'Счётчик посещений без cookie, который работает в вашем аккаунте Cloudflare: страницы, источники, страны, устройства, боты; подробности — в вашей D1. Бесплатно.',
    h1: 'Статистика сайта без cookie — в вашем аккаунте Cloudflare',
    lead: 'Сниппет в одну строку считает просмотры и посетителей сайта. Счётчик — воркер в вашем аккаунте Cloudflare, данные лежат в вашей базе D1, а на clx.cx хранятся только итоги.',
    start: 'Начать бесплатно',
    steps: ['Подключите Cloudflare', 'Добавьте сайт', 'Вставьте сниппет'],
    sections: [
      {
        h: 'Без cookie и без чужих скриптов',
        p: 'Сниппет грузится с вашего домена, по пути вашего же сайта, и не ставит cookie. Посетитель считается раз в сутки по хешу из случайной суточной соли, сайта, IP-адреса и строки браузера; хеш и соль удаляются, когда сутки закрываются, а IP-адрес и строка браузера не записываются вовсе.',
      },
      {
        h: 'Что в отчёте',
        p: 'Просмотры и посетители по часам за сегодня и по дням за 7 или 30 дней, с разбивками:',
        points: ['Страницы и источники', 'Страны и устройства', 'Браузеры и системы', 'Боты отдельно от людей: поисковики, ИИ-краулеры, мониторинг, проверка рекламы, превью ссылок, headless-браузеры'],
      },
      {
        h: 'Ваши данные, ваши квоты',
        p: 'Разбивки читаются из базы D1 в вашем аккаунте, когда вы открываете отчёт. На clx.cx хранятся только итоги: по часам — двое суток, по дням — 400 дней. Воркер работает в ваших квотах Cloudflare: обычно хватает Workers Free, а когда аккаунт подойдёт к квоте, clx предупредит.',
      },
    ],
    setup: {
      h: 'Одна строка на страницах',
      p: 'Добавьте сайт в кабинете или через API и вставьте его сниппет в шаблон — тегом script или встроенным скриптом до 600 байт. Генератор сайтов делает это при сборке.',
      code: '<!-- сниппет вашего сайта; путь у каждого свой -->\n<script defer src="/lumora/k3.js"></script>',
    },
    faq: {
      h: 'Вопросы',
      items: [
        ['Какие сайты clx может считать?', 'Сайты, которые обслуживает Cloudflare в подключённом аккаунте: зону или её поддомен. На бесплатном тарифе — 10 сайтов, на тарифе API — 500.'],
        ['Как отделяются боты?', 'По известным сигнатурам в строке браузера, включая headless-браузеры: они считаются в своём отчёте по видам и не попадают ни в просмотры, ни в посетителей.'],
        ['Можно получить сырые посещения?', 'Нет: clx не ведёт журнал посещений, только счётчики. Отчёты — в кабинете и через API.'],
        ['Что будет, если отключиться?', 'clx удалит из вашего аккаунта свой воркер, базу и маршруты и перечислит, что удалить не смог; итоги на clx.cx удаляются вместе с учётной записью clx.'],
      ],
    },
    final: 'Считайте посещения в своём аккаунте Cloudflare',
  },
};

const LINKS: Record<Locale, ProductText & { card: LinkCard }> = {
  en: {
    title: 'URL shortener on your own domain, on Cloudflare — clx',
    description: 'Short links on your own domain with QR codes, country and device rules and click tracking, served by a worker in your Cloudflare account. Free, with an API.',
    h1: 'A URL shortener on your own domain',
    lead: 'Pick a host like go.example.com, and clx serves short links on it from a worker in your Cloudflare account — with a QR code for every link, rules by country and device, and click tracking.',
    start: 'Start free',
    steps: ['Connect Cloudflare', 'Choose a link host', 'Make a link'],
    sections: [
      {
        h: 'Your domain, not ours',
        p: 'The link host is a subdomain or a separate domain in your Cloudflare account, one per account. A link answers with a plain 302 redirect and no caching, so every click reaches the worker; anything else on the host is a bare 404.',
      },
      {
        h: 'A QR code for every link',
        p: 'Download it as SVG from the app or the API. A scan is reported as its own source, and the code never changes — change the target or the rules, and printed codes keep working.',
      },
      {
        h: 'Rules by country and device',
        p: 'Up to ten rules a link: send Germany to the German page and phones to the app. The first rule that matches wins; otherwise the main target.',
      },
      {
        h: 'Link tracking',
        p: 'Clicks and visitors of every link, by day, with sources, countries, devices, browsers and systems. Bots are redirected too, but counted apart.',
      },
    ],
    setup: {
      h: 'A link is one API call',
      p: 'Make links in the app, or let your site generator or agent make them:',
      code: 'curl https://clx.cx/v1/links \\\n  -H "Authorization: Bearer clx_…" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"account_id":"…","url":"https://example.com/spring-sale","code":"spring",\n       "rules":[{"countries":["DE","AT"],"url":"https://example.de/fruehling"}]}\'\n\n# → 201 { "link": { "short_url": "https://go.example.com/spring", … } }',
    },
    faq: {
      h: 'Questions',
      items: [
        ['Can I use clx without a domain of my own?', 'No. Links live on your host in your Cloudflare account: clx.cx carries none of your traffic.'],
        ['What happens to a printed QR code if the page moves?', 'Change the link’s target: the code and the QR code stay the same.'],
        ['How many links can I have?', '200 on the free plan, 10,000 on the API plan.'],
        ['How is a link chosen by country?', 'By the country Cloudflare sees the click from; a device is a phone or a computer.'],
      ],
    },
    final: 'Shorten links on your own domain',
    card: {
      short: 'go.example.com/spring',
      target: 'example.com/spring-sale',
      qr: 'QR code',
      rulesTitle: 'Rules',
      rules: [['Germany, Austria', 'example.de/fruehling'], ['Phone', 'example.com/app']],
      clicksTitle: 'Clicks by country',
      countries: ['United States', 'Germany', 'Austria', 'Other'],
      note: 'An example link.',
    },
  },
  ru: {
    title: 'Сокращатель ссылок на своём домене, на Cloudflare — clx',
    description: 'Короткие ссылки на вашем домене с QR-кодами, правилами по стране и устройству и статистикой кликов — работают воркером в вашем аккаунте Cloudflare. Бесплатно.',
    h1: 'Сокращатель ссылок на вашем домене',
    lead: 'Выберите хост вроде go.example.com — и clx будет обслуживать на нём короткие ссылки из воркера в вашем аккаунте Cloudflare: с QR-кодом для каждой ссылки, правилами по стране и устройству и статистикой кликов.',
    start: 'Начать бесплатно',
    steps: ['Подключите Cloudflare', 'Выберите хост ссылок', 'Создайте ссылку'],
    sections: [
      {
        h: 'Ваш домен, а не наш',
        p: 'Хост ссылок — поддомен или отдельный домен в вашем аккаунте Cloudflare, один на аккаунт. Ссылка отвечает обычным редиректом 302 без кеширования, так что каждый клик доходит до воркера; всё остальное на хосте — пустой 404.',
      },
      {
        h: 'QR-код для каждой ссылки',
        p: 'Скачайте его в SVG в кабинете или через API. Сканирование учитывается отдельным источником, а код ссылки не меняется: смените цель или правила — напечатанные коды продолжат работать.',
      },
      {
        h: 'Правила по стране и устройству',
        p: 'До десяти правил на ссылку: Германию — на немецкую страницу, телефоны — в приложение. Срабатывает первое подходящее правило, иначе — основная цель.',
      },
      {
        h: 'Статистика кликов',
        p: 'Клики и посетители каждой ссылки по дням — с источниками, странами, устройствами, браузерами и системами. Боты тоже переадресуются, но считаются отдельно.',
      },
    ],
    setup: {
      h: 'Ссылка — один вызов API',
      p: 'Создавайте ссылки в кабинете или поручите это генератору сайтов или агенту:',
      code: 'curl https://clx.cx/v1/links \\\n  -H "Authorization: Bearer clx_…" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"account_id":"…","url":"https://example.com/spring-sale","code":"spring",\n       "rules":[{"countries":["DE","AT"],"url":"https://example.de/fruehling"}]}\'\n\n# → 201 { "link": { "short_url": "https://go.example.com/spring", … } }',
    },
    faq: {
      h: 'Вопросы',
      items: [
        ['Можно без своего домена?', 'Нет. Ссылки живут на вашем хосте в вашем аккаунте Cloudflare: через clx.cx ваш трафик не идёт.'],
        ['Что будет с напечатанным QR-кодом, если страница переедет?', 'Поменяйте цель ссылки: код ссылки и QR-код останутся прежними.'],
        ['Сколько ссылок можно сделать?', '200 на бесплатном тарифе, 10 000 на тарифе API.'],
        ['Как выбирается страна?', 'По стране, из которой Cloudflare видит клик; устройство — телефон или компьютер.'],
      ],
    },
    final: 'Сокращайте ссылки на своём домене',
    card: {
      short: 'go.example.com/spring',
      target: 'example.com/spring-sale',
      qr: 'QR-код',
      rulesTitle: 'Правила',
      rules: [['Германия, Австрия', 'example.de/fruehling'], ['Телефон', 'example.com/app']],
      clicksTitle: 'Клики по странам',
      countries: ['Россия', 'Германия', 'Австрия', 'Прочие'],
      note: 'Пример ссылки.',
    },
  },
};

/** A QR code as SVG: the matrix from src/qr (the app's QR, ADR 0009), dark modules as one path with a
 *  quiet zone of 4. Drawn here rather than by src/qr/render.ts, whose extensionless import the
 *  site's Node build cannot load. */
function qrSvg(text: string): string {
  const { data, size } = generateMatrix(text, { ecc: 'M' });
  const q = 4;
  const d = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x + q} ${y + q}h1v1h-1z`] : []))).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 2 * q} ${size + 2 * q}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="#111" d="${d}"/></svg>`;
}

/** The example link: its address, the QR code, its rules and clicks by country. */
function linkCard(locale: Locale, c: LinkCard): string {
  const { num, o } = chartOptions(locale);
  const counts = [1840, 960, 410, 230];
  const total = counts.reduce((a, n) => a + n, 0);
  const qr = qrSvg(`https://${c.short}?q`);
  return `<figure class="demo" aria-hidden="true">
  <div class="demo__bar"><span class="demo__dots"><i></i><i></i><i></i></span><span class="demo__site">${escapeHtml(c.short)}</span><span class="demo__period">→ ${escapeHtml(c.target)}</span></div>
  <div class="link-card__body">
    <div class="link-card__qr">${qr}</div>
    <div class="demo__panel"><p class="demo__h">${escapeHtml(c.rulesTitle)}</p><ul class="link-card__rules">${c.rules.map(([when, to]) => `<li><span>${escapeHtml(when)}</span><span>→ ${escapeHtml(to)}</span></li>`).join('')}</ul></div>
    <div class="demo__panel"><p class="demo__h">${escapeHtml(c.clicksTitle)}</p>${themed('demo__chart', (theme) => Rank.rank(counts.map((n, i) => ({ label: c.countries[i]!, value: n, display: `${num(n)} · ${Math.round((n / total) * 100)}%` })), o(theme)))}</div>
  </div>
</figure>
<p class="demo__note">${escapeHtml(c.note)}</p>`;
}

const GENERATORS: Record<Locale, ProductText & { flow: [string, string][] }> = {
  en: {
    title: 'Visit counter and links API for site generators — clx',
    description: 'Add a site through the API, embed a counter with no shared footprint at build time and read the totals back. clx runs in your customers’ Cloudflare accounts.',
    h1: 'Analytics and short links for the sites you generate',
    lead: 'A site generator adds a site through the API, puts its counter into the pages it builds and reads the totals back. Each counter runs in the Cloudflare account its site is served from.',
    start: 'Start free',
    flow: [
      ['Your generator', 'adds the site and gets its snippet'],
      ['clx API', 'installs the route in the customer’s account'],
      ['The built pages', 'count their visits on their own domain'],
    ],
    sections: [
      {
        h: 'No shared footprint',
        p: 'Every site gets its own path, file names and snippet code, generated from a random seed, and no third-party host appears: no signature in the page, the URLs or the answers is shared by clx sites or names clx. What stays visible, plainly: a same-origin POST on each page view, answered with an empty 204, and the browser’s own API names.',
      },
      {
        h: 'Made for build pipelines',
        p: 'Every write takes an idempotency key: a write that went through, sent again with the same key within 24 hours, does not make its change twice. A key gets only the scopes it needs — a pipeline needs sites and reports.',
      },
      {
        h: 'Many customers, one integration',
        p: 'The API plan covers 50 Cloudflare accounts, 500 sites and 10,000 links with five keys; a key can be limited to some accounts and client IPs, so one customer’s key cannot reach another’s.',
      },
      {
        h: 'Works with Cloudflare Pages',
        p: 'The counter’s route sits on the site’s own host, beside a Pages site, and passes everything else through. The account’s use is measured daily, and the API tells you when a customer should move to Workers Paid.',
      },
    ],
    setup: {
      h: 'Three steps in a build',
      p: 'Once the customer’s Cloudflare account is connected: add the site once, embed its snippet in every page, read the report when you need it. The full contract is in the API reference.',
      code: '# 1. add the site (scope: sites)\ncurl https://clx.cx/v1/sites \\\n  -H "Authorization: Bearer clx_…" \\\n  -H "Idempotency-Key: build-42-example.com" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"account_id":"…","host":"example.com"}\'\n# → 202 { "site": { "id": "…", "snippet": { "inline": "<script>…</script>", … } } }\n\n# 2. put snippet.inline into the <head> of every page you build\n\n# 3. read the totals (scope: reports)\ncurl "https://clx.cx/v1/sites/{id}/report?period=7d" -H "Authorization: Bearer clx_…"',
    },
    faq: {
      h: 'Questions',
      items: [
        ['Do my customers need their own Cloudflare accounts?', 'Yes: a counter runs in the account its site is served from. A customer connects it once with a bootstrap token, by hand or through your integration.'],
        ['Can footprint scanners or ad blockers spot clx?', 'No signature in the page, the URLs or the answers is shared by clx sites or names clx, beyond the browser’s own API names. Someone watching can still see the behaviour — a same-origin POST answered with an empty 204.'],
        ['Is there an SDK?', 'No: the API is plain HTTP with an OpenAPI contract, and AI agents have a walkthrough of their own.'],
        ['What does it cost?', 'The API plan is switched on by request and is free for now; Workers Paid is never required.'],
      ],
    },
    final: 'Give every site you build its own counter',
  },
  ru: {
    title: 'API счётчика и ссылок для генераторов сайтов — clx',
    description: 'Добавьте сайт через API, вставьте при сборке счётчик без общего следа и читайте итоги. clx работает в аккаунтах Cloudflare ваших клиентов. Открытый API.',
    h1: 'Статистика и короткие ссылки для сайтов, которые вы генерируете',
    lead: 'Генератор сайтов добавляет сайт через API, вставляет его счётчик в собираемые страницы и читает итоги. Каждый счётчик работает в том аккаунте Cloudflare, где обслуживается его сайт.',
    start: 'Начать бесплатно',
    flow: [
      ['Ваш генератор', 'добавляет сайт и получает сниппет'],
      ['API clx', 'ставит маршрут в аккаунт клиента'],
      ['Собранные страницы', 'считают посещения на своём домене'],
    ],
    sections: [
      {
        h: 'Без общего следа',
        p: 'У каждого сайта свой путь, свои имена файлов и свой код сниппета — из случайного зерна, и нет чужого хоста: ни в странице, ни в адресах, ни в ответах нет сигнатуры, общей для сайтов clx или похожей на clx. Что остаётся видно, честно: POST на свой же сайт при каждом просмотре с пустым ответом 204 и имена API самого браузера.',
      },
      {
        h: 'Для конвейеров сборки',
        p: 'Каждая запись идёт с ключом идемпотентности: прошедшая запись, повторённая с тем же ключом в течение суток, не вносит изменение второй раз. Ключу даются только нужные права — конвейеру хватает сайтов и отчётов.',
      },
      {
        h: 'Много клиентов, одна интеграция',
        p: 'Тариф API — 50 аккаунтов Cloudflare, 500 сайтов и 10 000 ссылок, пять ключей; ключ можно ограничить аккаунтами и IP клиента, чтобы ключ одного клиента не дотянулся до другого.',
      },
      {
        h: 'Работает с Cloudflare Pages',
        p: 'Маршрут счётчика стоит на хосте самого сайта, рядом с сайтом на Pages, и пропускает всё остальное. Расход аккаунта измеряется ежедневно, и API подскажет, когда клиенту пора на Workers Paid.',
      },
    ],
    setup: {
      h: 'Три шага в сборке',
      p: 'Когда аккаунт Cloudflare клиента подключён: добавьте сайт один раз, вставьте его сниппет в каждую страницу, читайте отчёт, когда нужно. Весь контракт — в справочнике API.',
      code: '# 1. добавить сайт (права: sites)\ncurl https://clx.cx/v1/sites \\\n  -H "Authorization: Bearer clx_…" \\\n  -H "Idempotency-Key: build-42-example.com" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"account_id":"…","host":"example.com"}\'\n# → 202 { "site": { "id": "…", "snippet": { "inline": "<script>…</script>", … } } }\n\n# 2. вставить snippet.inline в <head> каждой собранной страницы\n\n# 3. прочитать итоги (права: reports)\ncurl "https://clx.cx/v1/sites/{id}/report?period=7d" -H "Authorization: Bearer clx_…"',
    },
    faq: {
      h: 'Вопросы',
      items: [
        ['Нужны ли клиентам свои аккаунты Cloudflare?', 'Да: счётчик работает в том аккаунте, где обслуживается сайт. Клиент подключает его один раз bootstrap-токеном — сам или через вашу интеграцию.'],
        ['Найдут ли clx сканеры футпринтов или блокировщики рекламы?', 'В странице, адресах и ответах нет сигнатуры, общей для сайтов clx или похожей на clx, кроме имён API самого браузера. Наблюдатель всё же может заметить поведение — POST на свой сайт с пустым ответом 204.'],
        ['Есть ли SDK?', 'Нет: API — обычный HTTP с контрактом OpenAPI, а для ИИ-агентов есть отдельная пошаговая инструкция.'],
        ['Сколько это стоит?', 'Тариф API включается по запросу и пока бесплатен; Workers Paid не нужен.'],
      ],
    },
    final: 'Дайте каждому собранному сайту свой счётчик',
  },
};

interface PricingText extends ProductText {
  plans: { name: string; price: string; points: string[] }[];
  note: string;
}

const PRICING: Record<Locale, PricingText> = {
  en: {
    title: 'clx pricing — free, on your own Cloudflare quotas',
    description: 'clx is free: one Cloudflare account, 10 sites and 200 links on the free plan, higher limits on the API plan on request. Workers Paid is never required.',
    h1: 'Free, on your own Cloudflare quotas',
    lead: 'clx costs nothing today. The worker runs in your Cloudflare account, on its quotas, and the plans differ only in their limits.',
    start: 'Start free',
    plans: [
      { name: 'Free', price: '$0', points: ['1 Cloudflare account', '10 sites', '200 links, 10 rules each', '1 API key'] },
      { name: 'API', price: 'On request, free for now', points: ['50 Cloudflare accounts', '500 sites', '10,000 links, 10 rules each', '5 API keys, limited by account and IP'] },
    ],
    note: 'The API plan is switched on by request; the way to ask for it is coming.',
    sections: [
      {
        h: 'What Cloudflare gives for free',
        p: 'Workers Free allows 100,000 requests and 100,000 D1 writes a day per account, shared by all its workers. For a typical account that is about 11,000 counted events a day at worst, usually several times that.',
      },
      {
        h: 'When to move to Workers Paid',
        p: 'clx measures the account’s use once a day, forecasts it and warns you before a quota runs out. clx itself never requires Workers Paid.',
      },
      {
        h: 'If a quota runs out',
        p: 'Out of worker requests (100,000 a day), the counter’s path answers with an error and short links stop working; your pages themselves are not affected. Out of D1 writes, the counter stops counting and links keep redirecting. Out of D1 reads (5 million a day), links stop working too. Each lasts until the quota resets.',
      },
      {
        h: 'Paid plans later',
        p: 'Paid plans with higher limits are planned. Until then the API plan is free too.',
      },
    ],
    faq: {
      h: 'Questions',
      items: [
        ['Do I need a card?', 'No: signing up and the free plan need none.'],
        ['Does clx charge for traffic?', 'No: your visits and clicks go through your own Cloudflare account and its quotas, not through clx.cx.'],
        ['What counts towards the limits?', 'Connected Cloudflare accounts, sites, links and API keys; visits and clicks are limited only by your Cloudflare quotas.'],
      ],
    },
    final: 'Start on the free plan',
  },
  ru: {
    title: 'Тарифы clx — бесплатно, в квотах вашего Cloudflare',
    description: 'clx бесплатен: один аккаунт Cloudflare, 10 сайтов и 200 ссылок на бесплатном тарифе, лимиты выше — на тарифе API по запросу. Workers Paid не нужен.',
    h1: 'Бесплатно, в квотах вашего Cloudflare',
    lead: 'Сегодня clx ничего не стоит. Воркер работает в вашем аккаунте Cloudflare, в его квотах, а тарифы различаются только лимитами.',
    start: 'Начать бесплатно',
    plans: [
      { name: 'Free', price: 'Бесплатно', points: ['1 аккаунт Cloudflare', '10 сайтов', '200 ссылок, по 10 правил', '1 ключ API'] },
      { name: 'API', price: 'По запросу, пока бесплатно', points: ['50 аккаунтов Cloudflare', '500 сайтов', '10 000 ссылок, по 10 правил', '5 ключей API с ограничением по аккаунтам и IP'] },
    ],
    note: 'Тариф API включается по запросу; способ запросить его скоро появится.',
    sections: [
      {
        h: 'Что Cloudflare даёт бесплатно',
        p: 'Workers Free даёт аккаунту 100 000 запросов и 100 000 записей D1 в сутки — на все его воркеры. Типичному аккаунту это ~11 000 учтённых событий в сутки в худшем случае, обычно в несколько раз больше.',
      },
      {
        h: 'Когда переходить на Workers Paid',
        p: 'clx раз в сутки измеряет расход аккаунта, строит прогноз и предупреждает, пока квота не кончилась. Сам clx Workers Paid не требует никогда.',
      },
      {
        h: 'Если квота кончилась',
        p: 'Кончились запросы к воркерам (100 000 в сутки) — путь счётчика отвечает ошибкой, а короткие ссылки перестают работать; сами страницы сайта не затронуты. Кончились записи D1 — счётчик перестаёт считать, ссылки переадресуют. Кончились чтения D1 (5 млн в сутки) — ссылки тоже перестают работать. Всё это — до сброса квоты.',
      },
      {
        h: 'Платные тарифы позже',
        p: 'Платные тарифы с лимитами выше запланированы. До тех пор тариф API тоже бесплатен.',
      },
    ],
    faq: {
      h: 'Вопросы',
      items: [
        ['Нужна ли карта?', 'Нет: для регистрации и бесплатного тарифа она не нужна.'],
        ['Берёт ли clx деньги за трафик?', 'Нет: посещения и клики идут через ваш аккаунт Cloudflare и его квоты, а не через clx.cx.'],
        ['Что входит в лимиты?', 'Подключённые аккаунты Cloudflare, сайты, ссылки и ключи API; посещения и клики ограничены только квотами вашего Cloudflare.'],
      ],
    },
    final: 'Начните с бесплатного тарифа',
  },
};

/** Who does what in a site generator's build: three boxes in a row. */
function flow(steps: [string, string][]): string {
  return `<figure class="flow" aria-hidden="true">${steps.map(([h, p]) => `<div class="flow__step"><p class="flow__h">${escapeHtml(h)}</p><p>${escapeHtml(p)}</p></div>`).join('<span class="flow__arrow">→</span>')}</figure>`;
}

function plansBlock(t: PricingText): string {
  return `<div class="plans">${t.plans.map((p) => `<div class="card plan"><h2 class="h3">${escapeHtml(p.name)}</h2><p class="plan__price">${escapeHtml(p.price)}</p><ul class="ticks">${p.points.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`).join('')}</div>
<p class="demo__note">${escapeHtml(t.note)}</p>`;
}

/** The 301.st step flow (ui/css/components.css): numbered pills with arrows between them. A list, so
 *  a screen reader hears steps; the arrows are hidden from it. */
function stepFlow(steps: string[] | undefined): string {
  if (!steps?.length) return '';
  const items = steps.map((s, i) => `<li class="step-pill"><span class="step-number">${i + 1}</span><span class="step-text">${escapeHtml(s)}</span></li>`);
  return `  <ol class="step-flow hero__steps">${items.join('<li class="step-separator" aria-hidden="true">→</li>')}</ol>\n`;
}

function page(locale: Locale, t: ProductText, illustration: string): { title: string; description: string; body: string } {
  const start = `<a class="btn btn--primary btn--lg" href="${appPathFor(locale)}#/signup">${escapeHtml(t.start)}</a>`;
  const features = t.sections.length === 3 ? 'features features--3' : 'features';
  const setup = t.setup
    ? `<section class="home-section home-api">
  <div>
    <h2>${escapeHtml(t.setup.h)}</h2>
    <p>${escapeHtml(t.setup.p)}</p>
  </div>
  <pre class="code"><code>${escapeHtml(t.setup.code)}</code></pre>
</section>
`
    : '';
  const body = `<section class="hero hero--home">
  <h1>${escapeHtml(t.h1)}</h1>
  <p class="lead">${escapeHtml(t.lead)}</p>
  <p class="actions">${start}</p>
${stepFlow(t.steps)}</section>
<section class="home-demo">
${illustration}
</section>
<section class="home-section">
  <div class="${features}">${t.sections.map((x) => `<div class="card feature"><h2 class="h3">${escapeHtml(x.h)}</h2><p>${escapeHtml(x.p)}</p>${x.points ? `<ul class="ticks">${x.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>
</section>
${setup}<section class="home-section">
  <h2>${escapeHtml(t.faq.h)}</h2>
  <div class="faq">${t.faq.items.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join('')}</div>
</section>
<section class="home-final">
  <h2>${escapeHtml(t.final)}</h2>
  <p class="actions">${start}</p>
</section>`;
  return { title: t.title, description: t.description, body };
}

export const analyticsPage = (locale: Locale) => page(locale, ANALYTICS[locale], demoReport(locale, 'pages'));
export const linksPage = (locale: Locale) => page(locale, LINKS[locale], linkCard(locale, LINKS[locale].card));
export const generatorsPage = (locale: Locale) => page(locale, GENERATORS[locale], flow(GENERATORS[locale].flow));
export const pricingPage = (locale: Locale) => page(locale, PRICING[locale], plansBlock(PRICING[locale]));

/** The questions of each page, for /faq (site/faq.ts): one source, so a page and /faq cannot differ. */
export const pageQuestions = (locale: Locale) => ({
  analytics: ANALYTICS[locale].faq.items,
  links: LINKS[locale].faq.items,
  generators: GENERATORS[locale].faq.items,
  pricing: PRICING[locale].faq.items,
});
