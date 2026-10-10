// Markdown for agents at a page's own address (src/markdown.ts, docs/spec.md §16).
import { describe, expect, it } from 'vitest';
import { MARKDOWN_PAGES, acceptsMarkdown, servePage } from '../src/markdown';
import type { Env } from '../src/types';
import { SITE_PAGES, markdownFile } from '../site/pages.ts';

describe('acceptsMarkdown', () => {
  it('an explicit text/markdown at least as wanted as HTML', () => {
    expect(acceptsMarkdown('text/markdown')).toBe(true);
    expect(acceptsMarkdown('Text/Markdown; charset=utf-8')).toBe(true);
    expect(acceptsMarkdown('text/markdown, text/html;q=0.9')).toBe(true);
    expect(acceptsMarkdown('text/html, text/markdown;q=0.5')).toBe(false);
  });

  it('a browser, a wildcard, q=0 or garbage stay HTML', () => {
    expect(acceptsMarkdown(null)).toBe(false);
    expect(acceptsMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(false);
    expect(acceptsMarkdown('*/*')).toBe(false);
    expect(acceptsMarkdown('text/*')).toBe(false);
    expect(acceptsMarkdown('text/markdown;q=0')).toBe(false);
    expect(acceptsMarkdown('text/markdown;q=abc')).toBe(false);
  });
});

it('the Worker serves markdown for exactly the pages the site table gives a copy', () => {
  const table = Object.fromEntries(SITE_PAGES.filter((p) => p.markdown).map((p) => [p.slug, `/${markdownFile(p.slug)}`]));
  expect(MARKDOWN_PAGES).toEqual(table);
});

describe('servePage', () => {
  // Static Assets as the Worker sees them: the two files of /agents, nothing else.
  const files: Record<string, [string, string]> = { '/agents': ['<h1>html</h1>', 'text/html; charset=utf-8'], '/agents.md': ['# md', 'text/plain'] };
  const env = {
    ASSETS: {
      fetch: async (input: Request | URL | string) => {
        const f = files[new URL(input instanceof Request ? input.url : input).pathname];
        return f ? new Response(f[0], { headers: { 'content-type': f[1], link: '</llms.txt>; rel="describedby"' } }) : new Response('not found', { status: 404 });
      },
    },
  } as unknown as Env;
  const get = (accept?: string) => servePage(new Request('https://clx.cx/agents', { headers: accept ? { accept } : {} }), env, '/agents');

  it('markdown to an agent, with Vary and the asset headers kept', async () => {
    const res = await get('text/markdown');
    expect(await res.text()).toBe('# md');
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('vary')).toBe('Accept');
    expect(res.headers.get('link')).toContain('describedby');
  });

  it('HTML to a browser, also with Vary', async () => {
    const res = await get('text/html,*/*;q=0.8');
    expect(await res.text()).toBe('<h1>html</h1>');
    expect(res.headers.get('vary')).toBe('Accept');
  });

  it('HEAD: the headers of the answer, no body', async () => {
    const res = await servePage(new Request('https://clx.cx/agents', { method: 'HEAD', headers: { accept: 'text/markdown' } }), env, '/agents');
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.body).toBeNull();
  });

  it('a build without the markdown file falls back to the HTML', async () => {
    delete files['/agents.md'];
    const res = await get('text/markdown');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });
});
