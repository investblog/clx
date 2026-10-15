// Talking to the Worker, as the 301.st UI does: the access
// token lives in memory only; the refresh id is an HttpOnly cookie the page never sees. A 401 gets
// one refresh and one retry; if that fails too, the reader signs in again (on the home page's card,
// ADR 0026, which also does the sign-in itself).

let token: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class SignedOut extends Error {}

/** One refresh at a time: concurrent callers share it (the refresh id rotates on every use). */
export function refresh(): Promise<boolean> {
  refreshing ??= fetch('/auth/refresh', { method: 'POST' })
    .then(async (res) => {
      token = res.ok ? ((await res.json()) as { access_token: string }).access_token : null;
      return res.ok;
    })
    .catch(() => false)
    .finally(() => (refreshing = null));
  return refreshing;
}

/** False when the server did not end the session: its refresh cookie may still sign this browser in. */
export async function logout(): Promise<boolean> {
  const ok = await fetch('/auth/logout', { method: 'POST' }).then((r) => r.ok, () => false);
  if (ok) token = null;
  return ok;
}

/** An error answer of /v1: `{error: {code, message, details}}`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/**
 * One call to the API with the page session. A mutation carries an Idempotency-Key — the caller's,
 * kept across the user's retries of one action (see `once` in accounts.ts), or one made for this
 * call — so a retry after a lost answer or a refresh is the same request, not a second one.
 */
export async function call<T>(method: string, path: string, body?: unknown, key?: string): Promise<T> {
  const idem = method === 'GET' ? null : (key ?? crypto.randomUUID());
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token && !(await refresh())) throw new SignedOut();
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (idem) headers['idempotency-key'] = idem;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401) {
      token = null;
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
    if (!res.ok) throw new ApiError(res.status, json.error?.code, json.error?.message ?? `HTTP ${res.status}`, json.error?.details);
    return json as T;
  }
  throw new SignedOut();
}

export const get = <T>(path: string) => call<T>('GET', path);

/** A GET whose answer is not JSON (the QR code's SVG), with the same session and errors as call(). */
export async function text(path: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token && !(await refresh())) throw new SignedOut();
    const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      token = null;
      continue;
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
      throw new ApiError(res.status, json.error?.code, json.error?.message ?? `HTTP ${res.status}`, json.error?.details);
    }
    return res.text();
  }
  throw new SignedOut();
}

// The answer of /v1/me (src/v1/index.ts).
export interface Me {
  user: { id: number; email: string; email_confirmed: boolean; locale: string };
  plan: 'free' | 'api';
  limits: { cf_accounts: number; sites: number; links: number; rules_per_link: number; api_keys: number };
  use: { cf_accounts: number; api_keys: number };
}

export interface MetricAdvice {
  level: string;
  limit: number;
  busiest: { day: string | null; value: number };
  forecast: string | null;
}
export interface Account {
  id: string;
  cf_account_id: string;
  name: string | null;
  state: string;
  token: { name: string; expires_at: string | null } | null;
  error: { code?: string; warnings?: string[]; [k: string]: unknown } | null;
  edge: { bundle: string; up_to_date: boolean; schema: number | null; installed_at: string | null } | null;
  push: { at: string; bundle: string; schema: number | null; queue: number; error: string | null; dropped: Record<string, number> } | null;
  advice: { level: string; metric: string | null; metrics: Record<string, MetricAdvice>; unavailable?: string[]; suggest?: string; paid?: true; at: string } | null;
  operation?: { kind: string; state: string; step: string; error: { code?: string; message?: string } | null; updated_at: string } | null;
  /** GET /v1/accounts/{id} only */
  link_hosts?: LinkHost[];
  created_at: string;
}
export interface LinkHost {
  id: string;
  account_id: string;
  site_id: string | null;
  host: string;
  state: string;
  config: 'pending' | 'synced';
  error: { code?: string; [k: string]: unknown } | null;
  created_at: string;
}
export interface Key {
  id: string;
  prefix: string;
  scopes: string[];
  allow_accounts: string[] | null;
  allow_ips: string[] | null;
  created_at: string;
  last_used: string | null;
}
