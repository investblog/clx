// Runs before the first paint so a light-theme reader never sees the dark frame flash.
try {
  const t = localStorage.getItem('clx-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {}

// The site's menu on a phone (site/layout.ts). The page is marked `js` here, and only a marked page
// folds the menu behind its button (ui/css/app.css) — so the mark and the button's handler come from
// one file and cannot part: if this file did not run, the menu stays a row of links. The handler
// listens on the document, as the header does not exist yet; opening moves focus into the menu.
document.documentElement.classList.add('js');
document.addEventListener('click', (e) => {
  const button = e.target instanceof Element ? e.target.closest('#site-nav-toggle') : null;
  if (!button) return;
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open));
  const nav = document.getElementById('site-nav');
  nav?.toggleAttribute('data-open', open);
  if (open) nav?.querySelector('a')?.focus();
});
