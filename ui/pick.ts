// Pickers in the 301-ui manner (its .dropdown and locale combobox): a select of a few known values,
// and a host field that suggests the zones of the chosen Cloudflare account.
import { call } from './api';
import { h, s } from './dom';
import { t } from './i18n';
import { type Band, menuOpensUp, menuShift } from './place';

const chevron = () => s('svg', { class: 'icon btn-chip__chevron', 'aria-hidden': 'true' }, s('use', { href: '/icons.svg#i-mono-chevron-down' }));

/** One open menu at a time: a click anywhere else, or Escape, closes it. */
let openNow: (() => void) | null = null;
document.addEventListener('click', () => openNow?.());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') openNow?.();
});

/** The window's vertical band, narrowed by every ancestor that clips overflow. */
function clipBand(el: Element, viewportHeight: number): Band {
  const band = { top: 0, bottom: viewportHeight };
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX === 'visible' && overflowY === 'visible') continue;
    const rect = node.getBoundingClientRect();
    band.top = Math.max(band.top, rect.top);
    band.bottom = Math.min(band.bottom, rect.bottom);
  }
  return band;
}

const unplaceMenu = (menu: HTMLElement) => {
  menu.classList.remove('dropdown__menu--up');
  menu.style.translate = '';
};

/** Place an open menu (ui/place.ts): `.dropdown__menu--up` and a horizontal translate, set through
 *  the CSSOM (the CSP's ban on style="" does not cover it). The previous placement is reset first,
 *  or it is what gets measured. */
function placeMenu(root: HTMLElement, menu: HTMLElement): void {
  unplaceMenu(menu);
  const menuRect = menu.getBoundingClientRect();
  const triggerRect = root.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  if (menuOpensUp(triggerRect, menuRect, clipBand(root, viewportHeight), viewportHeight)) menu.classList.add('dropdown__menu--up');
  const shift = menuShift(triggerRect, menuRect, document.documentElement.clientWidth || window.innerWidth);
  if (Math.abs(shift) >= 0.5) menu.style.translate = `${Math.round(shift)}px 0`;
}

/** The open dropdown's placement, done again when the window changes under it (a rotated phone, a
 *  narrowed window), once a frame. */
let placeNow: (() => void) | null = null;
let queued = false;
window.addEventListener('resize', () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    placeNow?.();
  });
});

/** A select of fixed options: a chip that opens a menu (301-ui `.dropdown`). The menu is as wide as
 *  its longest option, never narrower than the chip, and is placed when it opens (ui/place.ts). */
export function dropdown(options: { value: string; label: string }[], opts: { id?: string; label?: string; value?: string; onChange?: (v: string) => void } = {}): { el: HTMLElement; value: () => string } {
  let current = options.find((o) => o.value === opts.value) ?? options[0]!;
  const text = h('span', { class: 'btn-chip__label' }, current.label);
  const trigger = h('button', { type: 'button', class: 'btn-chip btn-chip--dropdown dropdown__trigger', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', ...(opts.id ? { id: opts.id } : {}), ...(opts.label ? { 'aria-label': opts.label } : {}) }, text, chevron());
  const menu = h('div', { class: 'dropdown__menu dropdown__menu--auto', role: 'listbox' });
  const root = h('div', { class: 'dropdown dropdown--block' }, trigger, menu);
  const place = () => placeMenu(root, menu);
  const close = () => {
    root.classList.remove('dropdown--open');
    trigger.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    unplaceMenu(menu);
    if (openNow === close) openNow = null;
    if (placeNow === place) placeNow = null;
  };
  const items = options.map((o) => {
    const item = h('button', { type: 'button', class: 'dropdown__item', role: 'option' }, o.label);
    item.addEventListener('click', () => {
      current = o;
      text.textContent = o.label;
      close();
      trigger.focus();
      opts.onChange?.(o.value);
    });
    return { o, item };
  });
  menu.append(...items.map((i) => i.item));
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (root.classList.contains('dropdown--open')) return close();
    openNow?.();
    for (const { o, item } of items) {
      item.classList.toggle('dropdown__item--selected', o === current);
      item.setAttribute('aria-selected', String(o === current));
    }
    root.classList.add('dropdown--open');
    trigger.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    openNow = close;
    placeNow = place;
    place();
    // The chosen option is scrolled to inside the menu (it scrolls past 320 px), not the page.
    const chosen = items.find((i) => i.o === current)?.item;
    chosen?.focus({ preventScroll: true });
    if (chosen && (chosen.offsetTop < menu.scrollTop || chosen.offsetTop + chosen.offsetHeight > menu.scrollTop + menu.clientHeight)) menu.scrollTop = chosen.offsetTop - (menu.clientHeight - chosen.offsetHeight) / 2;
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  // Focus leaving the dropdown closes it. Escape returns the focus to the chip; so does Tab, which
  // then goes on from the chip to the next field, not through the menu's options.
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget as Node | null)) close();
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      // A drawer is a modal <dialog>: Escape is its close request unless the keydown is cancelled.
      if (e.key === 'Escape') e.preventDefault();
      close();
      trigger.focus();
      return;
    }
    const at = items.findIndex((i) => i.item === document.activeElement);
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, moves[e.key]!))]?.item.focus();
  });
  return { el: root, value: () => current.value };
}

