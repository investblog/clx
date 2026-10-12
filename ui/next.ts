// The way back after sign-in (ADR 0026): the app, signed out, sends the visitor to the home page's
// card with the page asked for as `?next=`; the card's sign-in comes back to it. Both sides here.

/** The card on `home` that comes back to the app page of `hash` (`#/sites` → `/?next=%2Fsites#login`). */
export function signInPath(home: string, hash: string): string {
  const route = hash.replace(/^#/u, '');
  return `${home}${route && route !== '/' ? `?next=${encodeURIComponent(route)}` : ''}#login`;
}

/** The app route `?next=` asks for in `search`, or `/`: an app route only, put after the app's own
 *  `#` — so never another address. */
export function nextRoute(search: string): string {
  const next = new URLSearchParams(search).get('next') ?? '';
  return /^\/(?!\/)[\w\-/?=&.]{1,200}$/u.test(next) ? next : '/';
}
