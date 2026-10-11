// The MCP protocol layer (docs/spec.md §15, ADR 0023): JSON-RPC 2.0, the revision table, era
// detection and the method switch — no HTTP here; src/mcp/index.ts is the transport. After
// spintax.net's (@spintax/mcp, MIT, the same owner), which chose its own layer because the
// TypeScript SDK spoke only the older revisions:
//   - modern clients (2026-07-28) send `_meta` in every request and, over HTTP, the headers
//     MCP-Protocol-Version, Mcp-Method and Mcp-Name mirroring the body — served statelessly;
//   - older clients open with `initialize` and are answered per request, never with a session id
//     (the header was always optional for servers).

export const PROTOCOL_VERSION = '2026-07-28';
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SUPPORTED_VERSIONS = [PROTOCOL_VERSION, ...LEGACY_VERSIONS];
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';

export type RpcId = string | number | null;
interface Params {
  _meta?: Record<string, unknown>;
  name?: unknown;
  uri?: unknown;
  arguments?: unknown;
  protocolVersion?: unknown;
}

/** A verdict for the transport: an answer with its HTTP status, or a notification taken (202). */
export type Outcome = { kind: 'response'; body: Record<string, unknown>; status: number } | { kind: 'accepted' };

export interface ServerInfo {
  name: string;
  title: string;
  version: string;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
}

/** A tool's answer: a result (`isError` for a failure the model can read), or "sign in first". */
export type Called = { isError: boolean; text: string; structured?: Record<string, unknown> } | { unauthorized: string };

export interface Resource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface Config {
  serverInfo: ServerInfo;
  instructions: string;
  tools: Tool[];
  call: (name: string, args: Record<string, unknown>) => Promise<Called>;
  resources: Resource[];
  read: (uri: string) => Promise<string | null>;
}

export interface Headers {
  get(name: string): string | null;
}

export const rpcError = (id: RpcId, code: number, message: string, status = 200, data?: Record<string, unknown>): Outcome => ({
  kind: 'response',
  body: { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } },
  status,
});

/** The `=?base64?…?=` form of a header value: the bytes read as UTF-8 (`atob` alone garbles them —
 *  spintax.net's issue #2); a malformed one stays as it is and so fails the comparison. */
export function decodeSentinel(value: string): string {
  const m = /^=\?base64\?(.*)\?=$/u.exec(value);
  if (!m) return value;
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(m[1]!), (c) => c.charCodeAt(0)));
  } catch {
    return value;
  }
}

