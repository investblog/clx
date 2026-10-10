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

const icon = (name: string) => s('svg', { class: 'icon', 'aria-hidden': 'true' }, s('use', { href: `/icons.svg#i-mono-${name}` }));

/** 301-ui's copy button: an icon that turns into a green tick for two seconds once copied. */
export function copyButton(text: string, label = 'Скопировать'): HTMLButtonElement {
  const btn = h('button', { type: 'button', class: 'btn-icon btn-icon--ghost btn-icon--sm', title: label, 'aria-label': label }, icon('copy'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  btn.addEventListener('click', () =>
    void navigator.clipboard?.writeText(text).then(() => {
      btn.replaceChildren(icon('check'));
      btn.classList.add('text-ok');
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.replaceChildren(icon('copy'));
        btn.classList.remove('text-ok');
      }, 2000);
    }),
  );
  return btn;
}

/** A block of code to copy whole: the copy button sits in its corner. */
export const codeBlock = (text: string, label?: string) => h('div', { class: 'code-copy' }, h('code', { class: 'secret' }, text), copyButton(text, label));

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}
