// POST /mcp — clx's MCP server over Streamable HTTP (docs/spec.md §15, ADR 0023). This file is the
// transport and the tools; src/mcp/protocol.ts is the protocol. A tool is a /v1 call made inside the
// Worker with the caller's headers, so the key's scopes, allow lists, rate limit, idempotency and
// errors are /v1's own — this layer only maps arguments to a request and the answer to a result.
// Listing (initialize, server/discover, tools/list, resources) is open; a tool needs the API key.
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { dispatch, rpcError, type Called, type Outcome, type Resource, type RpcId, type Tool } from './protocol';
import { KEY_PREFIX } from '../v1/auth';
import { SCHEMAS } from './schemas.gen';
import { SERVER_INFO, TABLE } from './table';

/** The app the tools call: the Worker's own, so /v1's middleware runs as for any request. */
type Ctx = Context['executionCtx'];
type Fetch = (request: Request, env: Env, ctx?: Ctx) => Response | Promise<Response>;

const INSTRUCTIONS =
  'clx counts website visits and serves short links from a worker in the user’s own Cloudflare account. ' +
  'Sign in with the user’s clx API key as `Authorization: Bearer clx_…` (they issue it at https://clx.cx/app#/keys with the scopes the work needs). ' +
  'Start with whoami; connect_account needs a Cloudflare bootstrap token from the user; add_site returns the snippet to embed; reports read the user’s own database. ' +
  'Mutating tools take an optional idempotency_key — pass one and reuse it when retrying. The guide: the resource https://clx.cx/agents.md.';
const MAX_BODY = 64 * 1024;
/** An answer bigger than this is refused, never cut (a report or a QR code is far smaller). */
const MAX_ANSWER = 1024 * 1024;


export const TOOLS: Tool[] = TABLE.map((t) => ({
  name: t.name,
  title: t.title,
  description: SCHEMAS[t.name]!.description,
  inputSchema: SCHEMAS[t.name]!.inputSchema,
  // Every tool but whoami reaches the user's Cloudflare account or its database: an open world.
  annotations: { readOnlyHint: t.method === 'GET', destructiveHint: t.destructive === true, idempotentHint: t.method !== 'POST', openWorldHint: t.name !== 'whoami' },
}));

const RESOURCES: Resource[] = [
  { uri: 'https://clx.cx/agents.md', name: 'agents', description: 'The walkthrough for an agent: from a key to a counted site and a short link.', mimeType: 'text/markdown' },
  { uri: 'https://clx.cx/api.md', name: 'api', description: 'The /v1 reference, every call with its fields and errors.', mimeType: 'text/markdown' },
  { uri: 'https://clx.cx/auth.md', name: 'auth', description: 'How an agent gets access: an API key a person issues.', mimeType: 'text/markdown' },
  { uri: 'https://clx.cx/openapi.yaml', name: 'openapi', description: 'The /v1 contract, OpenAPI 3.1.', mimeType: 'application/yaml' },
];

const messageOf = (text: string): string | undefined => {
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message;
  } catch {
    return undefined;
  }
};