type Zones = { zones: { name: string; status: string }[]; truncated: boolean };
const zonesOf = new Map<string, Promise<Zones | null>>();

/**
 * A host field that suggests the account's zones as the reader types, and says when the host is in
 * none of them (the API refuses it with `zone_not_found` anyway). A subdomain is typed in full.
 */
export function zoneHost(input: HTMLInputElement, account: () => string): { el: HTMLElement; refresh: () => void } {
  const menu = h('div', { class: 'combobox__menu', role: 'listbox', hidden: '' });
  const hint = h('p', { class: 'field-hint', 'aria-live': 'polite' });
  let list: Zones | null = null;
  let active = -1;
  let requested = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  const close = () => {
    menu.hidden = true;
    active = -1;
    if (openNow === close) openNow = null;
  };
  const needle = () => input.value.trim().toLowerCase().replace(/\.$/u, '');
  const holder = (host: string) => list?.zones.find((z) => host === z.name || host.endsWith(`.${z.name}`));
  const check = () => {
    const host = needle();
    const zone = host && list ? holder(host) : undefined;
    hint.classList.toggle('text-warning', !!host && !!list && !zone && !list.truncated);
    hint.textContent = !list ? '' : !host || list.truncated ? '' : !zone ? t.pick.noZone : zone.status !== 'active' ? t.pick.zoneInactive(zone.name) : '';
  };
  const render = () => {
    const q = needle();
    const shown = (list?.zones ?? []).filter((z) => !q || z.name.includes(q) || q.endsWith(`.${z.name}`)).slice(0, 50);
    menu.replaceChildren(
      ...(shown.length
        ? shown.map((z, i) => {
            const item = h('button', { type: 'button', class: `dropdown__item${i === active ? ' is-active' : ''}`, role: 'option', 'data-value': z.name }, z.name, z.status === 'active' ? null : h('span', { class: 'text-sm muted' }, t.pick.inactive));
            item.addEventListener('mousedown', (e) => e.preventDefault());
            item.addEventListener('click', () => pick(z.name));
            return item;
          })
        : [h('p', { class: 'combobox__empty text-sm muted' }, list ? t.pick.noMatch : requested ? t.pick.loading : t.pick.failed)]),
    );
  };
  const open = () => {
    if (!requested) load();
    if (!menu.hidden) return;
    openNow?.();
    menu.hidden = false;
    active = -1;
    openNow = close;
    render();
  };
  // A zone that is the typed host's own replaces it; otherwise the typed subdomain is kept.
  const pick = (name: string) => {
    if (!needle().endsWith(`.${name}`)) input.value = name;
    close();
    check();
    input.focus();
  };
  const load = () => {
    const id = account();
    requested = true;
    list = null;
    hint.textContent = t.pick.loadingAccount;
    hint.classList.remove('text-warning');
    if (!zonesOf.has(id)) zonesOf.set(id, call<Zones>('GET', `/v1/accounts/${id}/zones`).catch(() => (zonesOf.delete(id), null)));
    void zonesOf.get(id)!.then((z) => {
      if (account() !== id) return;
      list = z;
      // A failed load is tried again on the next focus.
      if (!z) {
        requested = false;
        hint.textContent = t.pick.failedHint;
      }
      else check();
      if (!menu.hidden) render();
    });
  };
  input.addEventListener('focus', open);
  input.addEventListener('click', (e) => {
    e.stopPropagation();
    open();
  });
  input.addEventListener('input', () => {
    open();
    active = -1;
    render();
    check();
  });
  input.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLElement>('.dropdown__item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
      active = Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((it, i) => it.classList.toggle('is-active', i === active));
      items[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !menu.hidden && items[active]) {
      e.preventDefault();
      pick(items[active]!.dataset.value!);
    } else if (e.key === 'Escape' && !menu.hidden) {
      // Closes the suggestions only, not the drawer (its <dialog> closes on an uncancelled Escape).
      e.preventDefault();
      close();
    }
  });
  // The menu's items keep the focus off themselves (mousedown), so a blur means the reader left.
  input.addEventListener('blur', close);
  const el = h('div', { class: 'combobox' }, input, menu);
  el.addEventListener('click', (e) => e.stopPropagation());
  // Zones are read on the first focus: a page may hold a picker per account.
  const refresh = () => {
    requested = false;
    list = null;
    hint.textContent = '';
    if (needle()) load();
  };
  return { el: h('div', {}, el, hint), refresh };
}
