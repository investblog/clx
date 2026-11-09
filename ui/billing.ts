// The Balance page (docs/spec.md §10, §18): the balance and its journal, Pro on or off with the day
// it is paid through and any grace, a top-up in crypto (amount and coin, then the address and the
// exact sum with a countdown), Stars in the bot, refunds of top-ups, and what is paused. Every
// action is a /v1 call.
import { ApiError, call, type Account, type Me } from './api';
import { action, badge, cell, confirmAction, notice, pageHead, table, type Live, type Tone } from './accounts';
import { openDrawer } from './dialog';
import { codeBlock, h } from './dom';
import { dayText, t, usd, when } from './i18n';
import { dropdown } from './pick';

interface Invoice {
  id: string;
  rail: 'crypto' | 'stars';
  usd_micro_usd: number;
  coin: string;
  coin_label: string;
  stars: number | null;
  status: 'pending' | 'paid' | 'expired' | 'review' | 'void';
  address: string | null;
  amount: string | null;
  pay_url: string | null;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
  /** GET /v1/billing's: what a refund request may still take from it — 0 when none may be asked */
  refundable_micro_usd?: number;
}
interface Refund {
  id: string;
  invoice_id: string;
  rail: 'crypto' | 'stars';
  status: 'requested' | 'pending' | 'done' | 'declined';
  amount_micro_usd: number | null;
  txid: string | null;
  created_at: string;
}
interface Billing {
  balance_micro_usd: number;
  pro: { on: boolean; given: boolean; since: string | null; paid_through: string | null; grace_until: string | null; price_micro_usd: number; day_micro_usd: number };
  journal: { id: number; type: string; amount_micro_usd: number; day: string | null; note: string | null; at: string }[];
  invoices: Invoice[];
  refunds: Refund[];
}

const COINS = ['USDT_TRC20', 'USDT_BSC', 'USDT_ERC20', 'USDC_ERC20'];
const BOT_URL = 'https://t.me/clxcxbot';
const INVOICE_TONE: Record<string, Tone> = { paid: 'success', pending: 'warning', review: 'warning', expired: 'neutral', void: 'neutral' };

/** The crypto top-up: where to send, how much, until when — looked at again until it is settled.
 *  Closed, the page is drawn again, so a top-up just made is in its list. */
function invoiceDrawer(invoice: Invoice, redraw: () => void): void {
  const c = t.billing;
  let root = null as HTMLElement | null;
  openDrawer(c.payTitle(usd(invoice.usd_micro_usd), invoice.coin_label), (close) => {
    const left = h('strong', {});
    const state = h('p', { class: 'muted text-sm', 'aria-live': 'polite' });
    // Past its hour the address is not to be paid to: what says so replaces it.
    const pay = h('div', { class: 'stack stack--md' });
    const tick = () => {
      const ms = Date.parse(invoice.expires_at) - Date.now();
      left.textContent = ms > 0 ? `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}` : c.expired;
      if (ms <= 0 && !pay.hidden) {
        pay.hidden = true;
        state.textContent = c.expiredNote;
      }
    };
    tick();
    // The drawer is in the page by the first second; once it is closed the countdown stops.
    const timer = setInterval(() => (left.isConnected ? tick() : clearInterval(timer)), 1000);
    // The answer of the processor arrives by its webhook: the invoice is read again every 10 s.
    const poll = () =>
      setTimeout(async () => {
        if (!state.isConnected) return;
        const next = await call<{ invoice: Invoice }>('GET', `/v1/billing/invoices/${invoice.id}`).catch(() => null);
        if (!state.isConnected) return;
        if (next && next.invoice.status !== 'pending') return close();
        poll();
      }, 10_000);
    poll();
    pay.append(
      ...(invoice.address && invoice.amount
        ? [
            h('p', {}, c.sendExactly),
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, c.amount(invoice.coin_label)), codeBlock(invoice.amount, c.copy)),
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, c.address), codeBlock(invoice.address, c.copy)),
          ]
        : []),
      ...(invoice.pay_url ? [h('p', {}, h('a', { href: invoice.pay_url, target: '_blank', rel: 'noopener' }, invoice.address ? c.orPayPage : c.payPage))] : []),
      h('p', { class: 'muted text-sm' }, c.afterSend),
    );
    root = h('div', { class: 'stack stack--md' }, pay, h('p', {}, c.timeLeft, ' ', left), state);
    return root;
  });
  root?.closest('dialog')?.addEventListener('close', redraw, { once: true });
}

