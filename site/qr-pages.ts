// The free QR code tools (docs/spec.md §16, ADRs 0044, 0045): /qr-code-generator — the generator,
// drawn in the browser by /qr.js (site/qr.ts); /qr-code-api — the API at qr.clx.cx, in English like
// /api; /qr-code-extension — the browser extension. clx itself is a line at the end, not the page's
// call: there is no sign-up button in the hero and no closing banner. Every fact about the API is the
// worker's (github.com/investblog/qr-generator at the commit scripts/deploy-qr.mjs pins) and was
// measured on qr.clx.cx (scripts/probe-qr.mjs, docs/cloudflare-facts.md).
import { escapeHtml, seeAlso } from './layout.ts';
import type { PageLocale } from './pages.ts';
import { API, EXTENSION_NAME, MAX_DATA, PRESETS, svgFor } from './qr-core.ts';
import { QR_TEXT } from './qr-i18n/index.ts';
import type { ExtensionText, GeneratorText } from './qr-text.ts';
import { pagePathFor, pathFor } from './urls.ts';
/** Its listings, by store id (the slugs carry the old name and may stay): the browser, its icon in
 *  /icons.svg, the store's name and the listing. No Opera: its store takes no new extensions. */
const STORES: { browser: string; icon: string; store: string; url: string }[] = [
  { browser: 'Chrome', icon: 'chrome', store: 'Chrome Web Store', url: 'https://chromewebstore.google.com/detail/qrcgen-qr-code-generator/jmajfmmdjbnmcjmkfffblmolhleklglg' },
  { browser: 'Firefox', icon: 'firefox', store: 'Firefox Add-ons', url: 'https://addons.mozilla.org/firefox/addon/qrcgen-qr-code-generator/' },
  { browser: 'Edge', icon: 'edge', store: 'Microsoft Edge Add-ons', url: 'https://microsoftedge.microsoft.com/addons/detail/qrcgen-qr-code-generator/hibgblidmmohfjfompehcajiefijcnjg' },
];
/** A button per store, with the browser's icon; `label` names the button by its store or browser. */
const storeButtons = (label: 'store' | 'browser', cls = 'btn btn--ghost') =>
  STORES.map((s) => `<a class="${cls}" href="${s.url}" rel="noopener"><svg class="icon" aria-hidden="true"><use href="/icons.svg#i-brand-${s.icon}"></use></svg>${escapeHtml(label === 'store' ? s.store : s.browser)}</a>`).join('');
const SOURCE = { worker: 'https://github.com/investblog/qr-generator', library: 'https://github.com/investblog/qr-svg' };

type Page = { title: string; description: string; body: string; script?: string };

/** A link to an English-only page from any page: English is always on clx.cx. */
const en = (slug: string, text: string) => `<a href="${pathFor(slug, 'en')}" hreflang="en">${escapeHtml(text)}</a>`;
const code = (s: string) => `<pre><code>${escapeHtml(s)}</code></pre>`;

const SAMPLE = 'https://example.com';

