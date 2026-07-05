import { systems } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import { guiFrameIndex } from '../src/content/gui-atlas-map.js';
import {
  ACTION_ARM_PX,
  ACTION_ICON_FALLBACK,
  type ActionGroup,
  type PlacedActionButton,
  hitTestActionRing,
  jobIconFrame,
  layoutActionRing,
  pointOverActionRing,
  stanceIconFrame,
} from '../src/hud/action-ring-layout.js';

/**
 * Headless tests for the settler ACTION RING's pure logic — the radial geometry transcribed from the
 * original engine, the hit-test that turns a click into a command, and the (approximated) button→icon
 * assignment. The agent self-validates these; the browser `?scene=unit-orders` view is where a human judges
 * the pixels (round buttons in original art, sensible glyphs). See docs/SCENES.md + docs/FIDELITY.md.
 */

const { MILITARY_MODE } = systems;

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

/** The professions the unit-orders scene offers, as the controller builds them (job id + best-guess icon). */
const professions: ActionGroup = {
  group: 0,
  buttons: [
    { kind: 'job', jobType: 1, icon: jobIconFrame('woodcutter'), label: 'woodcutter' },
    { kind: 'job', jobType: 2, icon: jobIconFrame('carpenter'), label: 'carpenter' },
    { kind: 'job', jobType: 36, icon: jobIconFrame('carrier'), label: 'carrier' },
  ],
};
const stances: ActionGroup = {
  group: 1,
  buttons: [
    {
      kind: 'stance',
      mode: MILITARY_MODE.ATTACK,
      icon: stanceIconFrame(MILITARY_MODE.ATTACK),
      label: 'Atak',
    },
    {
      kind: 'stance',
      mode: MILITARY_MODE.FLEE,
      icon: stanceIconFrame(MILITARY_MODE.FLEE),
      label: 'Ucieczka',
    },
  ],
};

describe('action-ring-layout — geometry (transcribed from BuildHumanActionButtons)', () => {
  it('places the bottom arm (group 0) as a horizontal row centred under the settler', () => {
    const l = layoutActionRing([professions], 500, 400, 1, 1000, 800);
    expect(l.buttons).toHaveLength(3);
    const centres = l.buttons.map(centre);
    // Middle button sits exactly on the arm: centre.x = settler.x, centre.y = settler.y + 100 (no nudge).
    expect(centre(nth(l.buttons, 1))).toEqual({ x: 500, y: 400 + ACTION_ARM_PX });
    // The row is centred on the settler (first/last average back to settler.x), stepped 32 px apart.
    expect((nth(centres, 0).x + nth(centres, 2).x) / 2).toBe(500);
    expect(nth(centres, 2).x - nth(centres, 1).x).toBe(32);
    // First + last get the −5 corner nudge in y (bottom arm), the middle does not.
    expect(nth(centres, 0).y).toBe(400 + ACTION_ARM_PX - 5);
    expect(nth(centres, 1).y).toBe(400 + ACTION_ARM_PX);
  });

  it('places group 1 on the OPPOSITE (top) arm, so professions and stances never overlap', () => {
    const l = layoutActionRing([professions, stances], 500, 400, 1, 1000, 800);
    const jobY = l.buttons.filter((p) => p.button.kind === 'job').map((p) => centre(p).y);
    const stanceY = l.buttons.filter((p) => p.button.kind === 'stance').map((p) => centre(p).y);
    // Jobs sit below the settler (+100 arm), stances above (−100 arm).
    expect(Math.min(...jobY)).toBeGreaterThan(400);
    expect(Math.max(...stanceY)).toBeLessThan(400);
  });

  it('scales the whole ring by the uiscale', () => {
    const l1 = layoutActionRing([professions], 500, 400, 1, 2000, 2000);
    const l2 = layoutActionRing([professions], 500, 400, 2, 2000, 2000);
    // The middle button is 100 px below at 1×, 200 px below at 2× (arm distance scales).
    expect(centre(nth(l1.buttons, 1)).y - 400).toBe(ACTION_ARM_PX);
    expect(centre(nth(l2.buttons, 1)).y - 400).toBe(ACTION_ARM_PX * 2);
    // Button squares are 32 px at 1×, 64 px at 2×.
    expect(nth(l1.buttons, 1).rect.w).toBe(32);
    expect(nth(l2.buttons, 1).rect.w).toBe(64);
  });

  it('clamps the whole ring on-screen when it would spill past an edge', () => {
    // Settler near the top edge: the top (stance) arm would place buttons at negative y.
    const l = layoutActionRing([professions, stances], 500, 40, 1, 1000, 800);
    for (const p of l.buttons) expect(p.rect.y).toBeGreaterThanOrEqual(0);
    // The whole ring shifted as a rigid body — relative spacing is preserved (jobs still 32 apart).
    const c = l.buttons
      .filter((p) => p.button.kind === 'job')
      .map((p) => centre(p).x)
      .sort((a, b) => a - b);
    expect(nth(c, 1) - nth(c, 0)).toBe(32);
  });
});

