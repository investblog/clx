// The page's entry: the row of the app's sections (under the site's header), sign-in, the hash router over the
// pages, the language (ADRs 0015, 0021).
import { accountPage, accountsPage, connectPage, failure, keysPage } from './accounts';
import { call, get, logout, refresh, SignedOut, type Me } from './api';
import { pageBusy } from './busy';
import { h, s } from './dom';
import { appPath, asLocale, homePath, pageLocale, setLocale, t } from './i18n';
import { signInPath } from './next';
import { linkPage, linksPage } from './links';
import { mePage, unconfirmedBanner } from './me';
import { reportPage } from './report';
import { confirmPage, resetPage } from './signup';
import { sitePage, sitesPage } from './sites';

const shell = document.getElementById('shell')!;
const app = document.getElementById('app')!;
let seq = 0; // a newer route wins: an older answer that arrives late is dropped
let flash = '';

const icon = (name: string) => s('svg', { class: 'icon', 'aria-hidden': 'true' }, s('use', { href: `/icons.svg#i-mono-${name}` }));

type Section = 'accounts' | 'sites' | 'links' | 'keys' | 'me';
const NAV: [Section, string][] = [
  ['accounts', '#/'],
  ['sites', '#/sites'],
  ['links', '#/links'],
  ['keys', '#/keys'],
  ['me', '#/me'],
];
const sectionOf = (path: string): Section => (path.startsWith('/sites') ? 'sites' : path.startsWith('/links') ? 'links' : path === '/keys' ? 'keys' : path === '/me' ? 'me' : 'accounts');

/** Whether this browser has a session, for the site's header: its link to the app says "Dashboard"
 *  then (public/theme.js reads the mark before the first paint). */
function markSignedIn(on: boolean): void {
  document.documentElement.classList.toggle('signed-in', on);
  try {
    if (on) localStorage.setItem('clx-signed-in', '1');
    else localStorage.removeItem('clx-signed-in');
  } catch {
    // private mode: the site just says "Sign in"
  }
}

/** The row of the app's sections under the site's header (site/build.ts prints the header, the menu
 *  and the theme switch of public/theme.js); with `current`, the sections and the sign-out button,
 *  else empty. */
