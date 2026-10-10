// A table that shows its rows a page at a time (301-ui's `.pagination`: "1–50 of 135", Previous /
// Next). The lists of /v1 come whole, so the paging is the page's own. The footer shows only when
// there is more than one page.
import { h } from './dom';
import { t } from './i18n';

export const PAGE = 50;

export function paged(rows: HTMLElement[], draw: (rows: HTMLElement[]) => HTMLElement, size = PAGE): HTMLElement {
  const box = h('div', {});
  const go = (page: number) => {
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const p = Math.min(Math.max(1, page), pages);
    const from = (p - 1) * size;
    const shown = draw(rows.slice(from, from + size));
    if (pages === 1) return box.replaceChildren(shown);
    const prev = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, t.pager.prev);
    const next = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, t.pager.next);
    prev.disabled = p === 1;
    next.disabled = p === pages;
    prev.addEventListener('click', () => go(p - 1));
    next.addEventListener('click', () => go(p + 1));
    box.replaceChildren(shown, h('div', { class: 'pagination' }, h('span', { class: 'pagination__info' }, t.pager.range(from + 1, Math.min(from + size, rows.length), rows.length)), h('div', { class: 'pagination__controls' }, prev, next)));
  };
  go(1);
  return box;
}
