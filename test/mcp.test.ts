// The MCP server (docs/spec.md §15, ADR 0023): both eras of the protocol, its transport, the tools as
// /v1 calls with the caller's key, and the tools held to docs/openapi.yaml both ways.
import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { signAccess } from '../src/auth/jwt';
import { app } from '../src/index';
import { TOOLS } from '../src/mcp/index';
import { SESSION_ONLY, TABLE } from '../src/mcp/table';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';
import { ACC, BOOT, fakeCf, useFakeCloudflare } from './fake-cf';

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ env, dispose } = await testEnv());
  // The documents the resources read, as the static assets serve them.
  env.ASSETS = { fetch: async (r: Request) => (new URL(r.url).pathname === '/agents.md' ? new Response('# clx for agents') : new Response('', { status: 404 })) } as unknown as Fetcher;
});
afterAll(() => dispose());
useFakeCloudflare();

let key = '';
beforeEach(async () => {
  for (const t of ['cf_calls', 'edge_accounts', 'operations', 'idempotency', 'api_keys', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at, plan) VALUES (1, 'free@example.com', 'x', 0, 0, 'free')").run();
  fakeCf.reset();
  key = await issue(['accounts', 'sites', 'links', 'reports']);
});

async function issue(scopes: string[]): Promise<string> {
  const auth = `Bearer ${await signAccess('test-jwt-secret', 1, Date.now())}`;
  const res = await app.request('https://clx.cx/v1/keys', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ scopes }) }, env);
  const issued = ((await res.json()) as { key?: string }).key;
  if (!issued) throw new Error(`no key issued for ${scopes.join(',')}`);
  return issued;
}

let seq = 0;
async function rpc(body: unknown, headers: Record<string, string> = {}, init: RequestInit = {}) {
  const { ctx, settle } = fakeCtx();
  const res = await app.request('https://clx.cx/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.9.0.1', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body), ...init }, env, ctx);
  await settle();
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as Record<string, any>) : null };
}
/** A request of the 2026-07-28 era: `_meta` in the body, the headers mirroring it. */
const modern = (method: string, params: Record<string, unknown> = {}, auth?: string) =>
  rpc(
    { jsonrpc: '2.0', id: ++seq, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } },
    {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
  );
const tool = (name: string, args: Record<string, unknown> = {}, auth = key) => modern('tools/call', { name, arguments: args }, auth);

describe('the protocol', () => {
  it('older clients: initialize echoes their revision, the current one through it is answered 2025-06-18; no session', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(r.body!.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false }, resources: {} }, serverInfo: { name: 'clx' } });
    expect(r.headers.get('mcp-session-id')).toBeNull();
    expect((await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).body!.result.protocolVersion).toBe('2025-06-18');
    // initialize without what it requires; a follow-up naming a revision this server does not speak.
    for (const params of [{ protocolVersion: '2025-06-18' }, { protocolVersion: '2025-06-18', capabilities: [], clientInfo: { name: 't', version: '1' } }, { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {} }])
      expect((await rpc({ jsonrpc: '2.0', id: 4, method: 'initialize', params })).body!.error.code).toBe(-32602);
    expect((await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, { 'mcp-protocol-version': '2024-01-01' })).status).toBe(400);
    // A follow-up without _meta is served as the older era.
    expect((await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).body!.result.tools).toHaveLength(TABLE.length);
  });

  it('2026-07-28: server/discover, and the headers must mirror the body', async () => {
    const d = await modern('server/discover');
    expect(d.body!.result).toMatchObject({ supportedVersions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'], resultType: 'complete' });
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
    const noHeader = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: { _meta: meta } });
    expect([noHeader.status, noHeader.body!.error.code]).toEqual([400, -32020]);
    const wrongMethod = await rpc({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: { _meta: meta } }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'ping' });
    expect(wrongMethod.body!.error.code).toBe(-32020);
    const old = await rpc({ jsonrpc: '2.0', id: 11, method: 'tools/list', params: { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '1999-01-01' } } });
    expect(old.body!.error).toMatchObject({ code: -32022, data: { requested: '1999-01-01' } });
    // A name past ASCII travels base64-encoded; its bytes are UTF-8.
    const sentinel = `=?base64?${Buffer.from('нет_такого', 'utf8').toString('base64')}?=`;
    const r = await rpc(
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'нет_такого', _meta: meta } },
      { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': sentinel },
    );
    expect(r.body!.error).toMatchObject({ code: -32602, message: 'Unknown tool: нет_такого' });
  });

  it('the transport: POST only, notifications 202, no batches, JSON or -32700, an unknown method 404, the body capped by bytes', async () => {
    expect((await app.request('https://clx.cx/mcp', { method: 'GET' }, env)).status).toBe(405);
    expect((await app.request('https://clx.cx/mcp', { method: 'OPTIONS' }, env)).status).toBe(204);
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect((await rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).status).toBe(400);
    expect((await rpc('{nope')).body!.error.code).toBe(-32700);
    expect((await rpc({ id: 1, method: 'ping' })).status).toBe(400);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping', params: [] })).status).toBe(400);
    // A browser page of another site may not call; a native client sends no Origin.
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://clx.cx' })).status).toBe(200);
    const unknown = await rpc({ jsonrpc: '2.0', id: 1, method: 'sampling/nothing' });
    expect([unknown.status, unknown.body!.error.code]).toEqual([404, -32601]);
    // 64 KB of two-byte letters: under the cap in characters, over it in bytes.
    const big = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'ж'.repeat(33_000) } });
    expect(big.status).toBe(413);
  });
});

