// Dialogs on the browser's own <dialog> (after catchall.in and 301-ui's dialog.ts): Escape, the focus
// trap and the stacking come with showModal(). A confirmation replaces the two-step "are you sure"
// inside the page: one reused dialog, a Promise<boolean>, the focus on Cancel.
import { codeBlock, h, s } from './dom';
import { t } from './i18n';

export interface ConfirmOptions {
  title: string;
  /** The consequences, in words: what happens and what is lost. */
  body: string;
  confirmLabel: string;
  /** A destructive action paints the confirming button red. */
  danger?: boolean;
}

let dlg: HTMLDialogElement | null = null;

/** Ask once more; false on every way out but the confirming button (Cancel, Escape, a click outside). */
export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  dlg ??= document.body.appendChild(h('dialog', { class: 'dialog' }));
  const d = dlg;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      d.close();
      resolve(ok);
    };
    const cancel = h('button', { type: 'button', class: 'btn btn--ghost' }, t.common.cancel);
    const ok = h('button', { type: 'button', class: `btn ${opts.danger ? 'btn--danger' : 'btn--primary'}` }, opts.confirmLabel);
    cancel.addEventListener('click', () => settle(false));
    ok.addEventListener('click', () => settle(true));
    d.replaceChildren(h('h2', { class: 'dialog__title' }, opts.title), h('p', {}, opts.body), h('div', { class: 'dialog__actions' }, cancel, ok));
    d.addEventListener(
      'close',
      () => {
        d.replaceChildren();
        settle(false);
      },
      { once: true },
    );
    closeOnBackdrop(d);
    d.showModal();
    cancel.focus();
  });
}

const closeIcon = () => s('svg', { class: 'icon', 'aria-hidden': 'true' }, s('use', { href: '/icons.svg#i-mono-close' }));

/**
 * A drawer for adding or editing: a new <dialog> each time, removed once closed, so a late answer
 * of an earlier opening only reaches a detached form. `body(close)` draws the form.
 */
export function openDrawer(title: string, body: (close: () => void) => Node): void {
  const d = h('dialog', { class: 'drawer', 'aria-label': title });
  const x = h('button', { type: 'button', class: 'btn-close', 'aria-label': t.common.close, title: t.common.close }, closeIcon());
  const close = () => d.close();
  x.addEventListener('click', close);
  d.append(h('div', { class: 'drawer__head' }, h('h2', {}, title), x), body(close));
  d.addEventListener('close', () => d.remove(), { once: true });
  closeOnBackdrop(d);
  document.body.append(d);
  d.showModal();
  d.querySelector<HTMLElement>('input, select, textarea, .dropdown__trigger')?.focus();
}

/** A secret shown once (an API key): copy it now, it is not shown again; nothing of it stays in the page. */
export function showSecret(title: string, value: string, note: string): void {
  const d = h('dialog', { class: 'dialog' });
  const done = h('button', { type: 'button', class: 'btn btn--primary' }, t.common.done);
  done.addEventListener('click', () => d.close());
  d.append(h('h2', { class: 'dialog__title' }, title), h('p', { class: 'muted text-sm' }, note), codeBlock(value, t.common.copy), h('div', { class: 'dialog__actions' }, done));
  d.addEventListener('close', () => d.remove(), { once: true });
  document.body.append(d);
  d.showModal();
  done.focus();
}

/** A click on the backdrop (outside the panel) closes the dialog; a drag that only ends there does not. */
function closeOnBackdrop(d: HTMLDialogElement): void {
  if (d.dataset.backdrop) return;
  d.dataset.backdrop = '1';
  const outside = (e: MouseEvent) => {
    const r = d.getBoundingClientRect();
    return e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
  };
  let down = false;
  d.addEventListener('pointerdown', (e) => (down = outside(e)));
  d.addEventListener('click', (e) => {
    if (down && outside(e)) d.close();
    down = false;
  });
}
