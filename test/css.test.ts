// Guards of the design system (after 301-ui's tests/css and catchall.in's), each from a kind of bug
// that shows nothing on its own: a class with no rule renders as nothing; var(--x) of an undefined
// token silently drops the whole declaration; a selector written twice in a file lets the later one
// win unseen; an icon id missing from the sprite draws an empty <use>; a text colour that fails
// contrast on a theme's surfaces is only seen by the reader who cannot read it.
// They read the sources (ui/, site/), in node without a DOM.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const CSS_DIR = path.join(ROOT, 'ui', 'css');
const css = Object.fromEntries(
  fs
    .readdirSync(CSS_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => [f, fs.readFileSync(path.join(CSS_DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')]),
);
const allCss = Object.values(css).join('\n');

function files(dir: string, ext: string[]): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'css' ? [] : files(p, ext);
    return ext.some((x) => e.name.endsWith(x)) ? [p] : [];
  });
}
// The markup lives in the app's pages (ui/) and the site's templates and texts (site/).
const markup = [...files(path.join(ROOT, 'ui'), ['.ts']), ...files(path.join(ROOT, 'site'), ['.ts', '.html'])].map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// The guards below read the files one by one; the page gets what index.css imports, in its order.
it('index.css imports every stylesheet once, tokens before components before clx', () => {
  const imports = [...css['index.css']!.matchAll(/@import\s+"\.\/([\w-]+\.css)";/gu)].map((m) => m[1]);
  expect(imports).toEqual(['theme.css', 'components.css', 'app.css']);
  expect(Object.keys(css).filter((f) => f !== 'index.css').sort()).toEqual([...imports].sort());
});

describe('every class used has a rule', () => {
  const defined = new Set([...allCss.matchAll(/\.([a-zA-Z_][\w-]*)/gu)].map((m) => m[1]!));
  const used = new Set<string>();
  const add = (value: string) => {
    for (const cls of value.split(/\s+/u)) if (cls && !cls.includes('$')) used.add(cls);
  };
  // class: '…' and class: `…` (h()), class="…" (templates), classList calls. In a `${…}` the quoted
  // literals are classes (`${on ? ' is-active' : ''}`), joined to the text before it
  // (`banner--${x ? 'danger' : 'warning'}`); the operands of a comparison are not.
  const literals = (text: string) =>
    text.replace(/([\w-]*)\$\{([^}]*)\}/gu, (_all, prefix: string, expr: string) => {
      const found = [...expr.replace(/[!=]==?\s*'[^']*'/gu, '').matchAll(/'([\w -]*)'/gu)].map((q) => q[1]!).filter((f) => f.trim());
      if (!found.length) return '$';
      // A literal with a leading space is a class of its own; one without ends the class before it.
      const joined = found.filter((f) => !f.startsWith(' ')).map((f) => prefix + f);
      return ` ${joined.length ? '' : prefix} ${[...joined, ...found.filter((f) => f.startsWith(' '))].join(' ')} `;
    });
  for (const m of markup.matchAll(/class: '([^']*)'|class: `([^`]*)`|class="([^"]*)"|classList\.(?:add|remove|toggle)\('([^']*)'/gu)) add(m[2] !== undefined ? literals(m[2]) : (m[1] ?? m[3] ?? m[4] ?? ''));
  // A modifier handed to a helper as a plain string (action('…', 'btn--ghost btn--sm', …)).
  for (const m of markup.matchAll(/'((?:[a-z][\w-]*(?:--|__)[\w-]+ ?)+)'/gu)) add(m[1]!);
  // Classes made from a tone: `badge badge--${tone}`.
  for (const tone of ['success', 'warning', 'danger', 'neutral']) used.add(`badge--${tone}`);

  it('no class without a rule', () => {
    expect([...used].filter((c) => !defined.has(c)).sort()).toEqual([]);
  });
  it('the guard sees the markup', () => {
    expect(used.size).toBeGreaterThan(60);
    expect(used.has('btn--primary') && used.has('hero')).toBe(true);
  });
});

describe('every var(--x) without a fallback is defined', () => {
  const defined = new Set([...allCss.matchAll(/(--[\w-]+)\s*:/gu)].map((m) => m[1]!));
  it('no reference to an undefined token', () => {
    const refs = [...allCss.matchAll(/var\((--[\w-]+)\)/gu)].map((m) => m[1]!);
    expect([...new Set(refs)].filter((t) => !defined.has(t)).sort()).toEqual([]);
  });
  it('the guard sees the tokens', () => {
    expect(defined.size).toBeGreaterThan(80);
  });
});

// The key is the rule's whole selector list (with its @media): `.a, .b` beside `.a` is a cascade
// layer, not a duplicate; a duplicate is two rules with the same head.
describe('no selector twice in a file', () => {
  for (const [file, src] of Object.entries(css)) {
    it(file, () => {
      const seen = new Set<string>();
      const dups: string[] = [];
      const scan = (s: string, prefix: string) => {
        const re = /([^{}]+)\{/gu;
        let m: RegExpExecArray | null;
        while ((m = re.exec(s))) {
          const sel = m[1]!.trim();
          let depth = 1;
          let i = re.lastIndex;
          for (; i < s.length && depth; i++) depth += s[i] === '{' ? 1 : s[i] === '}' ? -1 : 0;
          if (sel.startsWith('@')) {
            if (!sel.startsWith('@keyframes') && !sel.startsWith('@font-face')) scan(s.slice(re.lastIndex, i - 1), `${prefix}${sel.replace(/\s+/gu, ' ')} `);
          } else {
            const key = prefix + sel.split(/,(?![^(]*\))/u).map((x) => x.trim().replace(/\s+/gu, ' ')).sort().join(', ');
            if (seen.has(key)) dups.push(key);
            seen.add(key);
          }
          re.lastIndex = i;
        }
      };
      scan(src, '');
      expect(dups).toEqual([]);
    });
  }
});

describe('every icon exists in the sprite', () => {
  const sprite = new Set([...fs.readFileSync(path.join(ROOT, 'public', 'icons.svg'), 'utf8').matchAll(/<symbol id="i-mono-([\w-]+)"/gu)].map((m) => m[1]!));
  it('no reference to a missing icon', () => {
    // icons.svg#i-mono-<name> in markup, icon('<name>') in the app's code.
    const refs = [...markup.matchAll(/icons\.svg#i-mono-([\w-]+)|\bicon\('([\w-]+)'\)/gu)].map((m) => m[1] ?? m[2]!);
    expect(refs.length).toBeGreaterThan(5);
    expect([...new Set(refs)].filter((r) => !sprite.has(r)).sort()).toEqual([]);
  });
});

// WCAG 2 contrast of each text colour on each surface of a theme; 4.5:1 is AA for body text.
describe('text keeps its contrast in both themes', () => {
  const block = (head: string) => {
    const at = css['theme.css']!.indexOf(`${head} {`);
    expect(at, head).toBeGreaterThanOrEqual(0);
    return css['theme.css']!.slice(at, css['theme.css']!.indexOf('}', at));
  };
  const vars = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)].map((m) => [m[1]!, m[2]!.trim()]));
  const base = vars(block(':root'));
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const TEXT = ['--text-main', '--text-muted', '--text-subtle', '--primary-hover', '--danger', '--warning', '--success'];
  const SURFACES = ['--bg', '--bg-elevated', '--bg-soft'];
  for (const theme of ['dark', 'light']) {
    it(theme, () => {
      const t = { ...base, ...vars(block(`:root[data-theme="${theme}"]`)) };
      const color = (name: string): string => {
        const v = t[name] ?? '';
        const ref = v.match(/^var\((--[\w-]+)\)$/u);
        if (ref) return color(ref[1]!);
        expect(v, `${theme} ${name}`).toMatch(/^#[0-9a-fA-F]{6}$/u);
        return v;
      };
      const low: string[] = [];
      for (const fg of TEXT)
        for (const bg of SURFACES) {
          const [a, b] = [luminance(color(fg)), luminance(color(bg))];
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          if (ratio < 4.5) low.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
        }
      expect(low).toEqual([]);
    });
  }
});
