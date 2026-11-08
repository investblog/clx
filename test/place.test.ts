// Where an open menu goes (ui/place.ts, from 301-ui's tests/ui/dropdown-placement.test.ts).
import { describe, expect, it } from 'vitest';
import { menuOpensUp, menuShift } from '../ui/place';

// EDGE is 16 px on both sides; `natural` is where the menu's own CSS put it, the shift moves it.
const span = (left: number, width: number) => ({ left, right: left + width });
const placed = (trigger: { left: number; right: number }, natural: { left: number; right: number }, vw: number) => {
  const s = menuShift(trigger, natural, vw);
  return { left: natural.left + s, right: natural.right + s };
};

describe('menuShift', () => {
  it('leaves a menu that fits where its CSS put it', () => {
    expect(menuShift(span(500, 100), span(400, 200), 1280)).toBe(0);
  });

  it('never moves a menu further off the window (301-ui#281: a 330 px menu on a 375 px phone)', () => {
    const r = placed(span(100, 60), span(100, 330), 375);
    expect(r.left).toBeGreaterThanOrEqual(16);
    expect(r.right).toBeLessThanOrEqual(375 - 16);
  });

  it("near the right edge, aligns to the trigger's right edge when that fits", () => {
    expect(placed(span(1100, 80), span(1100, 300), 1280).right).toBe(1180);
  });

  it("near the left edge, aligns to the trigger's left edge", () => {
    expect(placed(span(20, 80), span(-100, 200), 768).left).toBe(20);
  });

  it('clamps inside the window when neither edge of the trigger works', () => {
    const r = placed(span(130, 60), span(130, 260), 320);
    expect(r.left).toBeGreaterThanOrEqual(16);
    expect(r.right).toBeLessThanOrEqual(304);
  });

  it('a menu as wide as the room (its CSS max: the window less 32 px) keeps 16 px on both sides', () => {
    expect(placed(span(200, 60), span(200, 288), 320)).toEqual({ left: 16, right: 304 });
  });

  it('a menu wider than the room keeps its start at the left edge', () => {
    expect(placed(span(200, 60), span(200, 400), 320).left).toBe(16);
  });
});

// `bounds` is the window narrowed by clipping ancestors (a drawer's body); the menu is passed as
// measured hanging below a 32 px trigger, `gap` off it.
describe('menuOpensUp', () => {
  const vh = 900;
  const win = { top: 0, bottom: vh };
  const opensUp = (top: number, height: number, bounds: { top: number; bottom: number }, gap = 8) => {
    const trigger = { top, bottom: top + 32 };
    return menuOpensUp(trigger, { top: trigger.bottom + gap, bottom: trigger.bottom + gap + height }, bounds, vh);
  };

  it('opens down near the top and up near the bottom of an unclipped page', () => {
    expect(opensUp(100, 150, win)).toBe(false);
    expect(opensUp(800, 150, win)).toBe(true);
  });

  it("opens down when up would cross a scroller's top", () => {
    expect(opensUp(700, 150, { top: 650, bottom: vh })).toBe(false);
  });

  it('opens up when the clip leaves no room below but room above', () => {
    expect(opensUp(240, 150, { top: 0, bottom: 332 })).toBe(true);
  });

  it("opens down when neither side holds the menu: past the top can't be scrolled to", () => {
    expect(opensUp(700, 150, { top: 650, bottom: 760 })).toBe(false);
    expect(opensUp(100, 150, { top: 80, bottom: 160 })).toBe(false);
  });

  it('counts the measured gap', () => {
    expect(opensUp(700, 150, { top: 540, bottom: vh }, 8)).toBe(true);
    expect(opensUp(700, 150, { top: 540, bottom: vh }, 12)).toBe(false);
  });
});
