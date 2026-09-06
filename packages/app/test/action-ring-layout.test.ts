import { describe, expect, it } from 'vitest';
import {
  ACTION_ARM_PX,
  ACTION_COMMANDS,
  ACTION_RING_UI_FACTOR,
  type ActionArm,
  type ActionCommand,
  type ActionCommandId,
  type ActionGroup,
  type ActionRingLayout,
  actionRingMenu,
  actionRingScale,
  BOTTOM_ARM,
  hitTestActionRing,
  layoutActionRing,
  type PlacedActionCommand,
  RIGHT_ARM,
  TOP_ARM,
} from '../src/hud/action-ring/index.js';
import { MIN_UI_SCALE } from '../src/hud/ui-scale.js';

/**
 * Headless tests for the settler action menu's pure geometry: the radial arm footprint and the hit-test
 * that turns a click into an order. The browser `?scene=sandbox` view is where a human judges the pixels.
 */

/** Non-null array access - throws (a test bug) rather than reaching for a forbidden `!`. */
function nth<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`no element at index ${i}`);
  return v;
}
const centre = (p: PlacedActionCommand): { x: number; y: number } => ({
  x: p.rect.x + p.rect.w / 2,
  y: p.rect.y + p.rect.h / 2,
});
function command(id: ActionCommandId): ActionCommand {
  const found = ACTION_COMMANDS.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no command ${id}`);
  return found;
}
/** A group of any three commands on `arm`; the geometry does not care which orders they are. */
const trio = (
  arm: ActionArm,
  ids: readonly [ActionCommandId, ActionCommandId, ActionCommandId],
): ActionGroup => ({
  arm,
  commands: ids.map(command),
});
const BOTTOM_TRIO = ['haveGirl', 'haveBoy', 'marry'] as const;
const TOP_TRIO = ['changeProfession', 'assignWorkArea', 'erectSignpost'] as const;
function placed(l: ActionRingLayout, id: ActionCommandId): PlacedActionCommand {
  const p = l.buttons.find((b) => b.command.id === id);
  if (p === undefined) throw new Error(`no button for ${id}`);
  return p;
}
const xOf = (l: ActionRingLayout, id: ActionCommandId): number => centre(placed(l, id)).x;
const yOf = (l: ActionRingLayout, id: ActionCommandId): number => centre(placed(l, id)).y;

describe('action-ring-layout - arm footprint', () => {
  it('places a bottom arm as a horizontal row centred under the settler, in drawn order', () => {
    const l = layoutActionRing([trio(BOTTOM_ARM, BOTTOM_TRIO)], 500, 400, 1, 2000, 2000);
    expect(l.buttons).toHaveLength(3);
    const centres = l.buttons.map(centre);
    // Middle button sits exactly on the arm: centre.x = settler.x, centre.y = settler.y + 100 (no nudge).
    expect(centre(nth(l.buttons, 1))).toEqual({ x: 500, y: 400 + ACTION_ARM_PX });
    // The row is centred on the settler (first/last average back to settler.x), stepped 32 px apart.
    expect((nth(centres, 0).x + nth(centres, 2).x) / 2).toBe(500);
    expect(nth(centres, 2).x - nth(centres, 1).x).toBe(32);
    // Drawn order: the first command is the left-most, the last the right-most.
    expect(nth(l.buttons, 0).command.id).toBe('haveGirl');
    expect(nth(centres, 0).x).toBeLessThan(nth(centres, 2).x);
    // First + last get the −5 corner nudge in y (bottom arm), the middle does not.
    expect(nth(centres, 0).y).toBe(400 + ACTION_ARM_PX - 5);
    expect(nth(centres, 1).y).toBe(400 + ACTION_ARM_PX);
  });

  it('places the top arm on the opposite side, so bottom and top rows never overlap', () => {
    const l = layoutActionRing(
      [trio(BOTTOM_ARM, BOTTOM_TRIO), trio(TOP_ARM, TOP_TRIO)],
      500,
      400,
      1,
      2000,
      2000,
    );
    for (const id of BOTTOM_TRIO) expect(yOf(l, id)).toBeGreaterThan(400);
    for (const id of TOP_TRIO) expect(yOf(l, id)).toBeLessThan(400);
  });

  it('scales the whole menu by the given scale (sub-1 values included - the ring runs shrunk)', () => {
    const group = trio(BOTTOM_ARM, BOTTOM_TRIO);
    const l1 = layoutActionRing([group], 500, 400, 1, 4000, 4000);
    const l2 = layoutActionRing([group], 500, 400, 2, 4000, 4000);
    const l075 = layoutActionRing([group], 500, 400, 0.75, 4000, 4000);
    // The middle button is 100 px below at 1×, 200 px below at 2×, 75 px below at 0.75× (arm scales).
    expect(centre(nth(l1.buttons, 1)).y - 400).toBe(ACTION_ARM_PX);
    expect(centre(nth(l2.buttons, 1)).y - 400).toBe(ACTION_ARM_PX * 2);
    expect(centre(nth(l075.buttons, 1)).y - 400).toBe(ACTION_ARM_PX * 0.75);
    // Button squares are 32 px at 1×, 64 px at 2×, 24 px at 0.75×.
    expect(nth(l1.buttons, 1).rect.w).toBe(32);
    expect(nth(l2.buttons, 1).rect.w).toBe(64);
    expect(nth(l075.buttons, 1).rect.w).toBe(24);
  });

  it('actionRingScale shrinks the shared uiscale by the ring factor after flooring it', () => {
    // At a 1.4× HUD scale the ring draws 25% smaller: 1.4 × 0.75 = 1.05.
    expect(actionRingScale(1.4)).toBeCloseTo(1.05);
    // The uiscale floor still applies BEFORE the shrink (too-small uiscale → the shrunk floor, not less).
    expect(actionRingScale(0.2)).toBeCloseTo(MIN_UI_SCALE * ACTION_RING_UI_FACTOR);
  });

  it('clamps the whole menu on-screen when it would spill past an edge', () => {
    // Settler near the top edge: the top arm would place buttons at negative y.
    const l = layoutActionRing(
      [trio(BOTTOM_ARM, BOTTOM_TRIO), trio(TOP_ARM, TOP_TRIO)],
      500,
      40,
      1,
      1000,
      800,
    );
    for (const p of l.buttons) expect(p.rect.y).toBeGreaterThanOrEqual(0);
    // The whole menu shifted as a rigid body - relative spacing is preserved (bottom row still 32 apart).
    expect(xOf(l, 'haveBoy') - xOf(l, 'haveGirl')).toBe(32);
  });
});

describe('action-ring-layout - hit-test (a click → the right order)', () => {
  const everything = actionRingMenu(new Set(ACTION_COMMANDS.map((c) => c.id)));

  it('returns the command under a click and null off the menu', () => {
    const l = layoutActionRing(everything, 500, 400, 1, 2000, 2000);
    const openP = l.buttons.find((p) => p.command.id === 'changeProfession');
    if (openP === undefined) throw new Error('missing change-profession button');
    expect(hitTestActionRing(l, centre(openP).x, centre(openP).y)?.id).toBe('changeProfession');
    // A button is hit-testable from its very corner pixel.
    const attackP = l.buttons.find((p) => p.command.id === 'attackPosition');
    if (attackP === undefined) throw new Error('missing attack-position button');
    expect(hitTestActionRing(l, attackP.rect.x + 1, attackP.rect.y + 1)?.id).toBe('attackPosition');
    // Dead centre (over the settler, between the arms) hits nothing.
    expect(hitTestActionRing(l, 500, 400)).toBeNull();
    // An empty menu has no hittable button.
    expect(hitTestActionRing(layoutActionRing([], 500, 400, 1, 2000, 2000), 500, 400)).toBeNull();
  });

  it('never overlaps two buttons of one arm, nor the two rows', () => {
    const l = layoutActionRing(everything, 500, 400, 1, 2000, 2000);
    const rows = l.buttons.filter((p) => p.command.arm === BOTTOM_ARM || p.command.arm === TOP_ARM);
    for (const a of rows) {
      for (const b of rows) {
        if (a === b) continue;
        const apart =
          a.rect.x + a.rect.w <= b.rect.x ||
          b.rect.x + b.rect.w <= a.rect.x ||
          a.rect.y + a.rect.h <= b.rect.y ||
          b.rect.y + b.rect.h <= a.rect.y;
        expect(apart, `${a.command.id} overlaps ${b.command.id}`).toBe(true);
      }
    }
  });

  it('lets a long row and a long column share a corner, where the later-drawn column wins the click', () => {
    // With every order drawn at the approximated offsets, the walk order ending the bottom row runs under
    // the lower buttons of the right column.
    const l = layoutActionRing(everything, 500, 400, 1, 2000, 2000);
    const walk = placed(l, 'goTo').rect;
    const under = l.buttons.filter(
      (p) =>
        p.command.arm === RIGHT_ARM &&
        p.rect.x < walk.x + walk.w &&
        walk.x < p.rect.x + p.rect.w &&
        p.rect.y < walk.y + walk.h &&
        walk.y < p.rect.y + p.rect.h,
    );
    expect(under.map((p) => p.command.id)).toEqual(['assignVehicle', 'removeHome']);
    const home = placed(l, 'removeHome').rect;
    const x = (Math.max(walk.x, home.x) + Math.min(walk.x + walk.w, home.x + home.w)) / 2;
    const y = (Math.max(walk.y, home.y) + Math.min(walk.y + walk.h, home.y + home.h)) / 2;
    expect(hitTestActionRing(l, x, y)?.id).toBe('removeHome');
  });
});
