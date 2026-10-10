// The /api page, made from docs/openapi.yaml — the contract a test holds to the routes
// (test/openapi.test.ts) — so the page cannot describe an endpoint the code does not have. Only the
// conventions at the top are written here by hand.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { REPO } from './pages.ts';
import { escapeHtml } from './layout.ts';

// The YAML is free-form JSON Schema; the page reads it as such.
type Node = { [key: string]: any };

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const SPEC = `${REPO}/blob/main/docs/spec.md`;

export function loadOpenapi(root: string): { text: string; doc: Node } {
  const text = fs.readFileSync(path.join(root, 'docs', 'openapi.yaml'), 'utf8');
  return { text, doc: parse(text) as Node };
}

/** Plain text of the YAML into HTML: `code`, and the spec's sections as links to it. */
function prose(text: string): string {
  return escapeHtml(text.trim())
    .split('`')
    // Outside backticks, error codes and field names (snake_case) are code too.
    .map((part, i) => (i % 2 ? `<code>${part}</code>` : part.replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/gu, '<code>$&</code>')))
    .join('')
    .replace(/docs\/spec\.md/gu, `<a href="${SPEC}">docs/spec.md</a>`)
    .replace(/(?<![\w>])§(\d+)/gu, `<a href="${SPEC}">§$1</a>`);
}

const paragraphs = (text: string | undefined): string =>
  text
    ? text
        .trim()
        .split(/\n\s*\n/u)
        .map((p) => `<p>${prose(p.replace(/\s*\n\s*/gu, ' '))}</p>`)
        .join('\n')
    : '';

const refName = (ref: string): string => ref.split('/').at(-1)!;
const anchor = (name: string): string => `object-${name.toLowerCase()}`;

/** A schema in a few words: `string`, `one of a, b`, `array of Site`, `string | null`. */
function typeOf(s: Node | undefined): string {
  if (!s) return '';
  if (s.$ref) return `<a href="#${anchor(refName(s.$ref))}">${refName(s.$ref)}</a>`;
  if (s.oneOf) return (s.oneOf as Node[]).map(typeOf).join(' | ');
  if (s.enum) return `one of ${(s.enum as unknown[]).filter((v) => v !== null).map((v) => `<code>${escapeHtml(String(v))}</code>`).join(', ')}${(s.enum as unknown[]).includes(null) ? ', or null' : ''}`;
  const types = (Array.isArray(s.type) ? s.type : [s.type ?? 'object']) as string[];
  const base = types
    .map((t) => {
      if (t === 'array') return `array of ${typeOf(s.items) || 'any'}`;
      if (t === 'string' && s.format) return `string (${escapeHtml(s.format)})`;
      return t;
    })
    .join(' | ');
  const extra = [s.pattern ? `<code>${escapeHtml(s.pattern)}</code>` : '', s.minimum !== undefined ? `${s.minimum}–${s.maximum ?? '…'}` : '', s.maxItems ? `up to ${s.maxItems}` : ''].filter(Boolean);
  return extra.length ? `${base}, ${extra.join(', ')}` : base;
}

/** The fields of an object schema as a list; nested objects one level down. */
function fields(s: Node | undefined, depth = 0): string {
  const props = s?.properties as Node | undefined;
  if (!props) return '';
  const required = new Set((s!.required as string[] | undefined) ?? []);
  const items = Object.entries(props).map(([name, p]: [string, Node]) => {
    const nested = depth < 1 && p.properties ? fields(p, depth + 1) : '';
    const desc = p.description ? ` — ${prose(String(p.description))}` : '';
    return `<li><code>${escapeHtml(name)}</code>${required.has(name) ? ' (required)' : ''}: ${typeOf(p)}${desc}${nested}</li>`;
  });
  return `<ul class="fields">${items.join('')}</ul>`;
}

function parameter(doc: Node, p: Node): Node {
  return p.$ref ? (doc.components.parameters[refName(p.$ref)] as Node) : p;
}

function operation(doc: Node, route: string, method: string, op: Node): string {
  const params = ((op.parameters as Node[] | undefined) ?? []).map((p) => parameter(doc, p));
  const idem = params.some((p) => p.name === 'Idempotency-Key');
  const plain = params.filter((p) => p.name !== 'Idempotency-Key');
  const body = op.requestBody?.content?.['application/json']?.schema as Node | undefined;
  const responses = Object.entries((op.responses as Node) ?? {})
    .filter(([code]) => code !== 'default')
    .map(([code, r]: [string, Node]) => {
      const schema = Object.values((r.content as Node | undefined) ?? {})[0]?.schema as Node | undefined;
      const inner = schema?.properties ? Object.entries(schema.properties as Node).map(([k, v]: [string, Node]) => `<code>${escapeHtml(k)}</code>: ${typeOf(v)}`).join(', ') : schema ? typeOf(schema) : '';
      return `<li><code>${code}</code> ${prose(String(r.description ?? ''))}${inner ? ` — ${inner}` : ''}</li>`;
    });
  const id = `${method}-${route}`.replace(/[^a-z0-9]+/giu, '-').replace(/-+$/u, '').toLowerCase();
  return `<section class="endpoint" id="${id}">
<h3><code>${method.toUpperCase()} ${escapeHtml(route)}</code></h3>
<p>${prose(String(op.summary ?? ''))}</p>
${paragraphs(op.description as string | undefined)}
${plain.length ? `<p class="hint">Parameters:</p><ul class="fields">${plain.map((p) => `<li><code>${escapeHtml(p.name)}</code> (${p.in}${p.required ? ', required' : ''}): ${typeOf(p.schema)}${p.description ? ` — ${prose(String(p.description))}` : ''}</li>`).join('')}</ul>` : ''}
${body ? `<p class="hint">Body (JSON):</p>${fields(body)}` : ''}
${idem ? '<p class="hint">Takes an <code>Idempotency-Key</code> header — required with an API key.</p>' : ''}
${responses.length ? `<p class="hint">Answers:</p><ul class="fields">${responses.join('')}</ul>` : ''}
</section>`;
}

