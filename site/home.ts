// The home page (docs/spec.md §16): the hero, an example report, how it works, the two tools, why
// clx, the API, the plans in short, a few questions, the banners of our other services (site/promo.ts).
// The example report is drawn at build time (site/demo.ts, ADR 0016).
import { BOT_URL, REPO, isSiteLocale, siteLocaleOf, type ContentLocale } from './pages.ts';
import { authCard } from './auth.ts';
import { demoReport } from './demo.ts';
import { STRINGS } from './i18n.ts';
import { escapeHtml, seeAlso } from './layout.ts';
import { finalBlock, promoBlock } from './promo.ts';
import { appPathFor, authPathFor, pathFor, renderingHost } from './urls.ts';

export function home(locale: ContentLocale): { title: string; description: string; body: string } {
  const s = STRINGS[locale].home;
  // Signed out the first button opens the sign-up form beside the hero; signed in it leads to the app
  // (/theme.js shows one of the two before the first paint, by the app's mark).
  // On the Russian host (ADR 0030) there is no sign-in card — the API is on clx.cx, which often does
  // not open from Russia: the bot comes first, then sign-up and sign-in on clx.cx.
  // A marketing language (ADR 0047) has no card either: the app, its forms and its mail speak the site's
  // languages, so sign-up leads to the English card.
  const offsite = renderingHost() === 'ru';
  const site = siteLocaleOf(locale);
  const card = !offsite && isSiteLocale(locale);
  const start = offsite
    ? `<a class="btn btn--primary btn--lg" href="${BOT_URL}" rel="noopener">${escapeHtml(s.bot)}</a><a class="btn btn--ghost btn--lg" href="${authPathFor(site, 'register')}">${escapeHtml(s.start)}</a><a class="btn btn--ghost btn--lg" href="${authPathFor(site, 'login')}">${escapeHtml(s.signIn)}</a>`
    : `<a class="btn btn--primary btn--lg when-signed-out" href="${card ? '#register' : authPathFor(site, 'register')}">${escapeHtml(s.start)}</a><a class="btn btn--primary btn--lg when-signed-in" href="${appPathFor(site)}">${escapeHtml(STRINGS[locale].dashboard)}</a><a class="btn btn--ghost btn--lg" href="${REPO}" rel="noopener">${escapeHtml(s.source)}</a>`;
  const feature = (h: string, p: string) => `<div class="card feature"><h3>${escapeHtml(h)}</h3><p>${escapeHtml(p)}</p></div>`;
  const body = `<div class="landing" data-landing>
<section class="hero hero--home">
  <h1>${escapeHtml(s.h1)}</h1>
  <p class="lead">${escapeHtml(s.lead)}</p>
  <p class="actions">${start}</p>
  <p class="hero__note">${escapeHtml(s.note)}</p>
</section>
${card && isSiteLocale(locale) ? authCard(locale) : ''}
</div>
<section class="home-demo">
${demoReport(locale, 'sources')}
</section>
<section class="home-section">
  <h2>${escapeHtml(s.how.h2)}</h2>
  <ol class="home-steps">${s.how.steps.map(([h, p]) => `<li><h3>${escapeHtml(h)}</h3><p>${escapeHtml(p)}</p></li>`).join('')}</ol>
  ${seeAlso([[s.how.more, '/how-it-works']], locale)}
</section>
<section class="home-section">
  <h2>${escapeHtml(s.tools.h2)}</h2>
  <div class="tools">${s.tools.items.map((t) => `<div class="card tool"><h3>${escapeHtml(t.h)}</h3><p>${escapeHtml(t.p)}</p><ul class="ticks">${t.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>${seeAlso([t.link], locale)}</div>`).join('')}</div>
</section>
<section class="home-section">
  <h2>${escapeHtml(s.why.h2)}</h2>
  <div class="features">${s.why.items.map(([h, p]) => feature(h, p)).join('')}</div>
  ${seeAlso(s.why.links, locale)}
</section>
<section class="home-section home-api">
  <div>
    <h2>${escapeHtml(s.api.h2)}</h2>
    <p>${escapeHtml(s.api.p)}</p>
    <p class="actions"><a class="btn btn--ghost" href="${pathFor('/agents', 'en')}" hreflang="en">${escapeHtml(s.api.agents)}</a><a class="btn btn--ghost" href="${pathFor('/api', 'en')}" hreflang="en">${escapeHtml(s.api.reference)}</a><a class="btn btn--ghost" href="${pathFor('/for-site-generators', locale)}">${escapeHtml(s.api.generators)}</a></p>
  </div>
  <pre class="code"><code>curl https://clx.cx/v1/sites \\
  -H "Authorization: Bearer clx_…" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"account_id":"…","host":"example.com"}'

# → 202 { "site": { "snippet": { "inline": "&lt;script&gt;…", "script_tag": "…" }, … } }</code></pre>
</section>
<section class="home-section">
  <h2>${escapeHtml(s.plans.h2)}</h2>
  <div class="plans">${s.plans.items.map((p) => `<div class="card plan"><h3>${escapeHtml(p.name)}</h3><p class="plan__price">${escapeHtml(p.price)}</p><ul class="ticks">${p.points.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`).join('')}</div>
  <p class="muted">${escapeHtml(s.plans.note)} <a href="${pathFor('/pricing', locale)}">${escapeHtml(s.plans.more)} →</a></p>
</section>
<section class="home-section">
  <h2>${escapeHtml(s.faq.h2)}</h2>
  <div class="faq">${s.faq.items.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join('')}</div>
  <p class="faq__more"><a href="${pathFor('/faq', locale)}">${escapeHtml(s.faq.more)} →</a></p>
</section>
${promoBlock(locale)}
${finalBlock(locale, s.final, s.start)}`;
  return { title: s.title, description: s.description, body };
}
