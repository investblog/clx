// The site pages that have a markdown copy (site/pages.ts, `markdown: true`) answer
// `Accept: text/markdown` with it at their own address (docs/spec.md §16). These paths run the
// Worker first; any other request for them gets the HTML file, with `Vary: Accept` either way so a
// cache keeps the two apart. A test holds this list to the site's table.
import type { Env } from './types';

export const MARKDOWN_PAGES: Record<string, string> = { '/': '/index.md', '/agents': '/agents.md', '/api': '/api.md' };

/**
 * Whether the client asks for markdown: an explicit `text/markdown` with q > 0, weighted at least
 * as high as `text/html`. A wildcard (`*` + `/*`, `text/*`) never selects it — a browser's Accept
 * stays HTML.
 */
export function acceptsMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  let md = 0;
  let html = 0;
  for (const part of accept.split(',')) {
    const [type, ...params] = part.trim().toLowerCase().split(';');
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    const weight = Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0;
    if (type?.trim() === 'text/markdown') md = Math.max(md, weight);
    else if (type?.trim() === 'text/html') html = Math.max(html, weight);
  }
  return md > 0 && md >= html;
}

/** The answer for a page of MARKDOWN_PAGES: its markdown, or the page as Static Assets serve it. */
export async function servePage(request: Request, env: Env, path: string): Promise<Response> {
  const body = (r: Response) => (request.method === 'HEAD' ? null : r.body);
  if (acceptsMarkdown(request.headers.get('accept'))) {
    const md = await env.ASSETS.fetch(new URL(MARKDOWN_PAGES[path]!, request.url));
    // A build without the file falls back to the HTML rather than failing.
    if (md.ok) {
      const res = new Response(body(md), md);
      res.headers.set('content-type', 'text/markdown; charset=utf-8');
      res.headers.set('vary', 'Accept');
      return res;
    }
  }
  const page = await env.ASSETS.fetch(request);
  const res = new Response(body(page), page);
  res.headers.append('vary', 'Accept');
  return res;
}
