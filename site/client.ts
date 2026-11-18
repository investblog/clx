// The script of every site page (public/site.js, built by scripts/build-ui.mjs): links to the app sent
// before it moved to /app. E-mails until 10.10.2026 pointed to `https://clx.cx/#/confirm?t=…`,
// `/#/reset?t=…`, `/#/accounts/…`; the part after `#` never reaches the server, so only the page can
// send them on. The theme switch lives in /theme.js, shared with the app.
if (location.pathname === '/' && location.hash.startsWith('#/')) location.replace(`/app${location.hash}`);
// The Russian host has no sign-in card (ADR 0030): a form asked for there — the old clx.cx/ru#login
// comes here through its 301 with the fragment, the language switch of a card too — opens the card on
// clx.cx, with the way back (?next=).
else if (/^#(login|register|recover)$/u.test(location.hash) && document.documentElement.lang === 'ru' && !document.querySelector('[data-auth]'))
  location.replace(`https://clx.cx/ru/signin${location.search}${location.hash}`);
// A marketing or QR-only language has no card either (ADR 0047): its form opens on the English one.
else if (/^#(login|register|recover)$/u.test(location.hash) && !['en', 'ru'].includes(document.documentElement.lang) && !document.querySelector('[data-auth]'))
  location.replace(`/${location.search}${location.hash}`);

// A partner's `?ref=` (docs/spec.md §19, ADR 0048) reaches the Worker, which sets the cookie, only on
// clx.cx's home page and /ru/signin. Every other page is a static file — on clx.cx (/analytics, /sr…)
// and on the Russian host (GitHub Pages, which cannot set clx.cx's cookie anyway): it keeps the code
// for the tab and adds it to its links to those two pages, so the click to sign up carries it there.
const WORKER = 'https://clx.cx';
const WORKER_PAGES = ['/', '/ru/signin'];
if (!(location.origin === WORKER && WORKER_PAGES.includes(location.pathname))) {
  const toWorker = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((a) => {
    const url = new URL(a.href);
    return url.origin === WORKER && WORKER_PAGES.includes(url.pathname);
  });
  if (toWorker.length) {
    let ref = new URLSearchParams(location.search).get('ref');
    try {
      if (ref) sessionStorage.setItem('clx_ref', ref);
      else ref = sessionStorage.getItem('clx_ref');
    } catch {
      // No storage (a private window): the code goes on from this page only.
    }
    if (ref)
      for (const a of toWorker) {
        const url = new URL(a.href);
        url.searchParams.set('ref', ref);
        a.href = url.href;
      }
  }
}

import './auth-client.ts';

// The banners of our services (site/promo.ts): one of them, at random, in place of the first.
for (const slot of Array.from(document.querySelectorAll('.promo-slot'))) {
  const banners = Array.from(slot.querySelectorAll<HTMLElement>('[data-promo]'));
  const pick = Math.floor(Math.random() * banners.length);
  banners.forEach((b, i) => (b.hidden = i !== pick));
}