const GENERATOR: Record<PageLocale, GeneratorText> = {
  en: {
    title: 'Free SVG QR code generator, no sign-up — clx',
    description: 'Make a QR code as a small SVG in your browser: pick the size and error correction, download it, or copy a link to the image for your page. Free, no sign-up.',
    h1: 'Free SVG QR code generator',
    lead: 'Type a URL or any text: the QR code is drawn in your browser as a small SVG — one rectangle and one path — sharp at any size. Download it, copy it, or take a link to the same image to put on a page.',
    form: { data: 'Text or URL', hint: `Up to ${MAX_DATA.toLocaleString('en')} characters. How much fits in one code depends on the text and the error correction.`, size: 'Size', ecc: 'Error correction', quiet: 'Margin (modules)' },
    ecc: { L: 'L — 7%', M: 'M — 15%', Q: 'Q — 25%', H: 'H — 30%' },
    out: { download: 'Download SVG', svg: 'Copy SVG', link: 'Image link', copyLink: 'Copy link', embed: 'HTML for your page', copyEmbed: 'Copy HTML', noscript: 'The generator needs JavaScript. Without it, use the API: a link with your text in it gives you the image.' },
    t: { empty: 'Type a text or a URL.', tooLong: `The text is longer than ${MAX_DATA.toLocaleString('en')} characters.`, noFit: 'This text does not fit one QR code: shorten it or lower the error correction.', ready: 'SVG, {bytes} bytes.', copied: 'Copied.', failed: 'The browser did not allow copying: select the text and copy it yourself.', alt: 'QR code' },
    sections: [
      { h: 'Why SVG', p: 'A vector QR code stays sharp on a phone, in print and on a billboard. This one is about 3 KB for a short URL: a white rectangle and one path of whole-number coordinates, nothing else — easy to edit, to inline in HTML and to send through any pipeline.' },
      { h: 'Nothing leaves your browser', p: 'The code is drawn on this page, by the open @spintax/qr-svg library. What you type is not sent anywhere — no request carries it — and the generator needs no account and sets no cookie.' },
      { h: 'A link to the same image', p: 'The image link points to the free API at qr.clx.cx, which draws the very same SVG from the text in the link. Put it in an <img> tag, a README or an e-mail; the link itself carries the text, so we keep nothing.' },
      { h: 'Track the scans', p: 'A plain QR code cannot tell you who scanned it. Point it at a clx short link on your own domain, and scans are counted as their own source, by country and device — free, in your Cloudflare account.' },
    ],
    faq: {
      h: 'Questions',
      items: [
        ['Is the generator free?', 'Yes, with no sign-up and no limit on how many codes you make: they are drawn in your browser. The API at qr.clx.cx needs no key either.'],
        ['How do I open a page from my computer on my phone?', 'Paste the page’s address here, scan the code with the phone’s camera and tap the link that appears: the page opens on the phone — no sending the link to yourself, no account. The browser extension spares you the pasting: it makes the code of the page you are on.'],
        ['Is there a browser extension?', `Yes, a free one: ${EXTENSION_NAME}, for Chrome, Firefox and Edge. In a side panel it makes a QR code for the page you are on or for any text — an SVG, a link and snippets to embed, as here — and sends nothing anywhere.`],
        ['Do QR codes made here expire?', 'No. A QR code holds its text itself; it works as long as what it points to does. The image link works as long as the API does.'],
        ['Which error correction should I choose?', 'M for screens and most print; Q or H for print that may get scratched or a logo laid over it. Higher levels make the code denser.'],
        ['Can I change where a printed code leads?', 'Not with a plain QR code: its text is fixed. Encode a short link instead, and change the link’s target whenever you like.'],
        ['Is a QR code private?', 'No. Anyone who scans it, or opens its image link, reads its text. Do not encode passwords or other secrets.'],
      ] as [string, string][],
    },
    ext: { link: 'Free browser extension →', group: `Install ${EXTENSION_NAME}` },
    more: [['The QR code API', '/qr-code-api'], ['The browser extension', '/qr-code-extension'], ['Privacy of the QR tools', '/qr-code-privacy'], ['Short links with QR codes', '/short-links']] as [string, string][],
  },
  ru: {
    title: 'Генератор QR-кодов в SVG бесплатно — clx',
    description: 'Создайте QR-код в SVG прямо в браузере: выберите размер и коррекцию ошибок, скачайте файл или скопируйте ссылку на картинку. Бесплатно, без регистрации.',
    h1: 'Бесплатный генератор QR-кодов в SVG',
    lead: 'Введите адрес или любой текст: QR-код рисуется в вашем браузере как лёгкий SVG — один прямоугольник и один контур, чёткий в любом размере. Скачайте его, скопируйте или возьмите ссылку на ту же картинку для своей страницы.',
    form: { data: 'Текст или адрес', hint: `До ${MAX_DATA.toLocaleString('ru')} символов. Сколько поместится в один код, зависит от текста и уровня коррекции.`, size: 'Размер', ecc: 'Коррекция ошибок', quiet: 'Поле (модулей)' },
    ecc: { L: 'L — 7%', M: 'M — 15%', Q: 'Q — 25%', H: 'H — 30%' },
    out: { download: 'Скачать SVG', svg: 'Копировать SVG', link: 'Ссылка на картинку', copyLink: 'Копировать ссылку', embed: 'HTML для страницы', copyEmbed: 'Копировать HTML', noscript: 'Генератору нужен JavaScript. Без него пользуйтесь API: ссылка с вашим текстом отдаёт картинку.' },
    t: { empty: 'Введите текст или адрес.', tooLong: `Текст длиннее ${MAX_DATA.toLocaleString('ru')} символов.`, noFit: 'Текст не помещается в один QR-код: сократите его или снизьте коррекцию ошибок.', ready: 'SVG, {bytes} байт.', copied: 'Скопировано.', failed: 'Браузер не дал скопировать: выделите текст и скопируйте сами.', alt: 'QR-код' },
    sections: [
      { h: 'Почему SVG', p: 'Векторный QR-код остаётся чётким на телефоне, в печати и на баннере. Этот весит около 3 КБ для короткого адреса: белый прямоугольник и один контур в целых координатах, больше ничего — его легко править, вставить в HTML и пропустить через любой конвейер.' },
      { h: 'Ничего не уходит из браузера', p: 'Код рисуется на этой странице открытой библиотекой @spintax/qr-svg. Введённый текст никуда не отправляется — ни один запрос его не несёт, — а генератору не нужна учётная запись и он не ставит cookie.' },
      { h: 'Ссылка на ту же картинку', p: 'Ссылка на картинку ведёт на бесплатный API qr.clx.cx — он рисует тот же самый SVG по тексту из ссылки. Вставьте её в тег <img>, README или письмо; текст лежит в самой ссылке, поэтому мы ничего не храним. API работает на Cloudflare: из России такие картинки могут не открываться без VPN — тогда скачайте SVG.' },
      { h: 'Считайте сканирования', p: 'Обычный QR-код не скажет, кто его отсканировал. Направьте его на короткую ссылку clx на вашем домене — сканирования посчитаются отдельным источником, по странам и устройствам. Бесплатно, в вашем аккаунте Cloudflare.' },
    ],
    faq: {
      h: 'Вопросы',
      items: [
        ['Генератор бесплатный?', 'Да, без регистрации и без ограничения числа кодов: они рисуются в вашем браузере. API qr.clx.cx тоже работает без ключа.'],
        ['Как открыть страницу с компьютера на телефоне?', 'Вставьте сюда адрес страницы, отсканируйте код камерой телефона и нажмите появившуюся ссылку — страница откроется на телефоне, без пересылки ссылки самому себе и без входа в аккаунт. Расширение для браузера избавляет от вставки: оно делает код открытой страницы.'],
        ['Есть расширение для браузера?', `Да, бесплатное: ${EXTENSION_NAME} для Chrome, Firefox и Edge. В боковой панели оно делает QR-код для открытой страницы или любого текста — SVG, ссылку и код для вставки, как здесь, — и ничего никуда не отправляет.`],
        ['QR-коды отсюда перестают работать?', 'Нет. QR-код хранит текст в себе и работает, пока работает то, куда он ведёт. Ссылка на картинку работает, пока работает API.'],
        ['Какую коррекцию ошибок выбрать?', 'M — для экранов и большинства печати; Q или H — для печати, которую могут поцарапать, или если поверх кладётся логотип. Чем выше уровень, тем плотнее код.'],
        ['Можно поменять, куда ведёт напечатанный код?', 'С обычным QR-кодом — нет: его текст неизменен. Закодируйте короткую ссылку и меняйте её цель когда угодно.'],
        ['QR-код — это тайна?', 'Нет. Любой, кто его отсканирует или откроет ссылку на картинку, прочтёт текст. Не кодируйте пароли и другие секреты.'],
      ] as [string, string][],
    },
    ext: { link: 'Бесплатное расширение для браузера →', group: `Установить ${EXTENSION_NAME}` },
    more: [['Короткие ссылки с QR-кодами', '/short-links'], ['Расширение для браузера', '/qr-code-extension'], ['Конфиденциальность QR-инструментов', '/qr-code-privacy']] as [string, string][],
    api: 'API qr.clx.cx (English)',
  },
  de: QR_TEXT.de.generator,
  es: QR_TEXT.es.generator,
  fr: QR_TEXT.fr.generator,
  'pt-br': QR_TEXT['pt-br'].generator,
  tr: QR_TEXT.tr.generator,
};

