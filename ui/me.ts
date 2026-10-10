// The profile page (#/me): the address and its confirmation, the plan, the language of the app and
// the e-mails (ADR 0015), deleting the account (§9).
import { action } from './accounts';
import { call, logout, type Me } from './api';
import { askConfirm } from './dialog';
import { h } from './dom';
import { dictOf, LOCALES, pageLocale, setLocale, t, type Locale } from './i18n';
import { dropdown } from './pick';

const rows = (pairs: [string, Node | string][]) => h('dl', { class: 'kv' }, ...pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));

/** `signedOut(message)` shows the sign-in form with the message once the account is gone. */
export function mePage(me: Me, redraw: (message?: string) => void, signedOut: (message: string) => void): HTMLElement {
  const resent = h('span', { class: 'muted text-sm', role: 'status' });
  const language = dropdown(
    LOCALES.map((l) => ({ value: l, label: dictOf(l).name })),
    { id: 'me-locale', value: me.user.locale },
  );
  // Not type=password: the browser would fill the saved clx.cx password into it on every load,
  // one confirmation away from a delete (the trick of the token fields, ui/accounts.ts).
  const password = h('input', { class: 'input masked', id: 'me-password', type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-1p-ignore': '', 'data-lpignore': 'true' });
  return h(
    'div',
    { class: 'narrow stack stack--md' },
    h('h2', {}, t.titles.me),
    h(
      'section',
      { class: 'card stack stack--sm' },
      rows([
        [t.me.address, h('span', {}, `${me.user.email} `, h('span', { class: `badge badge--${me.user.email_confirmed ? 'success' : 'warning'}` }, me.user.email_confirmed ? t.me.confirmed : t.me.unconfirmed))],
        [t.me.plan, me.plan],
      ]),
      me.user.email_confirmed
        ? null
        : h(
            'div',
            { class: 'actions' },
            action(t.unconfirmed.resend, 'btn--ghost btn--sm', async () => {
              await call('POST', '/auth/confirm/resend');
              resent.textContent = t.unconfirmed.sent;
            }),
            resent,
          ),
    ),
    h(
      'section',
      { class: 'card stack stack--sm' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'me-locale' }, t.me.language), language.el, h('p', { class: 'field-hint' }, t.me.languageHint)),
      h(
        'div',
        { class: 'actions' },
        action(t.me.save, 'btn--primary', async (key) => {
          const { locale } = await call<{ locale: Locale }>('PATCH', '/v1/me', { locale: language.value() }, key);
          setLocale(locale);
          redraw();
        }),
      ),
    ),
    h(
      'section',
      { class: 'card stack stack--sm' },
      h('h3', { class: 'h4' }, t.me.deleteTitle),
      h('p', { class: 'muted text-sm' }, t.me.deleteBody),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'me-password' }, t.me.password), password),
      h(
        'div',
        { class: 'actions' },
        action(t.me.delete, 'btn--danger', async (key) => {
          if (!(await askConfirm({ title: t.me.deleteTitle, body: t.me.deleteAsk, confirmLabel: t.me.deleteConfirm, danger: true }))) return;
          const r = await call<{ left: string[]; revoke_tokens: string[] }>('DELETE', '/v1/me', { password: password.value }, key);
          // A failed logout leaves nothing: the user's sessions end with the user, and a new user who
          // gets the same id starts at another session version (src/auth/signup.ts).
          await logout();
          // Not location.hash: its hashchange would draw the sign-in form again, without the message.
          history.replaceState(null, '', '#/');
          // Said on the sign-in page, which speaks the address's language.
          const said = dictOf(pageLocale).me;
          const rest = [...r.revoke_tokens.map((x) => said.token(x)), ...r.left];
          signedOut(rest.length ? said.deletedLeft(rest) : said.deleted);
        }),
      ),
    ),
  );
}

/** Until the address is confirmed no Cloudflare account can be connected (§9): said above every page. */
export function unconfirmedBanner(me: Me): HTMLElement {
  const out = h('span', { class: 'muted text-sm', role: 'status' });
  return h(
    'div',
    { class: 'banner banner--warning stack stack--sm' },
    h('p', {}, t.unconfirmed.text(me.user.email)),
    h(
      'div',
      { class: 'actions' },
      action(t.unconfirmed.resend, 'btn--ghost btn--sm', async () => {
        await call('POST', '/auth/confirm/resend');
        out.textContent = t.unconfirmed.sent;
      }),
      out,
    ),
  );
}
