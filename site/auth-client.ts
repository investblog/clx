// The home page's sign-in card (site/auth.ts, ADR 0026): the fragment shows one of its forms, the
// forms post to /auth. Sign-in leads to the app, which takes the session from the refresh cookie;
// sign-up and the reset request show what to do next. Bound at once, before any await: a form bound
// late would submit itself.
import { nextRoute } from '../ui/next.ts';

type Tab = 'login' | 'register' | 'recover';
const TABS: Tab[] = ['login', 'register', 'recover'];

interface Texts {
  errors: Record<string, string>;
  failed: string;
  network: string;
  invalid: string;
  tooMany: string;
  busy: string;
  sending: string;
  waitHuman: string;
  closed: Record<'register' | 'recover', string>;
  signedUp: string;
  signedUpNext: string;
  linkSent: string;
  show: string;
  hide: string;
}

declare global {
  interface Window {
    turnstile?: { render(el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void; language?: string }): string; reset(id: string): void };
  }
}

const card = document.querySelector<HTMLElement>('[data-auth]');
if (card) {
  const T = JSON.parse(card.dataset.t ?? '{}') as Texts;
  const lang = document.documentElement.lang === 'ru' ? 'ru' : 'en';
  const landing = document.querySelector<HTMLElement>('[data-landing]');
  const forms = Array.from(card.querySelectorAll<HTMLFormElement>('[data-auth-form]'));
  const langs = Array.from(document.querySelectorAll<HTMLAnchorElement>('#lang-dd a[data-locale]'));
  for (const a of langs) a.dataset.home = a.getAttribute('href') ?? '/';

  const say = (form: HTMLFormElement, type: 'error' | 'success' | 'loading' | 'idle', text: string) => {
    const box = form.querySelector<HTMLElement>('[data-msg]')!;
    box.dataset.type = type;
    box.textContent = text;
  };
  const errorOf = (code: string | undefined) => (code && T.errors[code]) || (code === 'network' ? T.network : T.failed);

  async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    } catch {
      return { ok: false, status: 0, json: { error: 'network' } };
    }
  }

  // Turnstile, for sign-up and the reset: the site key from /auth/config, the script on first need —
  // one load for both forms; one that failed (the network, a blocker) is tried again on the next visit.
  let config: Promise<{ turnstile_site_key: string | null } | null> | null = null;
  let script: Promise<boolean> | null = null;
  const loadScript = () =>
    (script ??= new Promise<boolean>((resolve) => {
      const el = document.createElement('script');
      el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      el.async = true;
      el.onload = () => resolve(true);
      el.onerror = () => {
        el.remove();
        script = null;
        resolve(false);
      };
      document.head.append(el);
    }));
  const tokens = new Map<HTMLFormElement, { value: string; id?: string }>();
  const pending = new Set<HTMLFormElement>();
  async function human(form: HTMLFormElement): Promise<void> {
    if (tokens.has(form) || pending.has(form)) return;
    pending.add(form);
    try {
      // A failed answer (the network, a 5xx, not JSON) is not "closed": nothing is said, and the next
      // visit asks again.
      config ??= fetch('/auth/config')
        .then((r) => (r.ok ? (r.json() as Promise<{ turnstile_site_key: string | null }>) : Promise.reject(new Error(String(r.status)))))
        .catch(() => {
          config = null;
          return null;
        });
      const answer = await config;
      if (!answer) return;
      const sitekey = answer.turnstile_site_key;
      if (!sitekey) {
        // Without it the server refuses these forms (not_configured): say so at once.
        say(form, 'error', T.closed[form.dataset.authForm as 'register' | 'recover']);
        form.querySelector<HTMLButtonElement>('[type=submit]')!.disabled = true;
        return;
      }
      if (!window.turnstile && !(await loadScript())) return;
      const slot: { value: string; id?: string } = { value: '' };
      slot.id = window.turnstile?.render(form.querySelector<HTMLElement>('[data-turnstile]')!, { sitekey, language: lang, callback: (v) => (slot.value = v), 'expired-callback': () => (slot.value = ''), 'error-callback': () => (slot.value = '') });
      if (slot.id) tokens.set(form, slot);
    } finally {
      pending.delete(form);
    }
  }
  const tokenOf = (form: HTMLFormElement) => tokens.get(form)?.value ?? '';
  const resetToken = (form: HTMLFormElement) => {
    const slot = tokens.get(form);
    if (!slot) return;
    slot.value = '';
    if (slot.id) window.turnstile?.reset(slot.id);
  };

  function route(): void {
    const hash = location.hash.slice(1);
    const tab = (TABS as string[]).includes(hash) ? (hash as Tab) : null;
    card!.hidden = !tab;
    landing?.classList.toggle('landing--auth', !!tab);
    for (const f of forms) f.hidden = f.dataset.authForm !== tab;
    for (const a of Array.from(card!.querySelectorAll<HTMLElement>('[data-tab]'))) {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    // The language switch opens the same form, with the way back, in the other language.
    for (const a of langs) a.href = tab ? `${a.dataset.home}${location.search}#${tab}` : a.dataset.home!;
    if (!tab) return;
    const form = forms.find((f) => f.dataset.authForm === tab)!;
    if (tab !== 'login') void human(form);
    form.querySelector<HTMLInputElement>('input[name=email]')?.focus();
  }

  for (const form of forms) {
    const kind = form.dataset.authForm as Tab;
    const button = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    const field = (name: string) => form.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (kind !== 'login' && !tokenOf(form)) return say(form, 'error', T.waitHuman);
      button.disabled = true;
      say(form, 'loading', kind === 'login' ? T.busy : T.sending);
      const email = field('email').value;
      const r =
        kind === 'login'
          ? await post('/auth/login', { email, password: field('password').value })
          : kind === 'register'
            ? await post('/auth/signup', { email, password: field('password').value, turnstile: tokenOf(form), locale: lang })
            : await post('/auth/reset', { email, turnstile: tokenOf(form) });
      button.disabled = false;
      if (kind !== 'login') resetToken(form);
      if (!r.ok) {
        const code = r.json.error as string | undefined;
        if (kind === 'login' && r.status === 429) return say(form, 'error', T.tooMany.replace('{n}', String(Math.ceil(Number(r.json.retryAfter ?? 60) / 60))));
        if (kind === 'login' && code === 'invalid_login') return say(form, 'error', T.invalid);
        return say(form, 'error', errorOf(code));
      }
      if (kind === 'login') {
        // The app opens the session from the refresh cookie just set; it marks the browser signed in.
        // It comes back to the page it sent here from (?next=, ui/main.ts) — an app route only, as
        // the fragment after the app's own address.
        say(form, 'idle', '');
        return location.assign(`${card!.dataset.app}#${nextRoute(location.search)}`);
      }
      form.reset();
      say(form, 'success', kind === 'register' ? `${T.signedUp.replace('{email}', email.trim())} ${T.signedUpNext}` : T.linkSent);
    });
    const toggle = form.querySelector<HTMLButtonElement>('[data-toggle]');
    toggle?.addEventListener('click', () => {
      const input = field('password');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-label', show ? T.hide : T.show);
    });
  }

  window.addEventListener('hashchange', route);
  route();
}
