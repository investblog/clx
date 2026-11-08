// Where an open menu goes, from 301-ui's src/ui/dropdown.ts (menuShift, menuOpensUp, clipBand):
// up when only the room above holds it, and never past the window's edges. The two rules are pure,
// so the tests run them in node; ui/pick.ts measures the page.

/** Gap kept between an open menu and the window's left and right edges. */
const EDGE = 16;

export interface Span {
  left: number;
  right: number;
}

export interface Band {
  top: number;
  bottom: number;
}

/**
 * Horizontal shift (px) that puts a menu inside [EDGE, viewportWidth − EDGE], from where its own CSS
 * put it (`natural`): as it is when it fits; else aligned to either edge of its trigger when that
 * fits, so it still reads as belonging to it; else clamped into the window, a menu wider than the
 * room keeping its start at the left edge.
 */
export function menuShift(trigger: Span, natural: Span, viewportWidth: number): number {
  const width = natural.right - natural.left;
  const min = EDGE;
  const max = viewportWidth - EDGE;
  const fits = (left: number) => left >= min && left + width <= max;
  if (fits(natural.left)) return 0;
  for (const left of [trigger.left, trigger.right - width]) if (fits(left)) return left - natural.left;
  const clamped = width > max - min ? min : Math.min(Math.max(natural.left, min), max - width);
  return clamped - natural.left;
}

/**
 * Whether a menu opens above its trigger. Up is preferred when there is more room above, at least
 * 150 px of it, and the trigger is not in the window's top 30 %; but only when all of the menu fits
 * above inside `bounds` — the window narrowed by every ancestor that clips (a drawer's scrolling
 * body). What runs past a scroller's top can never be scrolled to, what runs past its bottom still
 * can: when neither side holds the menu, it opens down. `menu` is the menu as measured hanging below
 * the trigger, its gap included.
 */
export function menuOpensUp(trigger: Band, menu: Band, bounds: Band, viewportHeight: number): boolean {
  const spaceBelow = viewportHeight - trigger.bottom;
  const spaceAbove = trigger.top;
  const preferUp = trigger.top >= viewportHeight * 0.3 && spaceAbove >= 150 && spaceAbove > spaceBelow;
  const need = menu.bottom - trigger.bottom;
  if (trigger.top - bounds.top < need) return false;
  return preferUp || bounds.bottom - trigger.bottom < need;
}