const TTL_MS = 3_600_000;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function dispatch(cfg: Config, message: unknown, headers: Headers): Promise<Outcome> {
  const capabilities = { tools: { listChanged: false }, resources: {} };
  const ok = (id: RpcId, result: Record<string, unknown>): Outcome => ({
    kind: 'response',
    body: { jsonrpc: '2.0', id, result: { ...result, _meta: { [META_SERVER]: cfg.serverInfo } } },
    status: 200,
  });

  if (Array.isArray(message)) return rpcError(null, -32600, 'Batching is not supported: send a single request.', 400);
  if (typeof message !== 'object' || message === null) return rpcError(null, -32600, 'Invalid JSON-RPC request.', 400);
  const msg = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(null, -32600, 'Invalid JSON-RPC request.', 400);
  if (msg.params !== undefined && !isObject(msg.params)) return rpcError(null, -32600, 'Invalid JSON-RPC request: params must be an object.', 400);
  const method = msg.method;
  const params = (msg.params ?? {}) as Params;
  // A notification (no id) is taken and dropped: a stateless server has nothing to track. `id: null`
  // is not one — it is answered.
  if (!('id' in msg) || msg.id === undefined) return { kind: 'accepted' };
  if (msg.id !== null && typeof msg.id !== 'string' && typeof msg.id !== 'number') return rpcError(null, -32600, 'Invalid JSON-RPC request.', 400);
  const id = msg.id as RpcId;

  // Older revisions: `initialize` selects them. A client asking for the current revision through
  // it is answered 2025-06-18 — the handshake itself is the sign of the older era.
  if (method === 'initialize') {
    const p = params as Params & { capabilities?: unknown; clientInfo?: { name?: unknown; version?: unknown } };
    if (typeof p.protocolVersion !== 'string' || !isObject(p.capabilities) || !isObject(p.clientInfo) || typeof p.clientInfo.name !== 'string' || typeof p.clientInfo.version !== 'string')
      return rpcError(id, -32602, 'initialize requires protocolVersion, capabilities (an object) and clientInfo with name and version.', 400);
    const requested = p.protocolVersion;
    return ok(id, {
      protocolVersion: LEGACY_VERSIONS.includes(requested) ? requested : '2025-06-18',
      capabilities,
      serverInfo: cfg.serverInfo,
      instructions: cfg.instructions,
    });
  }

  const meta = (params._meta ?? {}) as Record<string, unknown>;
  const metaVersion = typeof meta[META_VERSION] === 'string' ? (meta[META_VERSION] as string) : null;
  const headerVersion = headers.get('MCP-Protocol-Version');
  // An older client names its revision in this header on every request after initialize: one this
  // server does not speak is refused (400), not served as if it were another.
  if (metaVersion === null && headerVersion !== null && !SUPPORTED_VERSIONS.includes(headerVersion))
    return rpcError(id, -32600, `Unsupported MCP-Protocol-Version '${headerVersion}'.`, 400, { supported: SUPPORTED_VERSIONS });
  if (metaVersion !== null || headerVersion === PROTOCOL_VERSION) {
    if (metaVersion === null) return rpcError(id, -32602, `Missing required _meta field "${META_VERSION}".`, 400);
    if (!SUPPORTED_VERSIONS.includes(metaVersion)) return rpcError(id, -32022, 'Unsupported protocol version', 400, { supported: SUPPORTED_VERSIONS, requested: metaVersion });
    if (headerVersion === null) return rpcError(id, -32020, 'Missing required MCP-Protocol-Version header.', 400);
    if (headerVersion !== metaVersion) return rpcError(id, -32020, `Header mismatch: MCP-Protocol-Version '${headerVersion}' does not match body value '${metaVersion}'.`, 400);
    const headerMethod = headers.get('Mcp-Method');
    if (headerMethod === null) return rpcError(id, -32020, 'Missing required Mcp-Method header.', 400);
    if (decodeSentinel(headerMethod) !== method) return rpcError(id, -32020, `Header mismatch: Mcp-Method '${headerMethod}' does not match body method '${method}'.`, 400);
    if (method === 'tools/call' || method === 'resources/read') {
      const bodyName = method === 'tools/call' ? params.name : params.uri;
      const headerName = headers.get('Mcp-Name');
      if (headerName === null) return rpcError(id, -32020, 'Missing required Mcp-Name header.', 400);
      if (typeof bodyName !== 'string' || decodeSentinel(headerName) !== bodyName) return rpcError(id, -32020, `Header mismatch: Mcp-Name '${headerName}' does not match body value '${String(bodyName)}'.`, 400);
    }
    // `server/discover` is the era's probe, sent before anything is agreed: exempt.
    if (method !== 'server/discover' && !isObject(meta[META_CAPS])) return rpcError(id, -32602, `Missing required _meta field "${META_CAPS}" (an object).`, 400);
  }

  switch (method) {
    case 'ping':
      return ok(id, { resultType: 'complete' });
    case 'server/discover':
      return ok(id, { resultType: 'complete', supportedVersions: SUPPORTED_VERSIONS, capabilities, instructions: cfg.instructions, ttlMs: TTL_MS, cacheScope: 'public' });
    case 'tools/list':
      return ok(id, { resultType: 'complete', tools: cfg.tools, ttlMs: TTL_MS, cacheScope: 'public' });
    case 'tools/call': {
      if (typeof params.name !== 'string') return rpcError(id, -32602, 'tools/call requires a "name" parameter.');
      const tool = cfg.tools.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
      const fail = (text: string) => ok(id, { resultType: 'complete', content: [{ type: 'text', text }], isError: true });
      const raw = params.arguments;
      if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) return fail(`${tool.name} takes its arguments as an object.`);
      const args = (raw ?? {}) as Record<string, unknown>;
      // Every schema says additionalProperties: false, and the server means it: an argument
      // silently dropped makes a confident wrong answer (spintax.net's lesson).
      const allowed = Object.keys((tool.inputSchema.properties ?? {}) as object);
      const unknown = Object.keys(args).filter((k) => !allowed.includes(k));
      if (unknown.length) return fail(`Unknown argument${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => JSON.stringify(k)).join(', ')}; ${tool.name} accepts: ${allowed.join(', ') || 'none'}.`);
      const missing = ((tool.inputSchema.required ?? []) as string[]).filter((k) => args[k] === undefined);
      if (missing.length) return fail(`Missing argument${missing.length > 1 ? 's' : ''} ${missing.map((k) => JSON.stringify(k)).join(', ')} for ${tool.name}.`);
      const r = await cfg.call(tool.name, args);
      if ('unauthorized' in r) return rpcError(id, -32001, r.unauthorized, 401);
      return ok(id, { resultType: 'complete', content: [{ type: 'text', text: r.text }], ...(r.structured ? { structuredContent: r.structured } : {}), isError: r.isError });
    }
    case 'resources/list':
      return ok(id, { resultType: 'complete', resources: cfg.resources, ttlMs: TTL_MS, cacheScope: 'public' });
    case 'resources/templates/list':
      return ok(id, { resultType: 'complete', resourceTemplates: [] });
    case 'resources/read': {
      if (typeof params.uri !== 'string') return rpcError(id, -32602, 'resources/read requires a "uri" parameter.');
      const entry = cfg.resources.find((r) => r.uri === params.uri);
      const text = entry ? await cfg.read(entry.uri) : null;
      if (!entry || text === null) return rpcError(id, -32602, `Resource not found: ${params.uri}`, 200, { uri: params.uri });
      return ok(id, { resultType: 'complete', contents: [{ uri: entry.uri, mimeType: entry.mimeType, text }] });
    }
  }
  // 404 with -32601 tells a modern client "a modern server, an unknown method" apart from an old
  // HTTP+SSE server's 404 — not to be softened to 200.
  return rpcError(id, -32601, `Method not found: ${method}`, 404);
}