/** A tool call as a /v1 request: `id` into the path, the query parameters, the rest as the body. */
async function call(fetch: Fetch, outer: Request, env: Env, ctx: Ctx | undefined, name: string, args: Record<string, unknown>): Promise<Called> {
  const row = TABLE.find((t) => t.name === name)!;
  const schema = SCHEMAS[name]!;
  // The API key only: /v1 also takes the app's session token, which has every scope and no allow
  // list or rate limit of a key — not for an agent's door.
  const auth = outer.headers.get('authorization');
  if (!auth?.startsWith(`Bearer ${KEY_PREFIX}`)) return { unauthorized: 'Sign in with your clx API key: Authorization: Bearer clx_… (issued at https://clx.cx/app#/keys).' };
  if (args.idempotency_key !== undefined && !(typeof args.idempotency_key === 'string' && /^[\x21-\x7e]{1,200}$/u.test(args.idempotency_key)))
    return { isError: true, text: 'invalid_request: "idempotency_key" must be 1–200 visible ASCII characters.' };
  // An id is a path segment: `..` or a slash would make the call another /v1 path than the tool's.
  if (row.path.includes('{id}') && !(typeof args.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(args.id))) return { isError: true, text: `invalid_request: "id" is not an id of clx.` };
  const url = new URL(row.path.replace('{id}', String(args.id ?? '')), new URL(outer.url).origin);
  for (const q of schema.query) if (args[q] !== undefined) url.searchParams.set(q, String(args[q]));
  const body = Object.fromEntries(schema.body.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
  const headers = new Headers({ authorization: auth });
  for (const h of ['cf-connecting-ip', 'user-agent']) {
    const v = outer.headers.get(h);
    if (v) headers.set(h, v);
  }
  const mutating = row.method !== 'GET';
  if (mutating) headers.set('idempotency-key', typeof args.idempotency_key === 'string' ? args.idempotency_key : crypto.randomUUID());
  if (schema.body.length) headers.set('content-type', 'application/json');
  const res = await fetch(new Request(url, { method: row.method, headers, body: schema.body.length ? JSON.stringify(body) : undefined }), env, ctx);
  const text = await res.text();
  // The answer goes out twice (as text and as structured content): its bytes, doubled, under the cap.
  if (new TextEncoder().encode(text).byteLength * 2 > MAX_ANSWER) return { isError: true, text: `The answer is over ${MAX_ANSWER / 2} bytes; narrow the request.` };
  if (res.status === 401) return { unauthorized: messageOf(text) ?? 'The API key is invalid or revoked.' };
  if (!(res.headers.get('content-type') ?? '').includes('json')) return { isError: !res.ok, text, structured: { [name === 'link_qr' ? 'svg' : 'text']: text } };
  const json = JSON.parse(text) as Record<string, unknown>;
  if (!res.ok) {
    const e = (json.error ?? {}) as { code?: string; message?: string };
    // /v1's Retry-After (429) travels in the result, where a model can read it.
    const retry = res.headers.get('retry-after');
    return { isError: true, text: `${e.code ?? res.status}: ${e.message ?? 'the call failed'}${retry ? ` Retry after ${retry} s.` : ''}`, structured: { ...json, ...(retry ? { retry_after: Number(retry) } : {}) } };
  }
  return { isError: false, text, structured: json };
}

/** The request's execution context; a test's request may have none (Hono throws then). */
const ctxOf = (c: Context): Ctx | undefined => {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
};

export function mcp(fetch: Fetch) {
  const app = new Hono<{ Bindings: Env }>();
  app.options('/', () => new Response(null, { status: 204, headers: { allow: 'POST, OPTIONS' } }));
  app.post('/', async (c) => {
    const respond = (o: Outcome): Response => {
      if (o.kind === 'accepted') return new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } });
      // The whole answer as it goes out, under the cap: refused, never cut (a resource included).
      let json = JSON.stringify(o.body);
      if (new TextEncoder().encode(json).byteLength > MAX_ANSWER) {
        const too = rpcError((o.body.id ?? null) as RpcId, -32603, `The answer is over ${MAX_ANSWER} bytes; narrow the request.`);
        json = JSON.stringify(too.kind === 'response' ? too.body : null);
      }
      return new Response(json, {
        status: o.status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(o.status === 401 ? { 'www-authenticate': 'Bearer realm="clx", error="invalid_token"' } : {}) },
      });
    };
    // Origin, as Streamable HTTP asks against DNS rebinding: a native client sends none; a browser
    // page may call only from clx.cx.
    const from = c.req.header('origin');
    if (from && from !== new URL(c.req.url).origin) return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
    // Capped by bytes, before and after reading: a declared length over the cap is refused unread.
    if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) return respond(rpcError(null, -32600, `Request body exceeds ${MAX_BODY} bytes.`, 413));
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength > MAX_BODY) return respond(rpcError(null, -32600, `Request body exceeds ${MAX_BODY} bytes.`, 413));
    let message: unknown;
    try {
      message = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return respond(rpcError(null, -32700, 'Parse error: body is not valid JSON.', 400));
    }
    const origin = new URL(c.req.url).origin;
    return respond(
      await dispatch(
        {
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
          tools: TOOLS,
          call: (name, args) => call(fetch, c.req.raw, c.env, ctxOf(c), name, args),
          resources: RESOURCES,
          read: async (uri) => {
            const res = await c.env.ASSETS.fetch(new Request(`${origin}${new URL(uri).pathname}`));
            return res.ok ? res.text() : null;
          },
        },
        message,
        { get: (n) => c.req.header(n) ?? null },
      ),
    );
  });
  app.all('/', () => new Response(null, { status: 405, headers: { allow: 'POST, OPTIONS' } }));
  return app;
}

