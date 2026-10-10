// The page's entry: the shell (brand, navigation, theme, sign-out), sign-in, the hash router over the
// pages, the language (ADR 0015).
import { accountPage, accountsPage, connectPage, failure, keysPage } from './accounts';
import { get, logout, refresh, SignedOut, type Me } from './api';
import { h, s } from './dom';
import { pageLocale, setLocale, t } from './i18n';
import { linkPage, linksPage } from './links';
import { mePage, unconfirmedBanner } from './me';
import { reportPage } from './report';
import { confirmPage, loginPage, resetPage, signupPage } from './signup';
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

function themeButton(): HTMLElement {
  const b = h('button', { type: 'button', class: 'btn-close', 'aria-label': t.shell.theme, title: t.shell.theme }, icon('theme-light-dark'));
  b.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('clx-theme', next);
    } catch {
      // private mode: the theme just isn't remembered
    }
  });
  return b;
}

/** The top bar; with `current`, the signed-in navigation and the sign-out button. */
function drawShell(current?: Section): void {
  const brand = h('p', { class: 'brand' }, h('a', { href: '#/' }, s('svg', { class: 'icon brand__mark', 'aria-hidden': 'true' }, s('use', { href: '/icons.svg#i-mono-clx' })), h('span', {}, 'clx')));
  if (!current) return void shell.replaceChildren(h('div', { class: 'topbar__inner' }, brand, themeButton()));
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
    history.replaceState(null, '', '#/');
    showLogin();
  });
  shell.replaceChildren(h('div', { class: 'topbar__inner' }, brand, nav, themeButton(), out));
  // On a narrow screen the navigation scrolls: the current item in view.
  const at = nav.querySelector<HTMLElement>('[aria-current]');
  if (at && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = at.offsetLeft - nav.offsetLeft;
}

function showLogin(message = ''): void {
  setLocale(pageLocale);
  drawShell();
  app.replaceChildren(loginPage(() => void route(), message));
  document.title = `${t.titles.signIn} — clx`;
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
  if (path === '/me') return [mePage(me, redraw, showLogin), t.titles.me];
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

/** The pages a signed-out visitor opens (§9): sign-up, the confirmation link, the password reset. */
async function publicPage(path: string): Promise<[HTMLElement, string] | null> {
  const token = path.match(/[?&]t=([A-Za-z0-9_-]{43})/u)?.[1] ?? null;
  if (path === '/signup') return [await signupPage(), t.titles.signUp];
  if (path.startsWith('/confirm')) return [await confirmPage(token ?? ''), t.titles.confirm];
  if (path === '/reset' || path.startsWith('/reset?')) return [await resetPage(token), token ? t.titles.newPassword : t.titles.reset];
  return null;
}

async function route(): Promise<void> {
  const mine = ++seq;
  // A dialog or drawer belongs to the page it was opened on: leaving the page (Back, a link) closes
  // it, so it cannot act for a page no longer there. Before any await: a page that redraws itself
  // and then opens a dialog (the new key) keeps it.
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
  const path = location.hash.replace(/^#/u, '') || '/';
  // A public page speaks the address's language, so that is the language while it is drawn; a
  // signed-in page switches to the account's below, once /v1/me has answered.
  setLocale(pageLocale);
  const open = await publicPage(path);
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
    setLocale(me.user.locale);
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
    if (e instanceof SignedOut) return showLogin();
    app.replaceChildren(h('div', { class: 'card' }, h('p', {}, failure(e)), h('p', {}, h('a', { href: '#/' }, t.shell.toHome))));
  }
}

window.addEventListener('hashchange', () => void route());
// A public page (an e-mail's link) opens signed out too; any other page without a session shows
// the sign-in form — route() finds that out itself.
drawShell();
void refresh().then(() => route());
