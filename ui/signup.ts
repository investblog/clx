// The pages an e-mail's link opens (docs/spec.md §9): the address's confirmation and a new password.
// Sign-in, sign-up and the reset request are the home page's card (site/auth.ts, ADR 0026). They call
// /auth, not /v1, and speak the address's language (ADR 0015).
import { h } from './dom';
import { homePath, pageLocale, t } from './i18n';

const PASSWORD_MIN = 10; // the server's (src/auth/signup.ts), held equal by test/site.test.ts

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: res.ok, error: json.error };
  } catch {
    return { ok: false, error: 'network' };
  }
}
const errorOf = (e: string | undefined) => (e && (t.auth.errors as Record<string, string>)[e]) || (e === 'network' ? t.common.network : t.auth.failed);

const card = (title: string, ...children: (Node | null)[]) => h('section', { class: 'auth-card login' }, h('h1', { class: 'h3' }, title), ...children);
const field = (label: string, input: HTMLInputElement, hint?: string) => h('div', { class: 'field' }, h('label', { class: 'field-label', for: input.id }, label), input, hint ? h('p', { class: 'field-hint' }, hint) : null);
/** Under each page: the way to the home page's card — to sign in, or to ask for a new link. */
const home = (tab: 'login' | 'recover', text: string) => h('p', { class: 'muted text-sm' }, h('a', { href: `${homePath(pageLocale)}#${tab}` }, text));

export async function confirmPage(token: string): Promise<HTMLElement> {
  const r = await post('/auth/confirm', { token });
  return card(t.titles.confirm, h('p', {}, r.ok ? t.auth.confirmed : errorOf(r.error)), h('p', {}, h('a', { class: 'btn btn--primary', href: r.ok ? '#/' : `${homePath(pageLocale)}#login` }, r.ok ? t.auth.toApp : t.auth.toHome)));
}

/** A new password, from the reset e-mail's link. */
export function resetPage(token: string): HTMLElement {
  const status = h('div', { class: 'auth-status', 'data-type': 'idle', role: 'status', 'aria-live': 'polite' });
  const password = h('input', { class: 'input', id: 'rs-password', type: 'password', autocomplete: 'new-password', required: '', minlength: String(PASSWORD_MIN) });
  const button = h('button', { type: 'submit', class: 'btn btn--primary' }, t.auth.savePassword);
  const form = h('form', { class: 'auth-form' }, field(t.auth.newPassword, password, t.auth.newPasswordHint(PASSWORD_MIN)), status, h('div', { class: 'auth-actions' }, button));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    const r = await post('/auth/reset/confirm', { token, password: password.value });
    button.disabled = false;
    if (!r.ok) {
      status.dataset.type = 'error';
      status.textContent = errorOf(r.error);
      return;
    }
    form.replaceWith(h('p', {}, t.auth.passwordSaved));
  });
  return card(t.titles.newPassword, form, home('login', t.auth.signIn), home('recover', t.auth.forgot));
}
