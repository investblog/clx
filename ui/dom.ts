// A small element builder. Text goes in as text nodes, never as HTML.
// The page's CSP has no 'unsafe-inline', so a style="" attribute would be dropped — set geometry through the CSSOM.
type Child = Node | string | number | null | undefined | false;

const SVG = 'http://www.w3.org/2000/svg';

/** An SVG element: geometry goes in as attributes, which the CSP allows (unlike style=""). */
export function s(tag: string, attrs: Record<string, string | number> = {}, ...children: (Node | null)[]): SVGElement {
  const el = document.createElementNS(SVG, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.append(c);
  return el;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}
