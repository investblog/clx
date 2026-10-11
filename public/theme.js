// Runs before the first paint so a light-theme reader never sees the dark frame flash. The site's
// pages and the app's load it alike, and share the header it serves (site/layout.ts).
try {
  const t = localStorage.getItem('clx-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  // Set by the app while a session lives (ui/main.ts): the header's link to the app says "Dashboard"
  // instead of "Sign in". A hint for the label only — the app still asks the server.
  if (localStorage.getItem('clx-signed-in') === '1') document.documentElement.classList.add('signed-in');
} catch {}

// The site's menu on a phone (site/layout.ts). The page is marked `js` here, and only a marked page
// folds the menu behind its button (ui/css/app.css) — so the mark and the button's handler come from
// one file and cannot part: if this file did not run, the menu stays a row of links. The handlers
// listen on the document, as the header does not exist yet; opening moves focus into the menu.
document.documentElement.classList.add('js');
document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest('#theme')) {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('clx-theme', next);
    } catch {
      // private mode: the theme just isn't remembered
    }
    return;
  }
  const button = target?.closest('#site-nav-toggle');
  if (!button) return;
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open));
  const nav = document.getElementById('site-nav');
  nav?.toggleAttribute('data-open', open);
  if (open) nav?.querySelector('a')?.focus();
});
