// Unsaved edits (an editor screen, ADR 0043): the page says what it would lose, and leaving asks first —
// for another page of the app (ui/main.ts), for the language switch and sign-out, and for closing or
// reloading the tab (beforeunload, listened to only while such a page is shown).
import { askConfirm } from './dialog';
import { t } from './i18n';

let guard: { path: string; dirty: () => boolean } | null = null;

const onUnload = (e: BeforeUnloadEvent) => {
  if (guard?.dirty()) e.preventDefault();
};

/** The page at `path` holds edits while `dirty()` says so; until the next page or `release()`. */
export function guardLeave(path: string, dirty: () => boolean): void {
  if (!guard) window.addEventListener('beforeunload', onUnload);
  guard = { path, dirty };
}

/** Nothing to lose any more (saved, or leaving was confirmed). */
export function release(): void {
  if (guard) window.removeEventListener('beforeunload', onUnload);
  guard = null;
}

/** The path of the page whose edits would be lost by going elsewhere, or null. */
export const holding = (): string | null => (guard?.dirty() ? guard.path : null);

/** Ask whether to drop the edits; yes releases them, so nothing asks again on the way out. */
export async function dropEdits(): Promise<boolean> {
  if (!holding()) return true;
  const ok = await askConfirm({ title: t.common.leaveTitle, body: t.common.leaveBody, confirmLabel: t.common.leave, danger: true });
  if (ok) release();
  return ok;
}