/** A refund of a credited top-up: crypto asks for the address it goes back to (§18). */
function refundDrawer(invoice: Invoice, redraw: () => void): void {
  const c = t.billing;
  openDrawer(c.refundTitle(usd(invoice.usd_micro_usd)), (close) => {
    const address = h('input', { class: 'input', id: 'refund-address', autocomplete: 'off', spellcheck: 'false', placeholder: invoice.coin === 'USDT_TRC20' ? 'T…' : '0x…' });
    return h(
      'div',
      { class: 'stack stack--md' },
      h('p', {}, invoice.rail === 'stars' ? c.refundStars : c.refundCrypto(invoice.coin_label)),
      invoice.rail === 'crypto' ? h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'refund-address' }, c.refundAddress), address) : null,
      h(
        'div',
        { class: 'actions' },
        action(c.refundAsk, 'btn--primary', async (key) => {
          if (invoice.rail === 'crypto' && !address.value.trim()) throw new ApiError(400, 'invalid_request', c.needAddress);
          await call('POST', '/v1/billing/refunds', { invoice_id: invoice.id, ...(invoice.rail === 'crypto' ? { address: address.value.trim() } : {}) }, key);
          close();
          redraw();
        }),
      ),
    );
  });
}

/** Pro: on or off, paid through, any grace — and the switch. */
function proCard(b: Billing, redraw: () => void): HTMLElement {
  const c = t.billing;
  const p = b.pro;
  const state = p.given ? badge(c.proGiven, 'success') : p.on ? badge(c.proOn, 'success') : badge(c.proOff);
  const lines = p.given
    ? [c.givenNote]
    : p.on
      ? [p.paid_through ? c.paidThrough(dayText(p.paid_through)) : '', c.dayCost(usd(p.day_micro_usd), usd(p.price_micro_usd))]
      : [c.offNote(usd(p.price_micro_usd))];
  const toggle = p.given
    ? null
    : p.on
      ? confirmAction(c.switchOff, { title: c.switchOff, body: c.switchOffAsk, confirmLabel: c.switchOffConfirm }, async (key) => {
          await call('POST', '/v1/billing/pro', { on: false }, key);
          redraw();
        }, 'btn--ghost')
      : action(c.switchOn, 'btn--primary', async (key) => {
          await call('POST', '/v1/billing/pro', { on: true }, key);
          redraw();
        });
  return h(
    'section',
    { class: 'card stack stack--sm' },
    h('h3', { class: 'h4' }, 'Pro ', state),
    p.grace_until ? notice(c.grace(when(p.grace_until))) : null,
    ...lines.filter(Boolean).map((l) => h('p', { class: 'muted text-sm' }, l)),
    toggle ? h('div', { class: 'actions' }, toggle) : null,
  );
}

/** A top-up: crypto here, Stars in the bot. */
function topUpCard(me: Me, redraw: () => void): HTMLElement {
  const c = t.billing;
  const amount = h('input', { class: 'input', id: 'topup-usd', type: 'number', min: '9', max: '1000', step: '1', value: '9', inputmode: 'numeric' });
  const coin = dropdown(
    COINS.map((v) => ({ value: v, label: (c.coins as Record<string, string>)[v] ?? v })),
    { id: 'topup-coin' },
  );
  return h(
    'section',
    { class: 'card stack stack--md' },
    h('h3', { class: 'h4' }, c.topUp),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'topup-usd' }, c.usd), amount, h('p', { class: 'field-hint' }, c.usdHint)),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'topup-coin' }, c.coin), coin.el),
    me.user.email_confirmed ? null : notice(t.errors.email_unconfirmed, 'idle'),
    h(
      'div',
      { class: 'actions' },
      action(c.getAddress, 'btn--primary', async (key) => {
        const n = Number(amount.value);
        if (!Number.isInteger(n) || n < 9 || n > 1000) throw new ApiError(400, 'invalid_request', c.usdHint);
        const r = await call<{ invoice: Invoice }>('POST', '/v1/billing/invoices', { usd: n, coin: coin.value() }, key);
        invoiceDrawer(r.invoice, redraw);
      }),
    ),
    h('p', { class: 'muted text-sm' }, c.stars, ' ', h('a', { href: BOT_URL, target: '_blank', rel: 'noopener' }, '@clxcxbot'), c.starsTail),
  );
}

/** What is paused now (§18), and since when: on free, what is beyond its limits — named. Lists that
 *  could not be read say nothing rather than "nothing is paused". */