const options = (items: [string, string][], selected: string) => items.map(([v, label]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');

export function generatorPage(locale: PageLocale): Page {
  const g = GENERATOR[locale];
  const first = svgFor(SAMPLE, 'sq250', 'M', 2)!;
  const bytes = new TextEncoder().encode(first).length;
  const field = (id: string, label: string, control: string) => `<div class="field"><label for="${id}">${escapeHtml(label)}</label>${control}</div>`;
  const tool = `<section class="qr-tool card">
  <form id="qr-form" class="qr-tool__form" data-t="${escapeHtml(JSON.stringify(g.t))}">
    <div class="field"><label for="qr-data">${escapeHtml(g.form.data)}</label><textarea id="qr-data" name="data" class="textarea" rows="4" spellcheck="false">${SAMPLE}</textarea><p class="field-hint">${escapeHtml(g.form.hint)}</p></div>
    <div class="qr-tool__options">
      ${field('qr-size', g.form.size, `<select id="qr-size" name="p" class="input">${options(Object.entries(PRESETS).map(([id, px]) => [id, `${px} × ${px} px`]), 'sq250')}</select>`)}
      ${field('qr-ecc', g.form.ecc, `<select id="qr-ecc" name="ecc" class="input">${options(Object.entries(g.ecc), 'M')}</select>`)}
      ${field('qr-quiet', g.form.quiet, `<select id="qr-quiet" name="q" class="input">${options(['0', '1', '2', '3', '4', '6', '8'].map((n) => [n, n]), '2')}</select>`)}
    </div>
  </form>
  <div class="qr-tool__out">
    <div class="qr-tool__stage"><div id="qr-preview" class="qr-tool__preview">${first}</div></div>
    <p id="qr-status" class="qr-tool__status" role="status" aria-live="polite">${escapeHtml(g.t.ready.replace('{bytes}', String(bytes)))}</p>
    <p class="actions"><button type="button" class="btn btn--primary" id="qr-download" disabled>${escapeHtml(g.out.download)}</button><button type="button" class="btn btn--ghost" id="qr-copy-svg" disabled>${escapeHtml(g.out.svg)}</button></p>
    <p class="field-label">${escapeHtml(g.out.link)}</p>
    <p class="qr-tool__code"><code id="qr-link"></code></p>
    <p class="actions"><button type="button" class="btn btn--ghost btn--sm" id="qr-copy-link" disabled>${escapeHtml(g.out.copyLink)}</button></p>
    <p class="field-label">${escapeHtml(g.out.embed)}</p>
    <p class="qr-tool__code"><code id="qr-embed"></code></p>
    <p class="actions"><button type="button" class="btn btn--ghost btn--sm" id="qr-copy-embed" disabled>${escapeHtml(g.out.copyEmbed)}</button></p>
    <noscript><p>${escapeHtml(g.out.noscript)} ${en('/qr-code-api', 'qr.clx.cx')}</p></noscript>
  </div>
</section>`;
  const more = locale === 'en' ? seeAlso(g.more, locale) : `<p class="see-also">${g.more.map(([name, slug]) => `<a href="${pagePathFor(slug, locale)}">${escapeHtml(name)} →</a>`).join('')}${en('/qr-code-api', `${g.api ?? 'API qr.clx.cx'} →`)}</p>`;
  const body = `<section class="hero qr-hero">
  <h1>${escapeHtml(g.h1)}</h1>
  <p class="lead">${escapeHtml(g.lead)}</p>
  <div class="qr-hero__stores"><a href="${pathFor('/qr-code-extension', locale)}">${escapeHtml(g.ext.link)}</a><span class="qr-hero__buttons" role="group" aria-label="${escapeHtml(g.ext.group)}">${storeButtons('browser', 'btn btn--ghost btn--sm')}</span></div>
</section>
${tool}
<section class="home-section">
  <div class="features">${g.sections.map((x) => `<div class="card feature"><h2 class="h3">${escapeHtml(x.h)}</h2><p>${escapeHtml(x.p)}</p></div>`).join('')}</div>
  ${more}
</section>
<section class="home-section">
  <h2>${escapeHtml(g.faq.h)}</h2>
  <div class="faq">${g.faq.items.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join('')}</div>
</section>`;
  return { title: g.title, description: g.description, body, script: '/qr.js' };
}

/** The generator's questions, for its FAQPage JSON-LD (site/build.ts). */
export const generatorQuestions = (locale: PageLocale): [string, string][] => GENERATOR[locale].faq.items;

export function apiPage(): Page {
  const example = 'https://example.com';
  const row = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const table = (head: string[], rows: string[][]) => `<div class="table-wrap"><table class="table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>`;
  const body = `<article class="doc">
<h1>QR code API</h1>
<p class="lead">A free HTTP API that draws QR codes as small SVG images. No key, no account, nothing stored: the text to encode is in the URL, and the image is drawn from it on every request. The <a href="${pathFor('/qr-code-generator', 'en')}">QR code generator</a> and the ${en('/qr-code-extension', 'browser extension')} make its links for you.</p>
<p>Base URL: <code>${API}</code></p>

<h2>Quick start</h2>
${code(`<img src="${API}/qr.inline?data=https%3A%2F%2Fexample.com" width="250" height="250" alt="QR code">`)}
<p>Percent-encode the text (<code>encodeURIComponent</code>; for Markdown also <code>! ' ( ) *</code>), or <code>&amp;</code>, <code>#</code> and the like cut it short.</p>

<h2>Parameters</h2>
${table(
  ['Name', 'Default', 'Meaning'],
  [
    ['<code>data</code>', 'required', `The text or URL, at most ${MAX_DATA.toLocaleString('en')} characters (UTF-16 units: an emoji counts two), trimmed of spaces at both ends.`],
    ['<code>p</code>', '<code>sq250</code>', `Size: ${Object.entries(PRESETS).map(([id, px]) => `<code>${id}</code> (${px} px)`).join(', ')}. The SVG's width and height; its viewBox is in modules.`],
    ['<code>ecc</code>', '<code>M</code>', 'Error correction: <code>L</code> 7%, <code>M</code> 15%, <code>Q</code> 25%, <code>H</code> 30%; lower case is accepted.'],
    ['<code>q</code>', '<code>2</code>', 'The margin (quiet zone) in modules, 0–16.'],
  ],
)}

