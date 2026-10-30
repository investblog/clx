// The Partners page (docs/spec.md §10, §19): the code and its links (site and bot), the referrals,
// the wallet — what is held and what is available — a move to the balance and a payout request.
// Money moves only from this page, each with its own Idempotency-Key.
import { ApiError, call } from './api';
import { action, badge, cell, pageHead, table, type Live, type Tone } from './accounts';
import { openDrawer } from './dialog';
import { codeBlock, h } from './dom';
import { num, t, usd, when } from './i18n';

interface Partner {
  code: string;
  links: { site: string; bot: string | null };
  rate_bp: number;
  hold_days: number;
  payout_min_micro_usd: number;
  referrals: number;
  wallet: { total_micro_usd: number; available_micro_usd: number; held_micro_usd: number };
  journal: { id: number; type: string; amount_micro_usd: number; available_at: string | null; note: string | null; at: string }[];
  payouts: { id: number; amount_micro_usd: number; address: string; status: 'requested' | 'paid' | 'rejected'; txid: string | null; created_at: string }[];
}

const PAYOUT_TONE: Record<string, Tone> = { paid: 'success', requested: 'warning', rejected: 'danger' };

/** Dollars with at most cents, read as text (no binary rounding): at least `minCents`, at most what
 *  is available and the API's $100,000. */
function dollars(input: HTMLInputElement, minCents: number, maxCents: number, hint: string): number {
  const m = input.value.trim().match(/^(\d{1,6})(?:[.,](\d{1,2}))?$/u);
  const cents = m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : NaN;
  if (!(cents >= minCents && cents <= maxCents)) throw new ApiError(400, 'invalid_request', hint);
  return cents / 100;
}
/** What may be moved, in whole cents: the wallet's micro-USD rounded down, at most $100,000. */
const centsOf = (micro: number) => Math.max(0, Math.min(Math.floor(micro / 10_000), 10_000_000));

/** Money out of the wallet: to the balance, or a payout in USDT TRC-20. */
function moveDrawer(kind: 'transfer' | 'payout', p: Partner, redraw: () => void): void {
  const c = t.partners;
  const available = p.wallet.available_micro_usd;
  openDrawer(kind === 'transfer' ? c.toBalance : c.payout, (close) => {
    const most = centsOf(available);
    const amount = h('input', { class: 'input', id: 'partner-usd', inputmode: 'decimal', autocomplete: 'off', value: most > 0 ? (most / 100).toFixed(2) : '' });
    const address = h('input', { class: 'input', id: 'partner-address', autocomplete: 'off', spellcheck: 'false', placeholder: 'T…' });
    const min = kind === 'payout' ? Math.ceil(p.payout_min_micro_usd / 10_000) : 1;
    return h(
      'div',
      { class: 'stack stack--md' },
      h('p', {}, kind === 'transfer' ? c.toBalanceNote : c.payoutNote(usd(p.payout_min_micro_usd))),
      h('p', { class: 'muted text-sm' }, c.availableNow(usd(most * 10_000))),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'partner-usd' }, c.usd), amount),
      kind === 'payout' ? h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'partner-address' }, c.address), address) : null,
      h(
        'div',
        { class: 'actions' },
        action(kind === 'transfer' ? c.move : c.askPayout, 'btn--primary', async (key) => {
          const usdValue = dollars(amount, min, most, kind === 'payout' ? c.payoutMin(usd(p.payout_min_micro_usd)) : c.amountHint);
          if (kind === 'payout' && !address.value.trim()) throw new ApiError(400, 'invalid_request', c.needAddress);
          await call('POST', kind === 'transfer' ? '/v1/partner/transfer' : '/v1/partner/payouts', { usd: usdValue, ...(kind === 'payout' ? { address: address.value.trim() } : {}) }, key);
          close();
          redraw();
        }),
      ),
    );
  });
}

export async function partnersPage(live: Live, redraw: () => void): Promise<HTMLElement> {
  const c = t.partners;
  const p = await call<Partner>('GET', '/v1/partner');
  if (!live()) return h('div');
  const toBalance = h('button', { type: 'button', class: 'btn btn--primary' }, c.toBalance);
  toBalance.addEventListener('click', () => moveDrawer('transfer', p, redraw));
  const payout = h('button', { type: 'button', class: 'btn btn--ghost' }, c.payout);
  payout.addEventListener('click', () => moveDrawer('payout', p, redraw));
  const w = p.wallet;
  return h(
    'div',
    { class: 'stack stack--md' },
    pageHead(t.titles.partners),
    h(
      'section',
      { class: 'card stack stack--sm' },
      h('p', {}, c.terms(p.rate_bp / 100, p.hold_days)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, c.siteLink), codeBlock(p.links.site, c.copy)),
      p.links.bot ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, c.botLink), codeBlock(p.links.bot, c.copy)) : null,
      h('p', { class: 'muted text-sm' }, c.code(p.code), ' ', c.referrals(num(p.referrals))),
    ),
    h(
      'section',
      { class: 'card stack stack--sm' },
      h('h3', { class: 'h4' }, c.wallet),
      h('p', { class: 'h2' }, usd(w.available_micro_usd)),
      h('p', { class: 'muted text-sm' }, c.walletLine(usd(w.held_micro_usd), usd(w.total_micro_usd))),
      w.available_micro_usd < 0 ? h('p', { class: 'muted text-sm' }, c.below) : null,
      // Only whole cents move: less than one cent left offers nothing.
      centsOf(w.available_micro_usd) > 0 ? h('div', { class: 'actions' }, toBalance, centsOf(w.available_micro_usd) * 10_000 >= p.payout_min_micro_usd ? payout : null) : null,
    ),
    p.payouts.length
      ? h(
          'section',
          { class: 'stack stack--sm' },
          h('h3', { class: 'h4' }, c.payouts),
          table(
            [[c.colWhen], [c.colSum], [c.colState], [c.colAddress, 'low']],
            p.payouts.map((x) => h('tr', {}, cell(when(x.created_at)), cell(usd(x.amount_micro_usd)), cell(badge((c.payoutState as Record<string, string>)[x.status] ?? x.status, PAYOUT_TONE[x.status])), cell(h('code', { class: 'truncate' }, x.txid ?? x.address), 'low'))),
          ),
        )
      : null,
    h(
      'section',
      { class: 'stack stack--sm' },
      h('h3', { class: 'h4' }, c.journal),
      p.journal.length
        ? table(
            [[c.colWhen], [c.colWhat], [c.colSum]],
            p.journal.map((j) =>
              h(
                'tr',
                {},
                cell(when(j.at)),
                cell(((c.entry as Record<string, string>)[j.type] ?? j.type) + (j.type === 'commission' && j.available_at && Date.parse(j.available_at) > Date.now() ? ` · ${c.heldUntil(when(j.available_at))}` : '')),
                cell(usd(j.amount_micro_usd)),
              ),
            ),
          )
        : h('div', { class: 'card empty-state' }, h('p', {}, c.noJournal)),
    ),
  );
}
