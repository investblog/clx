// The home page (docs/spec.md §16): the hero, an example report, how it works, the two tools, why
// clx, the API, the plans in short, a few questions. The example report is drawn at build time
// (site/demo.ts, ADR 0016).
import { REPO, type Locale } from './pages.ts';
import { demoReport } from './demo.ts';
import { STRINGS } from './i18n.ts';
import { escapeHtml } from './layout.ts';
import { appPathFor, pathFor } from './urls.ts';

export function home(locale: Locale): { title: string; description: string; body: string } {
  const s = STRINGS[locale].home;
  const app = appPathFor(locale);
  const start = `<a class="btn btn--primary btn--lg" href="${app}#/signup">${escapeHtml(s.start)}</a>`;
  const card = (h: string, p: string) => `<div class="card feature"><h3>${escapeHtml(h)}</h3><p>${escapeHtml(p)}</p></div>`;
  const body = `<section class="hero hero--home">
  <h1>${escapeHtml(s.h1)}</h1>
  <p class="lead">${escapeHtml(s.lead)}</p>
  <p class="actions">${start}<a class="btn btn--ghost btn--lg" href="${REPO}" rel="noopener">${escapeHtml(s.source)}</a></p>
  <p class="hero__note">${escapeHtml(s.note)}</p>
</section>
<section class="home-demo">
${demoReport(locale, 'sources')}
</section>
<section class="home-section">
  <h2>${escapeHtml(s.how.h2)}</h2>
  <ol class="home-steps">${s.how.steps.map(([h, p]) => `<li><h3>${escapeHtml(h)}</h3><p>${escapeHtml(p)}</p></li>`).join('')}</ol>
</section>
<section class="home-section">
  <h2>${escapeHtml(s.tools.h2)}</h2>
  <div class="tools">${s.tools.items.map((t) => `<div class="card tool"><h3>${escapeHtml(t.h)}</h3><p>${escapeHtml(t.p)}</p><ul class="ticks">${t.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>`).join('')}</div>
</section>
<section class="home-section">
  <h2>${escapeHtml(s.why.h2)}</h2>
  <div class="features">${s.why.items.map(([h, p]) => card(h, p)).join('')}</div>
</section>
<section class="home-section home-api">
  <div>
    <h2>${escapeHtml(s.api.h2)}</h2>
    <p>${escapeHtml(s.api.p)}</p>
    <p class="actions"><a class="btn btn--ghost" href="${pathFor('/agents', 'en')}" hreflang="en">${escapeHtml(s.api.agents)}</a><a class="btn btn--ghost" href="${pathFor('/api', 'en')}" hreflang="en">${escapeHtml(s.api.reference)}</a></p>
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
  <p class="muted">${escapeHtml(s.plans.note)}</p>
</section>
<section class="home-section">
  <h2>${escapeHtml(s.faq.h2)}</h2>
  <div class="faq">${s.faq.items.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join('')}</div>
</section>
<section class="home-final">
  <h2>${escapeHtml(s.final)}</h2>
  <p class="actions">${start}</p>
</section>`;
  return { title: s.title, description: s.description, body };
}
