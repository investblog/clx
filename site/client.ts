// The script of every site page (public/site.js, built by scripts/build-ui.mjs): the theme switch,
// and links to the app sent before it moved to /app. E-mails until 10.10.2026 pointed to
// `https://clx.cx/#/confirm?t=…`, `/#/reset?t=…`, `/#/accounts/…`; the part after `#` never reaches
// the server, so only the page can send them on.
if (location.pathname === '/' && location.hash.startsWith('#/')) location.replace(`/app${location.hash}`);

document.getElementById('theme')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('clx-theme', next);
  } catch {
    // private mode: the theme just isn't remembered
  }
});