function drawShell(current?: Section): void {
  if (!current) return void shell.replaceChildren();
  const nav = h('nav', { class: 'shell-nav', 'aria-label': 'clx' }, ...NAV.map(([id, href]) => h('a', { href, ...(id === current ? { 'aria-current': 'page' } : {}) }, t.shell.nav[id])));
  const out = h('button', { type: 'button', class: 'btn-close', 'aria-label': t.shell.signOut, title: t.shell.signOut }, icon('log-out'));
  out.addEventListener('click', async () => {
    out.disabled = true;
    const ok = await logout();
    out.disabled = false;
    if (!ok) {
      // The session lives on: the sign-in form now would only hide it.
      flash = t.shell.signOutFailed;
      return void route();
    }
    markSignedIn(false);
    location.assign(homePath(pageLocale));
  });
  shell.replaceChildren(h('div', { class: 'app-nav__inner' }, nav, out));
  // On a narrow screen the navigation scrolls: the current item in view.
  const at = nav.querySelector<HTMLElement>('[aria-current]');
  if (at && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = at.offsetLeft - nav.offsetLeft;
}

/** Signed out: to the home page's sign-in card (ADR 0026), which comes back to this page after the
 *  sign-in (`?next=`); with a message (the account is deleted, and what is left to remove by hand),
 *  that first, with the way to the home page. */
function signedOut(message = ''): void {
  markSignedIn(false);
  if (!message) return location.replace(signInPath(homePath(pageLocale), location.hash));
  setLocale(pageLocale);
  drawShell();
  app.replaceChildren(h('section', { class: 'auth-card login' }, h('p', {}, message), h('p', {}, h('a', { href: homePath(pageLocale) }, t.auth.toHome))));
  document.title = 'clx';
}

const go = (hash: string) => {
  if (location.hash === hash) void route();
  else location.hash = hash;
};

/** The page for the address: #/ accounts, #/connect, #/accounts/<id>, #/sites, #/sites/<id>,
 *  #/links, #/links/<id>, the reports …/<id>/report, #/keys, #/me. Adding is a drawer on the lists. */
async function page(me: Me, path: string, mine: number): Promise<[HTMLElement, string]> {
  const live = () => mine === seq;
  const redraw = (message?: string) => {
    flash = message ?? '';
    void route();
  };
  const account = path.match(/^\/accounts\/([\w-]+)$/u);
  if (path === '/connect') return [connectPage(go), t.titles.connect];
  if (account) return [await accountPage(account[1]!, live, redraw), t.titles.account];
  if (path === '/keys') return [await keysPage(me, redraw), t.titles.keys];
  if (path === '/me') return [mePage(me, signedOut), t.titles.me];
  // #/sites/new and #/links/new were pages before the drawers: a bookmark of one opens the list.
  if (path === '/sites' || path === '/sites/new') return [await sitesPage(me, go), t.titles.sites];
  const report = path.match(/^\/(sites|links)\/([\w-]+)\/report(?:\?p=([\w]+))?$/u);
  if (report) return [await reportPage(report[1] as 'sites' | 'links', report[2]!, report[3] ?? 'today'), t.titles.report];
  const site = path.match(/^\/sites\/([\w-]+)$/u);
  if (site) return [await sitePage(site[1]!, live, redraw), t.titles.site];
  if (path === '/links' || path === '/links/new') return [await linksPage(me, go, () => redraw()), t.titles.links];
  const link = path.match(/^\/links\/([\w-]+)$/u);
  if (link) return [await linkPage(link[1]!, live, redraw), t.titles.link];
  return [await accountsPage(me), t.titles.accounts];
}

/** The pages an e-mail's link opens signed out (§9): the confirmation and a new password. Sign-up and
 *  the reset request live on the home page (ADR 0026); old links to them here go there. */
async function publicPage(path: string): Promise<[HTMLElement, string] | 'moved' | null> {
  const token = path.match(/[?&]t=([A-Za-z0-9_-]{43})/u)?.[1] ?? null;
  if (path === '/signup' || ((path === '/reset' || path.startsWith('/reset?')) && !token)) {
    location.replace(`${homePath(pageLocale)}#${path === '/signup' ? 'register' : 'recover'}`);
    return 'moved';
  }
  if (path.startsWith('/confirm')) return [await confirmPage(token ?? ''), t.titles.confirm];
  if (path.startsWith('/reset?')) return [resetPage(token!), t.titles.newPassword];
  return null;
}

async function route(): Promise<void> {
  const mine = ++seq;
  // A dialog or drawer belongs to the page it was opened on: leaving the page (Back, a link) closes
  // it, so it cannot act for a page no longer there. Before any await: a page that redraws itself
  // and then opens a dialog (the new key) keeps it.
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
  // So is its work on the loading bar: the page drawn next says again whether it has any.
  pageBusy(false);
  const path = location.hash.replace(/^#/u, '') || '/';
  // A public page speaks the address's language, so that is the language while it is drawn; a
  // signed-in page switches to the account's below, once /v1/me has answered.
  setLocale(pageLocale);
  const open = await publicPage(path);
  if (open === 'moved') return;
  if (open) {
    if (mine !== seq) return;
    // Nothing of a signed-in page stays around a public one.
    drawShell();
    app.replaceChildren(open[0]);
    document.title = `${open[1]} — clx`;
    return;
  }
  try {
    // Fresh each time: the plan's use (accounts, keys) changes with what the pages do. The account's
    // language wins over the address's from here on.
    const me = await get<Me>('/v1/me');
    if (mine !== seq) return;
    markSignedIn(true);
    // The site's header around the app is printed in the address's language: an account of another
    // language moves to its own address, the same page.
    const own = asLocale(me.user.locale);
    if (own !== pageLocale) return location.replace(`${appPath(own)}${location.hash}`);
    setLocale(own);
    const [el, title] = await page(me, path, mine);
    if (mine !== seq) return;
    drawShell(sectionOf(path));
    // A message a page left for its next drawing, shown once above it.
    app.replaceChildren(
      ...(flash ? [h('div', { class: 'auth-status', 'data-type': 'error', role: 'alert' }, flash)] : []),
      ...(me.user.email_confirmed || path === '/me' ? [] : [unconfirmedBanner(me)]),
      el,
    );
    flash = '';
    document.title = `${title} — clx`;
  } catch (e) {
    if (mine !== seq) return;
    if (e instanceof SignedOut) return signedOut();
    app.replaceChildren(h('div', { class: 'card' }, h('p', {}, failure(e)), h('p', {}, h('a', { href: '#/' }, t.shell.toHome))));
  }
}

window.addEventListener('hashchange', () => void route());
// The header's language switch (site/layout.ts) leads to the app in another language, the same page.
// With a session, the account's language changes with it (ADR 0021) — the account's language wins
// over the address's, so without that the app would come straight back. Asked every time, not by
// what the page knows: a session may be there before /v1/me has answered.
document.getElementById('lang-dd')?.addEventListener('click', async (e) => {
  const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[data-locale]') : null;
  if (!a) return;
  e.preventDefault();
  const dd = a.closest('details');
  const to = asLocale(a.dataset.locale ?? '');
  if (to === pageLocale) return void dd?.removeAttribute('open');
  try {
    await call('PATCH', '/v1/me', { locale: to });
  } catch (err) {
    // No session: the address alone sets the language.
    if (!(err instanceof SignedOut)) {
      dd?.removeAttribute('open');
      flash = failure(err);
      return void route();
    }
  }
  location.assign(`${appPath(to)}${location.hash}`);
});
// A public page (an e-mail's link) opens signed out too; any other page without a session goes to
// the home page's sign-in card — route() finds that out itself.
drawShell();
void refresh().then(() => route());