<h2>Endpoints</h2>
<p>All are <code>GET</code>; any other method, and any other path, answers <code>404</code>.</p>
<h3><code>GET /qr.inline</code> — the image</h3>
<p>Answers <code>200</code> with the SVG (<code>image/svg+xml; charset=utf-8</code>). Cached at Cloudflare's edge by the full URL for 24 hours (<code>Cache-Control: public, max-age=86400</code>; <code>X-QR-Cache: HIT</code> or <code>MISS</code>).</p>
<h3><code>GET /qr.svg</code> — a permanent link</h3>
<p>Answers <code>302</code> to the canonical URL of the same image (the redirect may be cached for an hour):</p>
${code(`GET ${API}/qr.svg?data=${encodeURIComponent(example)}&ecc=H
→ 302 Location: /qr/sq250/<sha256>.svg?data=https%3A%2F%2Fexample.com&ecc=H&q=2`)}
<h3><code>GET /qr/&lt;preset&gt;/&lt;sha256&gt;.svg?data=…&amp;ecc=…&amp;q=…</code> — canonical URL</h3>
<p>The same parameters always give the same URL. <code>data</code>, <code>ecc</code> and <code>q</code> are all required, and the hash in the path must be SHA-256 (hex) of the UTF-8 string</p>
${code('${data}|p=${preset}|ecc=${ecc}|q=${q}|fg=000|bg=fff|r=v1')}
<p>with <code>data</code> trimmed and <code>ecc</code> in upper case. Otherwise the answer is <code>400</code>, and so is a URL without its query: links handed out by extension versions before 1.1.0 had none and no longer work. A matching request is drawn afresh, nothing is cached on the server, and the answer may be kept by browsers for a year:</p>
${code(`Content-Type: image/svg+xml; charset=utf-8
Cache-Control: public, max-age=31536000, immutable
ETag: "<sha256>"`)}
<p>Cloudflare sends the ETag as weak (<code>W/"&lt;sha256&gt;"</code>) when it compresses the answer; the hash is the same. In JavaScript:</p>
${code(`const payload = \`\${data}|p=\${preset}|ecc=\${ecc}|q=\${q}|fg=000|bg=fff|r=v1\`;
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
const url = \`${API}/qr/\${preset}/\${hash}.svg?data=\${encodeURIComponent(data)}&ecc=\${ecc}&q=\${q}\`;`)}