describe('the tools', () => {
  it('listed without a key, each with its contract’s description and an object schema that takes nothing else', async () => {
    const r = await modern('tools/list');
    const tools = r.body!.result.tools as { name: string; annotations: Record<string, boolean>; inputSchema: { additionalProperties: boolean } }[];
    expect(tools.map((t) => t.name)).toEqual(TABLE.map((t) => t.name));
    expect(tools.every((t) => t.inputSchema.additionalProperties === false)).toBe(true);
    expect(tools.find((t) => t.name === 'disconnect_account')!.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(tools.find((t) => t.name === 'site_report')!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    // A change replaces what was there: an update, a rotation, a new link host are destructive too.
    for (const n of ['update_link', 'rotate_site', 'set_link_host']) expect(tools.find((t) => t.name === n)!.annotations.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'add_link')!.annotations).toMatchObject({ destructiveHint: false, readOnlyHint: false });
    expect(tools.find((t) => t.name === 'whoami')!.annotations.openWorldHint).toBe(false);
  });

  it('a call without a key is 401 with WWW-Authenticate; a revoked or wrong key too', async () => {
    const none = await tool('whoami', {}, '');
    expect([none.status, none.body!.error.code]).toEqual([401, -32001]);
    expect(none.headers.get('www-authenticate')).toMatch(/^Bearer /u);
    expect((await tool('whoami', {}, 'clx_nope')).status).toBe(401);
    // The app's session token has every scope and no key's limits: not taken here.
    expect((await tool('whoami', {}, await signAccess('test-jwt-secret', 1, Date.now()))).status).toBe(401);
  });

  it('a key over its rate limit: the tool’s error carries /v1’s Retry-After', async () => {
    const limit = env.API_LIMIT;
    env.API_LIMIT = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    try {
      const r = (await tool('whoami')).body!.result;
      expect(r).toMatchObject({ isError: true, structuredContent: { error: { code: 'rate_limited' }, retry_after: 60 } });
      expect(r.content[0].text).toContain('Retry after 60 s.');
    } finally {
      env.API_LIMIT = limit;
    }
  });

  it('an idempotency_key that is not 1–200 visible ASCII characters is the tool’s error, never silently replaced', async () => {
    for (const k of [42, '', 'with space', 'x'.repeat(201)]) expect((await tool('connect_account', { cf_account_id: ACC, bootstrap_token: BOOT, idempotency_key: k })).body!.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('idempotency_key') }] });
    expect((await env.DB.prepare('SELECT count(*) AS n FROM edge_accounts').first<{ n: number }>())!.n).toBe(0);
  });

  it('whoami is GET /v1/me with the key; an argument it does not take, or a missing one, is the tool’s error', async () => {
    const r = await tool('whoami');
    expect(r.body!.result).toMatchObject({ isError: false, structuredContent: { plan: 'free', via: 'key', limits: { cf_accounts: 1 } } });
    expect((await tool('whoami', { verbose: true })).body!.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('Unknown argument "verbose"') }] });
    expect((await tool('get_site')).body!.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('Missing argument "id"') }] });
    // An id is one path segment: `..` would turn get_site into another /v1 call.
    for (const id of ['..', 'a/b', 'a?b=1']) expect((await tool('get_site', { id })).body!.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('invalid_request') }] });
  });

  it('the key’s scopes are /v1’s: a reports key cannot connect an account — scope_required as the tool’s error', async () => {
    await env.DB.prepare("UPDATE users SET plan = 'api' WHERE id = 1").run();
    const reports = await issue(['reports']);
    const r = await tool('connect_account', { cf_account_id: ACC, bootstrap_token: BOOT }, reports);
    expect(r.status).toBe(200);
    expect(r.body!.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'scope_required' } } });
  });

  it('connect_account: the same idempotency_key twice is one account and the first answer', async () => {
    const args = { cf_account_id: ACC, bootstrap_token: BOOT, idempotency_key: 'mcp-connect-1' };
    const a = await tool('connect_account', args);
    const b = await tool('connect_account', args);
    expect(a.body!.result.isError).toBe(false);
    expect(b.body!.result.structuredContent).toEqual(a.body!.result.structuredContent);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM edge_accounts').first<{ n: number }>())!.n).toBe(1);
    const list = await tool('list_accounts');
    expect(list.body!.result.structuredContent.accounts).toHaveLength(1);
  });
});

