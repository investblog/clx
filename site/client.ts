// The script of every site page (public/site.js, built by scripts/build-ui.mjs): links to the app sent
// before it moved to /app. E-mails until 10.10.2026 pointed to `https://clx.cx/#/confirm?t=…`,
// `/#/reset?t=…`, `/#/accounts/…`; the part after `#` never reaches the server, so only the page can
// send them on. The theme switch lives in /theme.js, shared with the app.
if (location.pathname === '/' && location.hash.startsWith('#/')) location.replace(`/app${location.hash}`);