<h2>Limits and errors</h2>
<ul>
<li>More than ${MAX_DATA.toLocaleString('en')} characters: <code>413</code>.</li>
<li>One QR code holds at most 2,953 bytes of UTF-8 at <code>ecc=L</code>, less at higher levels: a Latin letter is one byte, a Cyrillic one two, € or a Chinese character three. Text that does not fit answers <code>500</code>. The longest URL that still gives an image is about 9 KB, well under what Cloudflare accepts.</li>
<li>A missing or wrong parameter, or a hash that does not match: <code>400</code>.</li>
<li>Errors are JSON: <code>{"error": "Hash does not match the parameters"}</code>.</li>
</ul>
<p>No key and no account. There is no rate limit; one may come if the service is abused.</p>

<h2>The SVG</h2>
<p>One <code>&lt;svg&gt;</code> with <code>shape-rendering="crispEdges"</code>, a white <code>&lt;rect&gt;</code> and one black <code>&lt;path&gt;</code> on whole-number coordinates — about 3 KB for a short URL at 250 px. The generator page draws it with <a href="${SOURCE.library}">@spintax/qr-svg</a> byte for byte the same as the API.</p>

<h2>Embedding</h2>
${code(`<!-- HTML -->
<img src="${API}/qr.inline?data=YOUR_TEXT" width="250" height="250" alt="QR code">

<!-- Markdown -->
![QR code](${API}/qr.inline?data=YOUR_TEXT)`)}
<p>Inside HTML, write <code>&amp;</code> between parameters as <code>&amp;amp;</code>.</p>