describe('the resources', () => {
  it('the documents for agents, read from the static files', async () => {
    const list = await modern('resources/list');
    expect(list.body!.result.resources.map((r: { uri: string }) => r.uri)).toContain('https://clx.cx/agents.md');
    const read = await rpc(
      { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'https://clx.cx/agents.md', _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } },
      { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'resources/read', 'mcp-name': 'https://clx.cx/agents.md' },
    );
    expect(read.body!.result.contents).toEqual([{ uri: 'https://clx.cx/agents.md', mimeType: 'text/markdown', text: '# clx for agents' }]);
  });

  it('an answer over 1 MiB as it goes out is refused, never cut — a resource too', async () => {
    const assets = env.ASSETS;
    env.ASSETS = { fetch: async () => new Response('x'.repeat(1024 * 1024 + 1)) } as unknown as Fetcher;
    try {
      const r = await rpc({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: 'https://clx.cx/agents.md' } });
      expect(r.body).toMatchObject({ id: 7, error: { code: -32603 } });
    } finally {
      env.ASSETS = assets;
    }
  });
});

describe('the tools and the contract', () => {
  const doc = parse(fs.readFileSync('docs/openapi.yaml', 'utf8')) as { paths: Record<string, Record<string, unknown>> };
  const calls = Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).map((m) => `${m.toUpperCase()} ${p}`));

  it('every /v1 call a key may make has a tool, and every tool is a call of the contract', () => {
    const tools = TABLE.map((t) => `${t.method} ${t.path}`);
    expect([...tools, ...SESSION_ONLY].sort()).toEqual([...calls].sort());
  });

  it('src/mcp/schemas.gen.ts is what docs/openapi.yaml makes now', async () => {
    const { build } = (await import('../scripts/build-mcp.mjs' as string)) as { build: () => string };
    expect(fs.readFileSync('src/mcp/schemas.gen.ts', 'utf8')).toBe(build());
    expect(TOOLS).toHaveLength(TABLE.length);
  });
});
