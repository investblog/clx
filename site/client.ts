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

// A partner's `?ref=` (docs/spec.md §19) on the Russian host: GitHub Pages cannot set clx.cx's cookie,
// so the code rides on this tab's links to the sign-in card on clx.cx, whose Worker sets it.
const signIn = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="https://clx.cx/ru/signin"]'));
if (signIn.length) {
  let ref = new URLSearchParams(location.search).get('ref');
  try {
    if (ref) sessionStorage.setItem('clx_ref', ref);
    else ref = sessionStorage.getItem('clx_ref');
  } catch {
    // No storage (a private window): the code goes on from this page only.
  }
  if (ref)
    for (const a of signIn) {
      const url = new URL(a.href);
      url.searchParams.set('ref', ref);
      a.href = url.href;
    }
}

import './auth-client.ts';

// The banners of our services (site/promo.ts): one of them, at random, in place of the first.
for (const slot of Array.from(document.querySelectorAll('.promo-slot'))) {
  const banners = Array.from(slot.querySelectorAll<HTMLElement>('[data-promo]'));
  const pick = Math.floor(Math.random() * banners.length);
  banners.forEach((b, i) => (b.hidden = i !== pick));
}
