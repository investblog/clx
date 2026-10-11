// A link's clicks from its sources to where they were sent (docs/spec.md §7), as the nodes and links of
// an affiliate-charts sankey. Pure, no DOM: the app's report and the site's example (site/demo.ts) draw
// it alike. A column holds at most eight nodes, so beyond eight the smallest are joined into one.

export interface Flow {
  source: string;
  to: string;
  n: number;
}

export interface FlowWords {
  source: (key: string) => string;
  destination: (key: string) => string;
  rest: string;
  display: (n: number) => string;
}

const MAX = 8;
const OTHER = '(other)';
const REST = '\u0000rest';
const LETTERS = 'ABCDEFGH';

/** The keys of one side by their clicks, largest first; past eight, the eighth on are one node. */
function top(flows: Flow[], side: 'source' | 'to'): { keys: string[]; group: (key: string) => string } {
  const sums = new Map<string, number>();
  for (const f of flows) sums.set(f[side], (sums.get(f[side]) ?? 0) + f.n);
  const keys = [...sums].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
  if (keys.length <= MAX) return { keys, group: (k) => k };
  const kept = new Set(keys.slice(0, MAX - 1));
  return { keys: [...kept, REST], group: (k) => (kept.has(k) ? k : REST) };
}

export function flowChart(flows: Flow[], w: FlowWords) {
  // The row over the detail caps keeps no dimension (§5): its source is '' but not "direct".
  const live = flows.filter((f) => f.n > 0).map((f) => (f.to === OTHER ? { ...f, source: OTHER } : f));
  const sources = top(live, 'source');
  const targets = top(live, 'to');
  const links = new Map<string, { from: string; to: string; value: number }>();
  for (const f of live) {
    const from = `s${sources.keys.indexOf(sources.group(f.source))}`;
    const to = `d${targets.keys.indexOf(targets.group(f.to))}`;
    const l = links.get(`${from}>${to}`) ?? links.set(`${from}>${to}`, { from, to, value: 0 }).get(`${from}>${to}`)!;
    l.value += f.n;
  }
  const sum = (id: string, end: 'from' | 'to') => [...links.values()].filter((l) => l[end] === id).reduce((n, l) => n + l.value, 0);
  const nodes = [
    ...sources.keys.map((k, i) => ({ id: `s${i}`, column: 0, short: LETTERS[i]!, label: k === REST ? w.rest : w.source(k), display: w.display(sum(`s${i}`, 'from')) })),
    ...targets.keys.map((k, i) => ({ id: `d${i}`, column: 1, short: String(i + 1), label: k === REST ? w.rest : w.destination(k), display: w.display(sum(`d${i}`, 'to')) })),
  ];
  return { nodes, links: [...links.values()].map((l) => ({ ...l, display: w.display(l.value) })) };
}