<h2>Privacy</h2>
<p>The API keeps no logs and stores nothing; only <code>/qr.inline</code> answers stay in Cloudflare's cache for 24 hours. A page that shows a QR image sends its visitor's request — address, browser, the page as referrer — to Cloudflare, which runs qr.clx.cx. A QR code is not a secret: anyone with the link reads its text. The details: <a href="${pathFor('/qr-code-privacy', 'en')}">privacy of the QR tools</a>.</p>
<p>The API is open source under MIT: <a href="${SOURCE.worker}">github.com/investblog/qr-generator</a>.</p>
</article>`;
  return { title: 'QR code API: free SVG QR codes over HTTP — clx', description: 'A free API for QR codes as small SVG images: no key, no account, nothing stored. Endpoints, parameters, the canonical URL and its hash, limits, errors.', body };
}

const EXTENSION: Record<PageLocale, ExtensionText> = {
  en: {
    title: 'QR code generator browser extension — clx',
    description: 'A free browser extension that makes SVG QR codes in a side panel for the page you are on or any text: download, copy, share a link or an embed snippet.',
    lead: `${EXTENSION_NAME} is a free browser extension that makes a QR code in a side panel — for the page you are on or for any text — as a small SVG, with a link and snippets to embed it. It sends nothing anywhere.`,
    install: 'Install',
    blocks: [
      ['Getting started', ['Click the extension’s icon: its side panel opens (a sidebar in Firefox).', 'With “Auto-generate on open”, it shows a QR code for the current page at once.', 'To open the same page on your phone, scan the code with the phone’s camera and tap the link that appears: no sending the link to yourself.', 'Copy the share link, copy or download the SVG, or take a snippet from the Embed tab.']],
      ['Generate', ['Current page — the address of the active tab; press refresh after you move to another page.', `Custom input — any URL or text, up to ${MAX_DATA.toLocaleString('en')} characters (an emoji counts two).`, 'Size: 125, 200, 250 or 300 px. ECC (error correction): L 7%, M 15%, Q 25%, H 30% — higher is sturdier but denser.', 'Copy Share Link — a link to the image on the QR code API, with the text in it; there is none for text over 2,048 characters. Copy SVG and Download SVG work for any code.']],
      ['Embed', ['Snippets with the same link: HTML <img>, HTML <object>, Markdown, React and Vue — Copy Snippet, or Copy Canonical URL for the link alone.', 'Links copied with versions before 1.1.0 had no text in them and no longer work: copy them again from History.']],
      ['History and settings', ['A code is saved to History when you press Copy Share Link on the Generate tab: its text, the time, size and ECC. Clear all removes it.', 'Settings: default size and ECC, Auto-generate on open, History limit (25, 50 or 100), the theme.', 'History and settings stay in your browser (storage.local) and are not synced.']],
      ['Privacy and permissions', ['From version 1.1.0 the extension makes no network requests: codes and links are made in the browser. Earlier versions sent each code’s text to the old API.', 'A share link carries its text: whoever opens it or scans the code can read it.', 'Permissions: side panel (its window; Firefox has a sidebar and needs none), storage (settings and history), tabs (the address of the current page).']],
    ] as [string, string[]][],
    more: 'The policy in full: ',
    policy: 'privacy of the QR tools',
    api: 'The QR code API it links to:',
    also: [['QR code generator on the web', '/qr-code-generator']] as [string, string][],
  },
  ru: {
    title: 'Расширение для браузера: генератор QR-кодов — clx',
    description: 'Бесплатное расширение для браузера: SVG QR-коды в боковой панели для открытой страницы или любого текста — скачать, скопировать, дать ссылку или встроить.',
    lead: `${EXTENSION_NAME} — бесплатное расширение для браузера: QR-код в боковой панели для открытой страницы или любого текста, лёгким SVG, со ссылкой и готовым кодом для вставки. Оно ничего никуда не отправляет.`,
    install: 'Установить',
    blocks: [
      ['Начало', ['Нажмите значок расширения — откроется боковая панель (в Firefox — боковая колонка).', 'С настройкой «Авто-генерация при открытии» она сразу покажет QR-код текущей страницы.', 'Чтобы открыть ту же страницу на телефоне, отсканируйте код камерой телефона и нажмите появившуюся ссылку — не нужно пересылать её самому себе.', 'Скопируйте ссылку, скопируйте или скачайте SVG, либо возьмите сниппет на вкладке «Код».']],
      ['Создать', ['«Текущая страница» — адрес активной вкладки; после перехода на другую страницу нажмите кнопку обновления.', `«Свой текст» — любой адрес или текст, до ${MAX_DATA.toLocaleString('ru')} символов (эмодзи считается за два).`, 'Размер: 125, 200, 250 или 300 px. ECC (коррекция ошибок): L 7%, M 15%, Q 25%, H 30% — выше уровень, прочнее код, но плотнее.', '«Скопировать ссылку» — ссылка на картинку в API QR-кодов, с текстом внутри; для текста длиннее 2048 символов её нет. «Скопировать SVG» и «Скачать SVG» работают для любого кода.']],
      ['Код', ['Сниппеты с той же ссылкой: HTML <img>, HTML <object>, Markdown, React и Vue — «Скопировать сниппет» или «Скопировать URL», если нужна только ссылка.', 'Ссылки, скопированные в версиях до 1.1.0, не содержали текста и больше не работают: скопируйте их заново из истории.']],
      ['История и настройки', ['Код попадает в историю, когда вы нажимаете «Скопировать ссылку» на вкладке «Создать»: текст, время, размер и ECC. «Очистить» удаляет историю.', 'Настройки: размер и уровень ECC по умолчанию, «Авто-генерация при открытии», «Лимит истории» (25, 50 или 100), тема.', 'История и настройки хранятся в вашем браузере (storage.local) и не синхронизируются.']],
      ['Приватность и разрешения', ['С версии 1.1.0 расширение не делает сетевых запросов: коды и ссылки создаются в браузере. Прежние версии отправляли текст каждого кода старому API.', 'Ссылка несёт свой текст: его прочтёт любой, кто её откроет или отсканирует код. Картинки по ссылкам рисует API на Cloudflare — из России они могут не открываться без VPN; SVG из расширения работает везде.', 'Разрешения: боковая панель (окно расширения; в Firefox — боковая колонка, разрешение не нужно), хранилище (настройки и история), вкладки (адрес текущей страницы).']],
    ] as [string, string[]][],
    more: 'Политика целиком: ',
    policy: 'конфиденциальность QR-инструментов',
    api: 'API, на который ведут его ссылки:',
    also: [['Генератор QR-кодов на сайте', '/qr-code-generator']] as [string, string][],
  },
  de: QR_TEXT.de.extension,
  es: QR_TEXT.es.extension,
  fr: QR_TEXT.fr.extension,
  'pt-br': QR_TEXT['pt-br'].extension,
  tr: QR_TEXT.tr.extension,
};

export function extensionPage(locale: PageLocale): Page {
  const x = EXTENSION[locale];
  const stores = storeButtons('store');
  const body = `<article class="doc">
<h1>${escapeHtml(EXTENSION_NAME)}</h1>
<p class="lead">${escapeHtml(x.lead)}</p>
<h2>${escapeHtml(x.install)}</h2>
<p class="actions">${stores}</p>
${x.blocks.map(([h, items]) => `<h2>${escapeHtml(h)}</h2>\n<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`).join('\n')}
<p>${escapeHtml(x.more)}<a href="${pathFor('/qr-code-privacy', locale)}">${escapeHtml(x.policy)}</a>. ${escapeHtml(x.api)} ${en('/qr-code-api', 'qr.clx.cx')}.</p>
${seeAlso(x.also, locale)}
</article>`;
  return { title: x.title, description: x.description, body };
}
