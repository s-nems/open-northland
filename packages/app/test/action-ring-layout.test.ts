import { describe, expect, it } from 'vitest';
import { guiFrameIndex } from '../src/content/gui-atlas-map.js';
import {
  ACTION_ARM_PX,
  type ActionButton,
  type ActionGroup,
  BOTTOM_ARM,
  HUMAN_DEFAULT_MENU,
  type PlacedActionButton,
  TOP_ARM,
  hitTestActionRing,
  layoutActionRing,
} from '../src/hud/action-ring-layout.js';

/**
 * Headless tests for the settler ACTION MENU's pure logic — the radial arm footprint transcribed from the
 * original engine, the hit-test that turns a click into a command, and the (approximated) button→icon
 * assignment. The agent self-validates these; the browser `?scene=unit-orders` view is where a human judges
 * the pixels (round buttons in original art, sensible glyphs) + the profession list window. See docs/SCENES.md.
 */

/** Non-null array access — throws (a test bug) rather than reaching for a forbidden `!`. */
function nth<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`no element at index ${i}`);
  return v;
}
const centre = (p: PlacedActionButton): { x: number; y: number } => ({
  x: p.rect.x + p.rect.w / 2,
  y: p.rect.y + p.rect.h / 2,
});
/** An inert placeholder button (the default menu is mostly these). */
const ph = (id: string): ActionButton => ({ kind: 'placeholder', id, icon: 'order_build', label: id });

describe('action-ring-layout — arm footprint (transcribed from BuildHumanActionButtons)', () => {
  it('places a group as a horizontal row centred under the settler (bottom arm), in reading order', () => {
    const group: ActionGroup = { group: BOTTOM_ARM, buttons: [ph('a'), ph('b'), ph('c')] };
    const l = layoutActionRing([group], 500, 400, 1, 2000, 2000);
    expect(l.buttons).toHaveLength(3);
    const centres = l.buttons.map(centre);
    // Middle button sits exactly on the arm: centre.x = settler.x, centre.y = settler.y + 100 (no nudge).
    expect(centre(nth(l.buttons, 1))).toEqual({ x: 500, y: 400 + ACTION_ARM_PX });
    // The row is centred on the settler (first/last average back to settler.x), stepped 32 px apart.
    expect((nth(centres, 0).x + nth(centres, 2).x) / 2).toBe(500);
    expect(nth(centres, 2).x - nth(centres, 1).x).toBe(32);
    // Reading order: button 'a' is the left-most, 'c' the right-most.
    expect(nth(l.buttons, 0).button).toEqual(ph('a'));
    expect(nth(centres, 0).x).toBeLessThan(nth(centres, 2).x);
    // First + last get the −5 corner nudge in y (bottom arm), the middle does not.
    expect(nth(centres, 0).y).toBe(400 + ACTION_ARM_PX - 5);
    expect(nth(centres, 1).y).toBe(400 + ACTION_ARM_PX);
  });

  it('places the top arm on the OPPOSITE side, so bottom and top rows never overlap', () => {
    const bottom: ActionGroup = { group: BOTTOM_ARM, buttons: [ph('a'), ph('b')] };
    const top: ActionGroup = { group: TOP_ARM, buttons: [ph('c'), ph('d')] };
    const l = layoutActionRing([bottom, top], 500, 400, 1, 2000, 2000);
    const yOf = (id: string): number =>
      centre(
        nth(
          l.buttons.filter((p) => p.button.kind === 'placeholder' && p.button.id === id),
          0,
        ),
      ).y;
    expect(Math.min(yOf('a'), yOf('b'))).toBeGreaterThan(400); // bottom
    expect(Math.max(yOf('c'), yOf('d'))).toBeLessThan(400); // top
  });

  it('scales the whole menu by the uiscale', () => {
    const group: ActionGroup = { group: BOTTOM_ARM, buttons: [ph('a'), ph('b'), ph('c')] };
    const l1 = layoutActionRing([group], 500, 400, 1, 4000, 4000);
    const l2 = layoutActionRing([group], 500, 400, 2, 4000, 4000);
    // The middle button is 100 px below at 1×, 200 px below at 2× (arm distance scales).
    expect(centre(nth(l1.buttons, 1)).y - 400).toBe(ACTION_ARM_PX);
    expect(centre(nth(l2.buttons, 1)).y - 400).toBe(ACTION_ARM_PX * 2);
    // Button squares are 32 px at 1×, 64 px at 2×.
    expect(nth(l1.buttons, 1).rect.w).toBe(32);
    expect(nth(l2.buttons, 1).rect.w).toBe(64);
  });

  it('clamps the whole menu on-screen when it would spill past an edge', () => {
    // Settler near the top edge: the top arm would place buttons at negative y.
    const bottom: ActionGroup = { group: BOTTOM_ARM, buttons: [ph('a'), ph('b'), ph('c')] };
    const top: ActionGroup = { group: TOP_ARM, buttons: [ph('d'), ph('e'), ph('f')] };
    const l = layoutActionRing([bottom, top], 500, 40, 1, 1000, 800);
    for (const p of l.buttons) expect(p.rect.y).toBeGreaterThanOrEqual(0);
    // The whole menu shifted as a rigid body — relative spacing is preserved (bottom row still 32 apart).
    const c = l.buttons
      .filter((p) => p.button.kind === 'placeholder' && ['a', 'b', 'c'].includes(p.button.id))
      .map((p) => centre(p).x)
      .sort((a, b) => a - b);
    expect(nth(c, 1) - nth(c, 0)).toBe(32);
  });
});

describe('action-ring-layout — hit-test (a click → the right behaviour)', () => {
  it('returns the button under a click and null off the menu', () => {
    const l = layoutActionRing(HUMAN_DEFAULT_MENU, 500, 400, 1, 2000, 2000);
    // The "change profession" button (open-jobs) is present and hit-testable.
    const openP = l.buttons.find((p) => p.button.kind === 'open-jobs');
    if (openP === undefined) throw new Error('missing open-jobs button');
    expect(hitTestActionRing(l, centre(openP).x, centre(openP).y)?.kind).toBe('open-jobs');
    // A default-menu placeholder hit returns that inert button (its id is preserved).
    const attackP = l.buttons.find((p) => p.button.kind === 'placeholder' && p.button.id === 'attack');
    if (attackP === undefined) throw new Error('missing attack placeholder');
    const hit = hitTestActionRing(l, attackP.rect.x + 1, attackP.rect.y + 1);
    expect(hit?.kind).toBe('placeholder');
    expect(hit?.kind === 'placeholder' && hit.id).toBe('attack');
    // Dead centre (over the settler, between the arms) hits nothing.
    expect(hitTestActionRing(l, 500, 400)).toBeNull();
    // An empty menu has no hittable button.
    expect(hitTestActionRing(layoutActionRing([], 500, 400, 1, 2000, 2000), 500, 400)).toBeNull();
  });
});

describe('action-ring-layout — icon assignment (approximated, but every name must resolve)', () => {
  it('every icon the default menu draws is a real GUI-atlas frame (a typo would throw here)', () => {
    for (const g of HUMAN_DEFAULT_MENU) {
      for (const b of g.buttons) expect(() => guiFrameIndex(b.icon)).not.toThrow();
    }
  });

  it('has exactly one live "change profession" button in the default menu', () => {
    const open = HUMAN_DEFAULT_MENU.flatMap((g) => g.buttons).filter((b) => b.kind === 'open-jobs');
    expect(open).toHaveLength(1);
  });
});
