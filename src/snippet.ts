// The per-site counter snippet (docs/spec.md §5, low footprint). Everything is derived from the
// site's seed, so a rebuilt site gets the same bytes, and nothing is shared by all sites but the
// browser's own API names: the path and the two file names read like ordinary site paths, the code
// has its own identifiers, its own order of statements, one of three wrappers and one of two
// equivalent ways to send (`navigator.sendBeacon`, `fetch` with `keepalive`).
//
// What the code does: on load it sends `document.referrer` to `/<path>/<c>`; on an SPA address
// change (`pushState`, `popstate`) and when the page comes back from the back-forward cache
// (`pageshow` with `persisted`) it sends an empty body — the page itself comes from the Referer
// header of the request (§5 collector).
//
// The bytes of every site's snippet changed once, on 01.11.2026, for the back-forward cache
// (ADR 0039): SNIPPET_REV makes the cron write every site's script to its worker again.

/** Raised when the code of every snippet changes, so that the served scripts follow (src/cf/sites.ts). */
export const SNIPPET_REV = 1;

/** Substrings no generated path or name may contain (§5). */
export const FORBIDDEN = ['clx', 'stat', 'track', 'count', 'beacon', 'analytic', 'pixel', 'metric', 'collect', 'log'];

/** A small deterministic generator (xmur3 → sfc32) seeded by the site's seed string. */
function prng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
  let a = next(), b = next(), c = next(), d = next();
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
}

interface Rand {
  int(n: number): number;
  pick<T>(xs: readonly T[]): T;
  shuffle<T>(xs: T[]): T[];
}
function rand(seed: string): Rand {
  const r = prng(seed);
  const int = (n: number) => Math.floor(r() * n);
  return {
    int,
    pick: (xs) => xs[int(xs.length)]!,
    shuffle: (xs) => {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [xs[i], xs[j]] = [xs[j]!, xs[i]!];
      }
      return xs;
    },
  };
}

const CONSONANTS = 'bcdfghjklmnprstvwz';
const VOWELS = 'aeiou';

/** A pronounceable word of `min`–`max` letters, free of the forbidden substrings. */
function word(r: Rand, min: number, max: number): string {
  for (;;) {
    const len = min + r.int(max - min + 1);
    let w = '';
    while (w.length < len) w += (w.length % 2 === 0 ? CONSONANTS : VOWELS)[r.int(w.length % 2 === 0 ? CONSONANTS.length : VOWELS.length)];
    if (!FORBIDDEN.some((f) => w.includes(f))) return w;
  }
}

export interface SiteNames {
  /** `/a` or `/a/b`, each segment 4–10 letters */
  path: string;
  /** the collector's name under the path */
  c: string;
  /** the script's name under the path, without `.js` */
  s: string;
}

export function namesFor(seed: string): SiteNames {
  const r = rand(`names:${seed}`);
  const segments = Array.from({ length: 1 + r.int(2) }, () => word(r, 4, 10));
  const c = word(r, 3, 8);
  let s = word(r, 3, 8);
  while (s === c) s = word(r, 3, 8);
  return { path: `/${segments.join('/')}`, c, s };
}

/** Identifier names for one snippet: short, distinct, never a JS keyword or a global we use. */
function identifiers(r: Rand, n: number): string[] {
  const taken = new Set(['do', 'if', 'in', 'of', 'let', 'var', 'new', 'for', 'try', 'top', 'name']);
  const out: string[] = [];
  while (out.length < n) {
    const len = 1 + r.int(3);
    let id = 'abcdefghijklmnopqrstuvwxyz'[r.int(26)]!;
    while (id.length < len) id += 'abcdefghijklmnopqrstuvwxyz0123456789_'[r.int(37)];
    if (!taken.has(id)) {
      taken.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * The script for a site — the same bytes for the same seed and names. An external site's
 * (`collector`, §5, ADR 0037) sends to the collector host by a CORS `fetch`, so the browser always
 * sends the page's real `Origin`; its body carries the page, which a cross-site `Referer` does not:
 * the path, then on load the referrer on the second line.
 */
export function scriptFor(seed: string, names: SiteNames, collector?: string): string {
  const r = rand(`code:${seed}`);
  const [url, last, send, push, step, args, body] = identifiers(r, 7) as [string, string, string, string, string, string, string];
  const q = r.pick(['"', "'"]);
  const str = (s: string) => `${q}${s}${q}`;
  const target = `${collector ? `https://${collector}` : ''}${names.path}/${names.c}`;
  const changed = r.pick([`location.href!=${last}`, `${last}!=location.href`]);

  const sender = r.pick([
    `${send}=${body}=>navigator.sendBeacon(${url},${body})`,
    `${send}=${body}=>fetch(${url},{${r.shuffle([`method:${str('POST')}`, `body:${body}`, 'keepalive:!0']).join(',')}})`,
  ]);
  // Drawn only for an external site: a zone site's draws, and so its bytes, stay as they were.
  const external = collector && `${send}=${body}=>fetch(${url},{${r.shuffle([`method:${str('POST')}`, `body:${body}`, 'keepalive:!0']).join(',')}}).catch(()=>0)`;
  const decls = r.shuffle([
    `${url}=${str(target)}`,
    `${last}=location.href`,
    external || sender,
    `${push}=history.pushState`,
    `${step}=()=>{${changed}&&(${last}=location.href,${send}(${collector ? 'location.pathname' : str('')}))}`,
  ]);
  const keyword = r.pick(['let', 'var']);
  const actions = r.shuffle([
    `history.pushState=(...${args})=>{${push}.apply(history,${args});${step}()}`,
    `addEventListener(${str('popstate')},${step})`,
    // A page restored from the back-forward cache runs no code of its own: a view all the same.
    `addEventListener(${str('pageshow')},${args}=>${args}.persisted&&(${last}=location.href,${send}(${collector ? 'location.pathname' : str('')})))`,
  ]);
  const first = collector ? `${send}(location.pathname+${str('\\n')}+document.referrer)` : `${send}(document.referrer)`;
  const statements = r.int(2) ? [...actions, first] : [first, ...actions];
  const inner = `${keyword} ${decls.join(',')};${statements.join(';')}`;
  // `let` in a bare block is scoped to it; `var` needs a function around it.
  const wrappers = keyword === 'let' ? [`{${inner}}`, `(()=>{${inner}})()`, `!function(){${inner}}()`] : [`(()=>{${inner}})()`, `!function(){${inner}}()`];
  return r.pick(wrappers);
}

export interface Snippet {
  inline: string;
  script_tag: string;
}

/** What a site embeds: the code inline, or a tag that loads it from the worker (§5) — on the
 *  collector host for an external site. */
export function snippetFor(seed: string, names: SiteNames, collector?: string): Snippet {
  const r = rand(`tag:${seed}`);
  const src = `${collector ? `https://${collector}` : ''}${names.path}/${names.s}.js`;
  return {
    inline: `<script>${scriptFor(seed, names, collector)}</script>`,
    script_tag: r.int(2) ? `<script defer src="${src}"></script>` : `<script src="${src}" defer></script>`,
  };
}
