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
  sections: { h: string; p: string; points?: string[] }[];
  setup: { h: string; p: string; code: string };
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

function page(locale: Locale, t: ProductText, illustration: string): { title: string; description: string; body: string } {
  const start = `<a class="btn btn--primary btn--lg" href="${appPathFor(locale)}#/signup">${escapeHtml(t.start)}</a>`;
  const features = t.sections.length === 3 ? 'features features--3' : 'features';
  const body = `<section class="hero hero--home">
  <h1>${escapeHtml(t.h1)}</h1>
  <p class="lead">${escapeHtml(t.lead)}</p>
  <p class="actions">${start}</p>
</section>
<section class="home-demo">
${illustration}
</section>
<section class="home-section">
  <div class="${features}">${t.sections.map((x) => `<div class="card feature"><h2 class="h3">${escapeHtml(x.h)}</h2><p>${escapeHtml(x.p)}</p>${x.points ? `<ul class="ticks">${x.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>
</section>
<section class="home-section home-api">
  <div>
    <h2>${escapeHtml(t.setup.h)}</h2>
    <p>${escapeHtml(t.setup.p)}</p>
  </div>
  <pre class="code"><code>${escapeHtml(t.setup.code)}</code></pre>
</section>
<section class="home-section">
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
