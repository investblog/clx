// The per-site snippet (docs/spec.md §5) and the footprint check of §13 item 10.
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN, namesFor, scriptFor, snippetFor } from '../src/snippet';

const seeds = Array.from({ length: 1000 }, (_, i) => `seed-${i}-${(i * 2654435761) >>> 0}`);

/** Run a snippet in a small fake browser and return what it sent. */
function runIn(code: string, start = 'https://example.com/a', referrer = 'https://google.com/') {
  const sent: { url: string; body: string; via: string }[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const location = { href: start };
  const history = {
    pushState(_state: unknown, _title: string, url: string) {
      location.href = new URL(url, location.href).href;
    },
  };
  const ctx = {
    location,
    history,
    document: { referrer },
    navigator: { sendBeacon: (url: string, body: string) => (sent.push({ url, body, via: 'beacon' }), true) },
    fetch: (url: string, init: { method: string; body: string; keepalive: boolean }) => {
      expect(init).toMatchObject({ method: 'POST', keepalive: true });
      sent.push({ url, body: init.body, via: 'fetch' });
      return Promise.resolve();
    },
    addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
  };
  vm.runInNewContext(code, ctx);
  return { sent, history, location, fire: (type: string) => listeners[type]?.forEach((f) => f()) };
}

describe('snippet', () => {
  it('is the same for the same seed, and fits in 600 bytes', () => {
    const n = namesFor('abc');
    expect(snippetFor('abc', n)).toEqual(snippetFor('abc', namesFor('abc')));
    for (const s of seeds.slice(0, 200)) expect(new TextEncoder().encode(snippetFor(s, namesFor(s)).inline).length).toBeLessThan(600);
  });

  it('sends the referrer on load, an empty body on a real address change, nothing on a repeat', () => {
    for (const s of seeds.slice(0, 100)) {
      const names = namesFor(s);
      const b = runIn(scriptFor(s, names));
      const url = `${names.path}/${names.c}`;
      expect(b.sent).toEqual([{ url, body: 'https://google.com/', via: expect.any(String) }]);
      b.history.pushState(null, '', '/b');
      b.history.pushState(null, '', '/b');
      b.location.href = 'https://example.com/a';
      b.fire('popstate');
      b.fire('popstate');
      expect(b.sent.map((x) => x.body)).toEqual(['https://google.com/', '', '']);
    }
  });

  it('uses both ways to send', () => {
    const via = new Set(seeds.slice(0, 50).map((s) => runIn(scriptFor(s, namesFor(s))).sent[0]!.via));
    expect(via).toEqual(new Set(['beacon', 'fetch']));
  });
});

describe('footprint (§13 item 10)', () => {
  // Browser API names and values, JS keywords: what any site's own code is made of.
  const ALLOWED = new Set(['navigator', 'sendBeacon', 'fetch', 'method', 'body', 'keepalive', 'POST', 'history', 'pushState', 'apply', 'location', 'href', 'addEventListener', 'popstate', 'document', 'referrer', 'let', 'var', 'function', 'script', 'defer', 'src']);
  const tokens = (code: string) => code.match(/"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*/gu) ?? [];
  const all = seeds.map((s) => {
    const names = namesFor(s);
    return { names, snippet: snippetFor(s, names), code: scriptFor(s, names) };
  });

  it('paths and names are ordinary-looking, never a forbidden word, and differ between sites', () => {
    for (const { names } of all) {
      expect(names.path).toMatch(/^(\/[a-z]{4,10}){1,2}$/u);
      expect(names.c).toMatch(/^[a-z]{3,8}$/u);
      expect(names.s).toMatch(/^[a-z]{3,8}$/u);
      for (const f of FORBIDDEN) expect(`${names.path}/${names.c}/${names.s}`).not.toContain(f);
    }
    expect(new Set(all.map((a) => a.names.path)).size).toBeGreaterThan(990);
  });

  it('no identifier or literal of 4+ characters but the browser API is shared by more than 1% of sites', () => {
    const seen = new Map<string, number>();
    for (const { snippet } of all)
      for (const t of new Set([...tokens(snippet.inline), ...tokens(snippet.script_tag)].map((x) => x.replace(/^["']|["']$/gu, ''))))
        if (t.length >= 4 && !ALLOWED.has(t)) seen.set(t, (seen.get(t) ?? 0) + 1);
    const shared = [...seen].filter(([, n]) => n > all.length / 100);
    expect(shared).toEqual([]);
  });

  it('the shape of the code (names and literals masked) is not shared by more than 1% of sites', () => {
    const shapes = new Map<string, number>();
    for (const { code } of all) {
      const shape = code.replace(/"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*/gu, (t) => (ALLOWED.has(t) ? t : /^["']/u.test(t) ? 'S' : 'I'));
      shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    }
    expect(Math.max(...shapes.values())).toBeLessThanOrEqual(all.length / 100);
  });
});