describe('action-ring-layout — hit-test (a click → the right command)', () => {
  it('returns the ActionButton under a click and null off the ring', () => {
    const l = layoutActionRing([professions, stances], 500, 400, 1, 1000, 800);
    // Click the carpenter button (job typeId 2) at its centre → a setJob(2) the controller issues.
    const carp = l.buttons.find((p) => p.button.kind === 'job' && p.button.jobType === 2);
    if (carp === undefined) throw new Error('missing carpenter button');
    const hit = hitTestActionRing(l, centre(carp).x, centre(carp).y);
    expect(hit).toEqual({ kind: 'job', jobType: 2, icon: jobIconFrame('carpenter'), label: 'carpenter' });
    // Click a stance button → a setStance the controller issues.
    const flee = l.buttons.find((p) => p.button.kind === 'stance' && p.button.mode === MILITARY_MODE.FLEE);
    if (flee === undefined) throw new Error('missing flee button');
    const s = hitTestActionRing(l, flee.rect.x + 1, flee.rect.y + 1);
    expect(s?.kind).toBe('stance');
    expect(s?.kind === 'stance' && s.mode).toBe(MILITARY_MODE.FLEE);
    // Dead centre (over the settler, between the arms) hits nothing.
    expect(hitTestActionRing(l, 500, 400)).toBeNull();
  });

  it('claims a point inside the ring bounds and only there', () => {
    const l = layoutActionRing([professions], 500, 400, 1, 1000, 800);
    const b = l.bounds;
    expect(pointOverActionRing(l, b.x + 1, b.y + 1)).toBe(true);
    expect(pointOverActionRing(l, b.x - 10, b.y - 10)).toBe(false);
    // An empty ring claims nothing.
    expect(pointOverActionRing(layoutActionRing([], 500, 400, 1, 1000, 800), 500, 400)).toBe(false);
  });
});

describe('action-ring-layout — icon assignment (approximated, but every name must resolve)', () => {
  it('maps known professions to their glyph and unknown ones to the code-pinned fallback', () => {
    expect(jobIconFrame('miner')).toBe('order_mine');
    expect(jobIconFrame('carrier')).toBe('order_transport');
    expect(jobIconFrame('soldier_sword_long')).toBe('order_soldier_1'); // stem fallback
    expect(jobIconFrame('some_future_job')).toBe(ACTION_ICON_FALLBACK);
  });

  it('maps stances to a glyph and an unknown mode to the fallback', () => {
    expect(stanceIconFrame(MILITARY_MODE.ATTACK)).toBe('order_soldier_1');
    expect(stanceIconFrame(999)).toBe(ACTION_ICON_FALLBACK);
  });

  it('every icon the maps can return is a real GUI-atlas frame (a typo would throw here)', () => {
    const names = [
      jobIconFrame('woodcutter'),
      jobIconFrame('carpenter'),
      jobIconFrame('carrier'),
      jobIconFrame('miner'),
      jobIconFrame('stonemason'),
      jobIconFrame('smith'),
      jobIconFrame('scout'),
      jobIconFrame('soldier_sword_long'),
      jobIconFrame('work_bakery_00'),
      jobIconFrame('unmapped'),
      stanceIconFrame(MILITARY_MODE.ATTACK),
      stanceIconFrame(MILITARY_MODE.DEFEND),
      stanceIconFrame(MILITARY_MODE.IGNORE),
      stanceIconFrame(MILITARY_MODE.FLEE),
    ];
    for (const name of names) expect(() => guiFrameIndex(name)).not.toThrow();
  });
});