/** The endpoint groups, by path; the first that matches takes the route. */
const GROUPS: { title: string; id: string; match: (route: string) => boolean }[] = [
  { title: 'Reports', id: 'reports', match: (r) => r.endsWith('/report') },
  { title: 'You and your API keys', id: 'me', match: (r) => r.startsWith('/v1/me') || r.startsWith('/v1/keys') },
  { title: 'Cloudflare accounts', id: 'accounts', match: (r) => r.startsWith('/v1/accounts') },
  { title: 'Sites', id: 'sites', match: (r) => r.startsWith('/v1/sites') },
  { title: 'Links', id: 'links', match: (r) => r.startsWith('/v1/links') },
];
const ORDER = ['me', 'accounts', 'sites', 'links', 'reports'];

export function apiBody(doc: Node): string {
  const groups = new Map<string, string[]>(ORDER.map((id) => [id, []]));
  for (const [route, item] of Object.entries(doc.paths as Node)) {
    const group = GROUPS.find((g) => g.match(route));
    if (!group) throw new Error(`docs/openapi.yaml: ${route} fits no group of site/api.ts`);
    for (const m of METHODS) if ((item as Node)[m]) groups.get(group.id)!.push(operation(doc, route, m, (item as Node)[m] as Node));
  }
  const errorCodes = String(doc.components.schemas.Error.properties.error.properties.code.description ?? '');
  const sections = ORDER.map((id) => {
    const g = GROUPS.find((x) => x.id === id)!;
    return `<h2 id="${id}">${g.title}</h2>\n${groups.get(id)!.join('\n')}`;
  });
  const objects = Object.entries(doc.components.schemas as Node)
    .filter(([name]) => name !== 'Error')
    .map(([name, s]: [string, Node]) => `<section class="endpoint" id="${anchor(name)}"><h3>${name}</h3>${s.description ? `<p>${prose(String(s.description))}</p>` : ''}${s.properties ? fields(s) : `<p>${typeOf(s)}${s.items ? ` — each with ${Object.keys((s.items as Node).properties ?? {}).map((k) => `<code>${k}</code>`).join(', ')}` : ''}</p>`}</section>`);

  return `<article class="doc">
<h1>clx management API</h1>
<p class="lead">Everything the clx.cx app does goes through these endpoints: connect a Cloudflare account, install the clx-edge worker into it, add sites and take their counter snippet, make short links with rules and QR codes, read reports. An agent setting clx up for a person starts at <a href="/agents">clx for AI agents</a>.</p>
<p>The same contract, machine-readable: <a href="/openapi.yaml">openapi.yaml</a> · <a href="/openapi.json">openapi.json</a> (OpenAPI ${escapeHtml(String(doc.openapi))}). This page as markdown: <a href="/api.md">/api.md</a>, or <code>Accept: text/markdown</code>.</p>

<h2 id="conventions">Conventions</h2>
<ul>
<li><strong>Base URL</strong> <code>https://clx.cx</code>, JSON in and out.</li>
<li><strong>Authentication</strong> <code>Authorization: Bearer clx_…</code> — an API key: one on the free plan, up to 5 on the <code>api</code> plan (higher limits, switched on by clx on request). A person issues them in the app (<a href="/app#/keys">Keys</a>) with the scopes the key needs: <code>accounts</code> (connect, renew, disconnect, install), <code>sites</code>, <code>links</code>, <code>reports</code>. A key may also be limited to some Cloudflare accounts and client IPs. Another user's object answers <code>404</code>; a scope the key lacks, <code>403 scope_required</code>.</li>
<li><strong>Idempotency</strong> Every <code>POST</code>, <code>PUT</code>, <code>PATCH</code> and <code>DELETE</code> takes an <code>Idempotency-Key</code> header, required with an API key. A repeat with the same key and body replays the first answer for 24 hours and does nothing again; the same key with another body is <code>409 idempotency_conflict</code>. Use a new key per intended action, the same key for its retries.</li>
<li><strong>Long operations</strong> Connecting an account and installing the worker answer <code>202</code> with the object as it is; poll its <code>GET</code> every few seconds until the state settles. <code>409 operation_in_progress</code> means another operation on that Cloudflare account is running — retry shortly.</li>
<li><strong>Rate limits</strong> 120 requests a minute per key; over it, <code>429</code> with <code>Retry-After</code> in seconds. Reports read the account's own database for breakdowns and for a link's live days — 30 such reads a minute per clx user, each cached 5 minutes; over that the report still answers <code>200</code>, without them, and <code>unavailable</code> says <code>rate_limited</code>: wait a minute and ask again.</li>
<li><strong>Errors</strong> <code>{"error": {"code", "message", "details"?}}</code>. The codes are stable — branch on <code>code</code>, show <code>message</code> to the person. ${prose(errorCodes)}</li>
</ul>
${sections.join('\n')}
<h2 id="objects">Objects</h2>
${objects.join('\n')}
</article>`;
}

export function apiJson(doc: Node): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
