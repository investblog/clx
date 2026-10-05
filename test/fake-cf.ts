// A small Cloudflare for the tests: one account's tokens and catalog, its D1 databases, Workers
// scripts with versions, deployments and schedules, and zones. `fetch` is stubbed for
// api.cloudflare.com only.
import { afterAll, beforeAll, vi } from 'vitest';

export const ACC = 'a'.repeat(32);
export const OTHER = 'b'.repeat(32);
export const BOOT = 'boot_'.padEnd(40, 'x');

interface Script {
  code: string;
  bindings: { type: string; name: string; text?: string; id?: string }[];
  secrets: Map<string, string>;
  versions: string[];
  live: string;
  crons: string[];
  handlers: string[];
}

export const fakeCf = {
  tokens: new Map<string, { id: string; name: string; value: string; status: string; rights: string[] }>(),
  seq: 0,
  /** path fragments that answer 503 once (a passing failure), or 403 to the working token */
  failOnce: new Set<string>(),
  denyWorking: new Set<string>(),
  /** path fragments where the working token gets 401 (unusable) */
  rejectWorking: new Set<string>(),
  /** token ids whose DELETE fails */
  stuck: new Set<string>(),
  /** method + path fragments that answer 400 every time ("PUT /schedules") */
  refuse: new Set<string>(),
  scripts: new Map<string, Script>(),
  dbs: new Map<string, { name: string; schema: number; sql: string[] }>(),

  reset() {
    this.tokens.clear();
    this.failOnce.clear();
    this.denyWorking.clear();
    this.rejectWorking.clear();
    this.stuck.clear();
    this.refuse.clear();
    this.scripts.clear();
    this.dbs.clear();
    this.seq = 0;
    this.tokens.set('boot', { id: 'boot', name: 'bootstrap', value: BOOT, status: 'active', rights: [] });
  },
  /** A script put there by someone else (the user, another tool). */
  foreignScript(name: string, code = 'export default {}', handlers = ['fetch'], crons: string[] = []) {
    this.scripts.set(name, { code, bindings: [], secrets: new Map(), versions: ['vx'], live: 'vx', crons, handlers });
  },
};

const CATALOG = [
  ...['Account Settings Read', 'Account Analytics Read', 'D1 Read', 'D1 Write', 'Workers Scripts Read', 'Workers Scripts Write', 'Account API Tokens Write'].map((name, i) => ({ id: `g${i}`, name, scopes: ['com.cloudflare.api.account'] })),
  ...['Zone Read', 'Workers Routes Read', 'Workers Routes Write'].map((name, i) => ({ id: `z${i}`, name, scopes: ['com.cloudflare.api.account.zone'] })),
];

const ok = (result: unknown) => Response.json({ success: true, result, errors: [] });
const no = (status: number, code = 1000) => Response.json({ success: false, result: null, errors: [{ code, message: `fake ${status}` }] }, { status });

