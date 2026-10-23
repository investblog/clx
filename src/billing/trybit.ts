// Crypto top-ups through Trybit (docs/spec.md §18, ADR 0035), after catchall.in's client, which met
// its traps live.
//
// Their notification is never believed. Its token (HS256, our webhook secret) signs only `id` and
// `exp`; amount, status and invoice ride beside it as plain JSON. So a notification only says "look
// at invoice N", and the status is asked of their API with our key. That also gives what arrived:
// `received_usd`. `amount_paid_usd` is not it — it includes the network fee the payer bore (live,
// 07.09.2026 on catchall.in: paid 21.4, received 20.0).
import type { Env } from '../types';

export const COINS = ['USDT_TRC20', 'USDT_BSC', 'USDT_ERC20', 'USDC_ERC20'] as const;
export type Coin = (typeof COINS)[number];
export const isCoin = (v: unknown): v is Coin => (COINS as readonly unknown[]).includes(v);
export const COIN_LABEL: Record<Coin, string> = { USDT_TRC20: 'USDT (TRC-20)', USDT_BSC: 'USDT (BSC)', USDT_ERC20: 'USDT (ERC-20)', USDC_ERC20: 'USDC (ERC-20)' };

/** Their invoice id: with the prefix in API answers, without it in notifications. */
export const withPrefix = (id: string) => (id.startsWith('INV-') ? id : `INV-${id}`);

/** Statuses that close an invoice with its sum final. `partial` is not one: the payer may still add
 *  the rest, and one deposit per invoice means crediting it now would lose that rest. */
export const PAID_STATUSES = new Set(['paid', 'overpaid']);
/** Their limit of ids in one `/invoice/merchant/info` call. */
export const INFO_BATCH = 100;

/** Taking money and settling it are one state: without the webhook secret a paid invoice would
 *  have no one to credit it. */
export const configured = (env: Env) => Boolean(env.PAYMENTS_API_KEY && env.PAYMENTS_SHOP_ID && env.PAYMENTS_API_URL && env.PAYMENTS_WEBHOOK_SECRET);

/** Dollars to micro-USD, rounded down exactly: read from the decimal text, never through float
 *  multiplication (9.999999 must not become 10). Null for anything but a plain decimal. */
export function toMicro(usd: number | string): number | null {
  const s = typeof usd === 'number' ? (Number.isFinite(usd) ? String(usd) : '') : usd.trim();
  const m = /^(-?)(\d{1,12})(?:\.(\d+))?$/u.exec(s);
  if (!m) return null;
  const micro = Number(m[2]) * 1_000_000 + Number((m[3] ?? '').padEnd(6, '0').slice(0, 6));
  return m[1] ? -micro : micro;
}

/** A number from their field: a number or a numeric string; anything else is "no value". */
function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export interface Created {
  /** INV-… */
  id: string;
  payUrl: string;
  /** The address and the exact amount to send — only when their quote is whole (coin, nominal and
   *  every fee on the payer as numbers); else the page sends the payer to their own page. */
  address: string | null;
  amountCrypto: string | null;
}