async function pausedNote(me: Me): Promise<HTMLElement | null> {
  if (me.plan !== 'free') return null;
  const [accounts, sites, links, keys] = await Promise.all([
    call<{ accounts: Account[] }>('GET', '/v1/accounts').catch(() => null),
    call<{ sites: { host: string; paused_at: string | null }[] }>('GET', '/v1/sites').catch(() => null),
    call<{ links: { short_url: string | null; code: string; paused_at: string | null }[] }>('GET', '/v1/links').catch(() => null),
    call<{ keys: { prefix: string; paused_at: string | null }[] }>('GET', '/v1/keys').catch(() => null),
  ]);
  const c = t.billing;
  const of = <T extends { paused_at: string | null }>(rows: T[] | undefined, name: (r: T) => string) => (rows ?? []).filter((r) => r.paused_at).map((r) => ({ name: name(r), at: r.paused_at! }));
  const groups: [string, { name: string; at: string }[]][] = [
    [c.pausedAccounts, of(accounts?.accounts, (a) => a.name ?? a.cf_account_id)],
    [c.pausedSites, of(sites?.sites, (s) => s.host)],
    [c.pausedLinks, of(links?.links, (l) => l.short_url ?? l.code)],
    [c.pausedKeys, of(keys?.keys, (k) => `${k.prefix}…`)],
  ];
  const any = groups.filter(([, rows]) => rows.length);
  if (!any.length) return null;
  const since = any.flatMap(([, rows]) => rows.map((r) => r.at)).sort()[0]!;
  // At most ten names a kind: the rest are counted.
  const line = (rows: { name: string }[]) => (rows.length > 10 ? `${rows.slice(0, 10).map((r) => r.name).join(', ')} ${c.andMore(rows.length - 10)}` : rows.map((r) => r.name).join(', '));
  return h(
    'section',
    { class: 'card stack stack--sm' },
    h('h3', { class: 'h4' }, c.pausedTitle(when(since))),
    h('p', { class: 'muted text-sm' }, c.pausedNote),
    ...any.map(([title, rows]) => h('p', { class: 'text-sm' }, h('strong', {}, `${title}: `), line(rows))),
  );
}

export async function billingPage(me: Me, live: Live, redraw: () => void): Promise<HTMLElement> {
  const c = t.billing;
  const [b, paused] = await Promise.all([call<Billing>('GET', '/v1/billing'), pausedNote(me)]);
  if (!live()) return h('div');
  // A drawer closed after this page was left draws nothing.
  const again = () => {
    if (live()) redraw();
  };
  return h(
    'div',
    { class: 'stack stack--md' },
    pageHead(t.titles.billing),
    h('section', { class: 'card stack stack--sm' }, h('p', { class: 'muted text-sm' }, c.balance), h('p', { class: 'h2' }, usd(b.balance_micro_usd))),
    paused,
    proCard(b, again),
    topUpCard(me, again),
    b.invoices.length
      ? h(
          'section',
          { class: 'stack stack--sm' },
          h('h3', { class: 'h4' }, c.topUps),
          table(
            [[c.colWhen], [c.colSum], [c.colRail, 'medium'], [c.colState], ['']],
            b.invoices.map((i) => {
              const reopen = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, c.reopen);
              reopen.addEventListener('click', () => invoiceDrawer(i, again));
              const refund = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, c.refund);
              refund.addEventListener('click', () => refundDrawer(i, again));
              // Past its hour a pending top-up is not paid to (it may still turn paid if crypto came late).
              const payable = i.status === 'pending' && i.rail === 'crypto' && Date.parse(i.expires_at) > Date.now();
              return h(
                'tr',
                {},
                cell(when(i.created_at)),
                cell(usd(i.usd_micro_usd)),
                cell(i.rail === 'stars' ? c.starsRail(i.stars ?? 0) : i.coin_label, 'medium'),
                cell(badge((c.invoiceState as Record<string, string>)[i.status] ?? i.status, INVOICE_TONE[i.status])),
                cell(payable ? reopen : (i.refundable_micro_usd ?? 0) > 0 ? refund : null),
              );
            }),
          ),
        )
      : null,
    b.refunds.length
      ? h(
          'section',
          { class: 'stack stack--sm' },
          h('h3', { class: 'h4' }, c.refunds),
          table(
            [[c.colWhen], [c.colState], [c.colSum], [c.colTx, 'low']],
            b.refunds.map((r) => h('tr', {}, cell(when(r.created_at)), cell(badge((c.refundState as Record<string, string>)[r.status] ?? r.status)), cell(r.amount_micro_usd === null ? '—' : usd(r.amount_micro_usd)), cell(r.txid ? h('code', { class: 'truncate' }, r.txid) : '—', 'low'))),
          ),
        )
      : null,
    h(
      'section',
      { class: 'stack stack--sm' },
      h('h3', { class: 'h4' }, c.journal),
      b.journal.length
        ? table(
            [[c.colWhen], [c.colWhat], [c.colSum], [c.colNote, 'low']],
            // Notes are the system's own English but for an operator's correction, which is shown as written.
            b.journal.map((j) => h('tr', {}, cell(when(j.at)), cell(j.type === 'charge' && j.day ? c.chargeOf(dayText(j.day)) : ((c.entry as Record<string, string>)[j.type] ?? j.type)), cell(usd(j.amount_micro_usd)), cell(j.type === 'adjustment' ? (j.note ?? '') : '', 'low'))),
          )
        : h('div', { class: 'card empty-state empty-state--compact' }, h('p', {}, c.noJournal)),
    ),
  );
}
