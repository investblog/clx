// A link's flows as a sankey's nodes and links (ui/flows.ts, docs/spec.md §7).
import { describe, expect, it } from 'vitest';
import { destinationOf, parseDestination } from '../edge/contract';
import { flowChart, type Flow } from '../ui/flows';

const words = { source: (k: string) => `src ${k}`, destination: (k: string) => `to ${k}`, rest: 'rest', display: (n: number) => String(n) };

describe('a recorded destination (edge/contract.ts)', () => {
  it('the main URL, or a rule by its conditions as sets; read back the same', () => {
    expect(destinationOf('https://a/')).toBe('>https://a/');
    expect(parseDestination('>https://a/')).toEqual({ rule: null, url: 'https://a/' });
    const key = destinationOf('https://a/de', { countries: ['DE', 'AT'], devices: ['mobile'] });
    expect(key).toBe('AT,DE;mobile>https://a/de');
    expect(destinationOf('https://a/de', { devices: ['mobile'], countries: ['AT', 'DE'] })).toBe(key);
    expect(parseDestination(key)).toEqual({ rule: { countries: ['AT', 'DE'], devices: ['mobile'] }, url: 'https://a/de' });
    expect(parseDestination(';desktop>https://a/')).toEqual({ rule: { countries: [], devices: ['desktop'] }, url: 'https://a/' });
    for (const k of ['', '(other)', '/page']) expect(parseDestination(k)).toBeNull();
  });

  it('a long country list and a long URL still leave the URL readable within 512 characters', () => {
    const countries = Array.from({ length: 171 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)));
    const key = destinationOf(`https://a/${'x'.repeat(2000)}`, { countries: [...countries].reverse() });
    expect(key).toHaveLength(512);
    const d = parseDestination(key)!;
    expect(d.rule!.countries.slice(0, 40)).toEqual(countries.slice(0, 40));
    expect(d.rule!.countries[40]).toMatch(/^\+131#[0-9a-z]+$/u);
    expect(d.url.startsWith('https://a/xxx')).toBe(true);
    // Lists alike in their first 40 and their length, apart in the rest, stay apart.
    const other = [...countries.slice(0, 170), 'ZZ'];
    expect(destinationOf('https://a/', { countries: other })).not.toBe(destinationOf('https://a/', { countries }));
  });
});

describe('flowChart', () => {
  it('two columns, largest first; a node shows its flows’ sum; flows of the same pair add up', () => {
    const flows: Flow[] = [
      { source: 'qr', to: 'https://a/de', n: 5 },
      { source: '', to: 'https://a/', n: 2 },
      { source: 'qr', to: 'https://a/', n: 1 },
      { source: '', to: 'https://a/de', n: 0 },
    ];
    const { nodes, links } = flowChart(flows, words);
    expect(nodes).toEqual([
      { id: 's0', column: 0, short: 'A', label: 'src qr', display: '6' },
      { id: 's1', column: 0, short: 'B', label: 'src ', display: '2' },
      { id: 'd0', column: 1, short: '1', label: 'to https://a/de', display: '5' },
      { id: 'd1', column: 1, short: '2', label: 'to https://a/', display: '3' },
    ]);
    // A flow of 0 draws nothing.
    expect(links).toEqual([
      { from: 's0', to: 'd0', value: 5, display: '5' },
      { from: 's1', to: 'd1', value: 2, display: '2' },
      { from: 's0', to: 'd1', value: 1, display: '1' },
    ]);
  });

  it('the row over the detail caps is other on both sides, not a direct click', () => {
    const { nodes, links } = flowChart(
      [
        { source: '', to: '>https://a/', n: 3 },
        { source: '', to: '(other)', n: 2 },
      ],
      words,
    );
    expect(nodes.map((n) => n.label)).toEqual(['src ', 'src (other)', 'to >https://a/', 'to (other)']);
    expect(links.map((l) => [l.from, l.to, l.value])).toEqual([
      ['s0', 'd0', 3],
      ['s1', 'd1', 2],
    ]);
  });

  it('past eight a side, the eighth on are one node, and nothing is lost', () => {
    const flows: Flow[] = Array.from({ length: 10 }, (_, i) => ({ source: `s${i}`, to: `d${i % 9}`, n: 100 - i }));
    const { nodes, links } = flowChart(flows, words);
    const sources = nodes.filter((n) => n.column === 0);
    const targets = nodes.filter((n) => n.column === 1);
    expect(sources).toHaveLength(8);
    expect(targets).toHaveLength(8);
    expect(sources.at(-1)).toMatchObject({ short: 'H', label: 'rest', display: String(93 + 92 + 91) });
    // d0 has s0 and s9: 100 + 91.
    expect(targets[0]).toMatchObject({ label: 'to d0', display: '191' });
    expect(targets.at(-1)).toMatchObject({ short: '8', label: 'rest', display: String(93 + 92) });
    expect(links.reduce((a, l) => a + l.value, 0)).toBe(flows.reduce((a, f) => a + f.n, 0));
  });
});
