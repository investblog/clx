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

import './auth-client.ts';

// The banners of our services (site/promo.ts): one of them, at random, in place of the first.
for (const slot of Array.from(document.querySelectorAll('.promo-slot'))) {
  const banners = Array.from(slot.querySelectorAll<HTMLElement>('[data-promo]'));
  const pick = Math.floor(Math.random() * banners.length);
  banners.forEach((b, i) => (b.hidden = i !== pick));
}
