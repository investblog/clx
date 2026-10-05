// Runs before the first paint so a light-theme reader never sees the dark frame flash.
try {
  const t = localStorage.getItem('clx-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {}