/** Make the invoice at Trybit: our id as `order_id`, the coin and network chosen here, an hour. */
export async function createInvoice(env: Env, input: { id: string; usd: number; coin: Coin }, fetcher: typeof fetch = fetch): Promise<Created | null> {
  let out: { result?: { uuid?: string; link?: string; address?: string | null; amount?: unknown; fee?: unknown; side_commission?: unknown; service_fee?: unknown; side_commission_service?: unknown; currency?: { fullcode?: string } } };
  try {
    const res = await fetcher(`${env.PAYMENTS_API_URL}/invoice/create`, {
      method: 'POST',
      headers: { authorization: `Token ${env.PAYMENTS_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        shop_id: env.PAYMENTS_SHOP_ID,
        amount: input.usd / 1_000_000,
        currency: 'USD',
        order_id: input.id,
        add_fields: { cryptocurrency: input.coin, available_currencies: [input.coin], time_to_pay: { hours: 1, minutes: 0 } },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // Neither the key nor the body goes to the log: a body may hold the payer's address.
    if (!res.ok) return (console.warn(`trybit create: ${res.status}`), null);
    out = await res.json();
  } catch (e) {
    return (console.warn('trybit create failed', e instanceof Error ? e.name : 'error'), null);
  }
  const r = out?.result;
  if (!r?.uuid || !r.link) return null;
  // What to send is the nominal plus the fees their settings put on the payer; showing the bare
  // nominal would underpay every time. A side not stated means "unknown", not "ours".
  const side = (v: unknown) => (v === 'client' || v === 'merchant' ? v : null);
  const net = side(r.side_commission);
  const service = side(r.side_commission_service);
  const amount = num(r.amount);
  const netFee = net === null ? null : net === 'client' ? num(r.fee) : 0;
  const serviceFee = service === null ? null : service === 'client' ? num(r.service_fee) : 0;
  const whole = r.currency?.fullcode === input.coin && amount !== null && netFee !== null && serviceFee !== null;
  if (!whole) console.warn(`trybit ${r.uuid}: quote not whole — the page sends the payer to Trybit's own page`);
  return {
    id: withPrefix(r.uuid),
    payUrl: r.link,
    address: whole && typeof r.address === 'string' && r.address ? r.address : null,
    amountCrypto: whole ? String(Math.round((amount + netFee + serviceFee) * 1e6) / 1e6) : null,
  };
}

/** A money field kept as their text — a number becomes its shortest decimal — so `toMicro` reads it
 *  exactly; "1e1" and the like are refused there, not read as 10. */
const decimal = (v: unknown): string | null => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export interface Status {
  id: string;
  status: string;
  orderId: string | null;
  /** Their money fields as decimal text (see `decimal`). */
  paidUsd: string | null;
  /** What reached us — what is credited; null means do not credit, ask again. */
  receivedUsd: string | null;
  invoiceUsd: string | null;
  paidCrypto: string | null;
}

/** The state of up to 100 invoices in one call. Rows are matched by the ids asked, never by order;
 *  a 429 brings its Retry-After back so the reconcile run waits. */
export async function statuses(
  env: Env,
  ids: string[],
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; rows: Map<string, Status> } | { ok: false; retryAfter: number | null; http: number | null }> {
  const wanted = new Set(ids.map(withPrefix));
  let res: Response;
  try {
    res = await fetcher(`${env.PAYMENTS_API_URL}/invoice/merchant/info`, {
      method: 'POST',
      headers: { authorization: `Token ${env.PAYMENTS_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ uuids: [...wanted] }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, retryAfter: null, http: null };
  }
  if (!res.ok) {
    const ra = Number(res.headers.get('retry-after'));
    return { ok: false, retryAfter: res.status === 429 && ra > 0 ? ra : null, http: res.status };
  }
  let out: { result?: unknown };
  try {
    out = await res.json();
  } catch {
    return { ok: false, retryAfter: null, http: res.status };
  }
  const list = (Array.isArray(out?.result) ? out.result : out?.result ? [out.result] : []) as Record<string, unknown>[];
  const rows = new Map<string, Status>();
  for (const raw of list) {
    if (typeof raw?.uuid !== 'string' || typeof raw.status !== 'string' || !wanted.has(raw.uuid)) continue;
    rows.set(raw.uuid, {
      id: raw.uuid,
      status: raw.status,
      orderId: typeof raw.order_id === 'string' ? raw.order_id : null,
      paidUsd: decimal(raw.amount_paid_usd),
      receivedUsd: decimal(raw.received_usd),
      invoiceUsd: decimal(raw.amount_usd),
      paidCrypto: raw.amount_paid === undefined || raw.amount_paid === null ? null : String(raw.amount_paid),
    });
  }
  return { ok: true, rows };
}

const b64urlBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/gu, '+').replace(/_/gu, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/**
 * Their notification's token: HS256 only (the header's `alg` is checked, never trusted to pick
 * another), signed with our webhook secret, with an `exp` not passed and an `id` — the invoice it is
 * about, the only claim it signs. Returns that id (with the prefix), or null.
 */
export async function tokenInvoice(token: string, secret: string, now = Date.now()): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0]!))) as { alg?: unknown } | null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1]!))) as { exp?: unknown; id?: unknown } | null;
    if (!header || typeof header !== 'object' || header.alg !== 'HS256') return null;
    if (!claims || typeof claims !== 'object' || typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null;
    if ((typeof claims.id !== 'string' && typeof claims.id !== 'number') || String(claims.id) === '') return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('HMAC', key, b64urlBytes(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))) return null;
    return withPrefix(String(claims.id));
  } catch {
    return null;
  }
}