async function workers(path: string, method: string, init: RequestInit, url: URL): Promise<Response | null> {
  const base = `/accounts/${ACC}/workers/scripts`;
  if (path === base && method === 'GET') return ok([...fakeCf.scripts].map(([id, s]) => ({ id, handlers: s.handlers, etag: 'e' })));
  const m = path.match(new RegExp(`^${base}/([^/]+)(/[a-z]+)?$`, 'u'));
  if (!m) return null;
  const [, name, sub] = m as unknown as [string, string, string | undefined];
  const script = fakeCf.scripts.get(name);
  if (!sub && method === 'PUT') {
    const form = init.body as FormData;
    const code = await (form.get('worker.js') as Blob).text();
    const meta = JSON.parse(await (form.get('metadata') as Blob).text()) as { bindings: Script['bindings']; keep_bindings?: string[] };
    const secrets = meta.keep_bindings?.includes('secret_text') && script ? new Map(script.secrets) : new Map<string, string>();
    for (const b of meta.bindings) if (b.type === 'secret_text') secrets.set(b.name, b.text!);
    const version = `v${++fakeCf.seq}`;
    const handlers = /scheduled/u.test(code) ? ['fetch', 'scheduled'] : ['fetch'];
    fakeCf.scripts.set(name, { code, bindings: meta.bindings.filter((b) => b.type !== 'secret_text'), secrets, versions: [...(script?.versions ?? []), version], live: version, crons: script?.crons ?? [], handlers });
    return ok({ id: name, deployment_id: version.replace(/-/gu, ''), handlers });
  }
  if (!script) return no(404, 10007);
  if (!sub && method === 'GET') {
    const boundary = `b${Math.random().toString(16).slice(2)}`;
    return new Response(`--${boundary}\r\nContent-Disposition: form-data; name="worker.js"\r\n\r\n${script.code}\r\n--${boundary}--\r\n`, { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
  }
  if (!sub && method === 'DELETE' && url.searchParams.get('force') === 'true') {
    fakeCf.scripts.delete(name);
    return ok(null);
  }
  if (sub === '/deployments' && method === 'GET') return ok({ deployments: [{ versions: [{ version_id: script.live, percentage: 100 }] }] });
  if (sub === '/deployments' && method === 'POST') {
    const body = JSON.parse(String(init.body)) as { versions: { version_id: string; percentage: number }[] };
    const v = body.versions[0]!;
    if (v.percentage !== 100 || !script.versions.includes(v.version_id)) return no(400);
    script.live = v.version_id;
    return ok({ id: 'dep' });
  }
  if (sub === '/schedules' && method === 'GET') return ok({ schedules: script.crons.map((cron) => ({ cron })) });
  if (sub === '/schedules' && method === 'PUT') {
    script.crons = (JSON.parse(String(init.body)) as { cron: string }[]).map((s) => s.cron);
    return ok({ schedules: script.crons.map((cron) => ({ cron })) });
  }
  return no(404);
}

function d1(path: string, method: string, init: RequestInit, url: URL): Response | null {
  const base = `/accounts/${ACC}/d1/database`;
  if (path === base && method === 'GET') {
    const name = url.searchParams.get('name');
    return ok([...fakeCf.dbs].filter(([, d]) => !name || d.name.includes(name)).map(([uuid, d]) => ({ uuid, name: d.name })));
  }
  if (path === base && method === 'POST') {
    const { name } = JSON.parse(String(init.body)) as { name: string };
    if ([...fakeCf.dbs.values()].some((d) => d.name === name)) return no(400, 7502);
    const uuid = `db-${++fakeCf.seq}`;
    fakeCf.dbs.set(uuid, { name, schema: 0, sql: [] });
    return ok({ uuid, name });
  }
  const m = path.match(new RegExp(`^${base}/([^/]+)(/query)?$`, 'u'));
  if (!m) return null;
  const db = fakeCf.dbs.get(m[1]!);
  if (!db) return no(404, 7404);
  if (!m[2] && method === 'DELETE') {
    fakeCf.dbs.delete(m[1]!);
    return ok(null);
  }
  if (!m[2] && method === 'GET') return ok({ uuid: m[1], name: db.name });
  if (m[2] && method === 'POST') {
    const { sql } = JSON.parse(String(init.body)) as { sql: string };
    db.sql.push(sql);
    const set = sql.match(/VALUES \('schema', (\d+)\)/u);
    if (set) db.schema = Number(set[1]);
    const statements = sql.split(';').filter((s) => s.trim());
    return ok(statements.map((s) => ({ results: /SELECT value FROM meta/u.test(s) && db.schema ? [{ value: db.schema }] : [] })));
  }
  return no(404);
}

async function cloudflare(url: URL, init: RequestInit): Promise<Response> {
  const method = init.method ?? 'GET';
  const path = url.pathname.replace('/client/v4', '');
  const bearer = String((init.headers as Record<string, string>).authorization ?? '').replace('Bearer ', '');
  const caller = [...fakeCf.tokens.values()].find((t) => t.value === bearer && t.status === 'active');
  if (!caller) return no(401, 9109);
  for (const f of fakeCf.failOnce)
    if (path.includes(f)) {
      fakeCf.failOnce.delete(f);
      return no(503);
    }
  if (caller.name.startsWith('clx-') && [...fakeCf.rejectWorking].some((f) => path.includes(f))) return no(401, 9109);
  if (caller.name.startsWith('clx-') && [...fakeCf.denyWorking].some((f) => path.includes(f))) {
    if (path === '/graphql') return Response.json({ data: null, errors: [{ message: 'not authorized', extensions: { code: 'authz' } }] });
    return no(403, 9109);
  }
  if ([...fakeCf.refuse].some((f) => `${method} ${path}`.includes(f))) return no(400, 10021);
  if (path === '/graphql') return Response.json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [] }] } }, errors: null });
  if (!path.startsWith(`/accounts/${ACC}`) && !path.startsWith('/zones')) return no(403);
  if (path.endsWith('/tokens/verify')) return ok({ id: caller.id, status: 'active', expires_on: new Date(Date.now() + 86_400_000).toISOString() });
  if (path === `/accounts/${ACC}`) return ok({ id: ACC, name: 'Test account' });
  if (path.endsWith('/tokens/permission_groups')) return ok(CATALOG);
  if (path.endsWith('/tokens') && method === 'GET') {
    const page = Number(url.searchParams.get('page') ?? 1);
    return ok([...fakeCf.tokens.values()].slice((page - 1) * 50, page * 50).map(({ id, name, status }) => ({ id, name, status })));
  }
  if (path.endsWith('/tokens') && method === 'POST') {
    const body = JSON.parse(String(init.body)) as { name: string; policies: { permission_groups: { id: string }[] }[] };
    const id = `t${++fakeCf.seq}`;
    const t = { id, name: body.name, value: `working_${id}`.padEnd(40, 'w'), status: 'active', rights: body.policies.flatMap((p) => p.permission_groups.map((g) => g.id)) };
    fakeCf.tokens.set(id, t);
    return ok({ id, name: t.name, value: t.value, policies: body.policies });
  }
  const del = path.match(/\/tokens\/([^/]+)$/u);
  if (del && method === 'DELETE') {
    if (fakeCf.stuck.has(del[1]!)) return no(500);
    return fakeCf.tokens.delete(del[1]!) ? ok({ id: del[1] }) : no(404);
  }
  const answer = (await workers(path, method, init, url)) ?? d1(path, method, init, url);
  if (answer) return answer;
  if (path.endsWith('/workers/routes')) return ok([]);
  if (path === '/zones') return ok([{ id: 'zone1' }]);
  return no(404);
}

/** Stub fetch for api.cloudflare.com for the suite that calls this. */
export function useFakeCloudflare(): void {
  const realFetch = globalThis.fetch;
  beforeAll(() => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return url.hostname === 'api.cloudflare.com' ? cloudflare(url, init) : realFetch(input, init);
    });
  });
  afterAll(() => vi.unstubAllGlobals());
}
