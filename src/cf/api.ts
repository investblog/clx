// Calls to the Cloudflare API with a user's token (docs/spec.md §3). Every mutating call is logged
// in cf_calls (§13 item 1); reads are not. 401 means the token is gone (revoked), 403 that it
// lacks a right or a plan on one resource (permission_error) — the two are never mixed (§3 item 6).

export const CF_API = 'https://api.cloudflare.com/client/v4';

export class CfError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly codes: number[],
    message: string,
  ) {
    super(`${method} ${path} → ${status} ${message}`);
  }

  /** The token state this error means, or null for a passing failure (5xx, 429, network). */
  get tokenState(): 'revoked' | 'permission_error' | null {
    return this.status === 401 ? 'revoked' : this.status === 403 ? 'permission_error' : null;
  }
}

/** A GraphQL Analytics query; its errors come in the body with a 200, so they are thrown here. */
export async function cfGraphql<T>(token: string, query: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${CF_API}/graphql`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  } catch (e) {
    throw new CfError(0, 'POST', '/graphql', [], e instanceof Error ? e.message : 'network error');
  }
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] | null };
  if (!res.ok || json.errors?.length) {
    const denied = res.status === 403 || (json.errors ?? []).some((e) => /authz|not authorized|permission/iu.test(`${e.extensions?.code ?? ''} ${e.message}`));
    throw new CfError(res.ok ? (denied ? 403 : 502) : res.status, 'POST', '/graphql', [], (json.errors ?? []).map((e) => e.message).join('; ') || 'error');
  }
  return json.data as T;
}

export interface CallLog {
  db: D1Database;
  edgeAccountId: string;
  principal: string;
}

export async function cf<T>(token: string, method: string, path: string, body?: unknown, log?: CallLog): Promise<T> {
  // A mutation is logged before it is sent (status 0 = sent, no answer yet), so none goes
  // unrecorded: if the log cannot be written, the call is not made.
  const logged =
    log && method !== 'GET'
      ? await log.db
          .prepare('INSERT INTO cf_calls (edge_account_id, principal, method, path, status, at) VALUES (?, ?, ?, ?, 0, ?) RETURNING id')
          .bind(log.edgeAccountId, log.principal, method, path.split('?')[0], Date.now())
          .first<number>('id')
      : null;
  const answered = (status: number) => (log && logged !== null ? log.db.prepare('UPDATE cf_calls SET status = ? WHERE id = ?').bind(status, logged).run().catch(() => undefined) : undefined);
  let res: Response;
  try {
    res = await fetch(`${CF_API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new CfError(0, method, path.split('?')[0]!, [], e instanceof Error ? e.message : 'network error');
  }
  await answered(res.status);
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { code: number; message: string }[] };
  if (!res.ok || !json.success) {
    const errors = json.errors ?? [];
    throw new CfError(res.status, method, path.split('?')[0]!, errors.map((e) => e.code), errors.map((e) => e.message).join('; ') || 'error');
  }
  return json.result as T;
}
