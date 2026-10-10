// Pickers in the 301-ui manner (its .dropdown and locale combobox): a select of a few known values,
// and a host field that suggests the zones of the chosen Cloudflare account.
import { call } from './api';
import { h, s } from './dom';
import { t } from './i18n';

const chevron = () => s('svg', { class: 'icon btn-chip__chevron', 'aria-hidden': 'true' }, s('use', { href: '/icons.svg#i-mono-chevron-down' }));

/** One open menu at a time: a click anywhere else, or Escape, closes it. */
let openNow: (() => void) | null = null;
document.addEventListener('click', () => openNow?.());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') openNow?.();
});

/** A select of fixed options: a chip that opens a menu (301-ui `.dropdown`). */
export function dropdown(options: { value: string; label: string }[], opts: { id?: string; label?: string; value?: string; onChange?: (v: string) => void } = {}): { el: HTMLElement; value: () => string } {
  let current = options.find((o) => o.value === opts.value) ?? options[0]!;
  const text = h('span', { class: 'btn-chip__label' }, current.label);
  const trigger = h('button', { type: 'button', class: 'btn-chip btn-chip--dropdown dropdown__trigger', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', ...(opts.id ? { id: opts.id } : {}), ...(opts.label ? { 'aria-label': opts.label } : {}) }, text, chevron());
  const menu = h('div', { class: 'dropdown__menu dropdown__menu--fit-trigger', role: 'listbox' });
  const root = h('div', { class: 'dropdown dropdown--block' }, trigger, menu);
  const close = () => {
    root.classList.remove('dropdown--open');
    trigger.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (openNow === close) openNow = null;
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
    items.find((i) => i.o === current)?.item.focus();
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  // Focus leaving the dropdown (Tab) closes it; Escape returns the focus to the chip.
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget as Node | null)) close();
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      trigger.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = items.findIndex((i) => i.item === document.activeElement);
    items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.item.focus();
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
