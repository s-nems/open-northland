import type { GfxInHouseProgram } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { inHousePose } from '../../src/data/scene/in-house.js';
import { collectSpriteScene } from '../../src/data/scene/index.js';
import { ONE, tileToScreen } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * The indoor craft choreography: the `gfxanimmode 2` program's own reading (which walk or clip is live
 * at a moment, and where in the room it puts the worker), and the scene branch that draws a worker its
 * content choreographs instead of leaving it hidden in the house.
 */

const VIKING = 1;
const BAKER = 20;
const MAKE_BREAD = 47;
const FLOUR = 11;
const BREAD = 19;

/** The viking baker's program, trimmed to the shape that matters here: a seed point, one walk in with
 *  flour, the knead sub-clip, and one walk out with bread. */
const BAKER_PROGRAM: GfxInHouseProgram = {
  tribe: VIKING,
  job: BAKER,
  action: MAKE_BREAD,
  entries: [
    { kind: 'walk', dir: 3, goodType: FLOUR, x: 75, y: 29, from: 0, to: 0 },
    { kind: 'walk', dir: 2, goodType: FLOUR, x: 15, y: 45, from: 0, to: 20 },
    { kind: 'clip', action: MAKE_BREAD, subId: 1, dir: 5, from: 20, to: 60 },
    { kind: 'walk', dir: 0, goodType: BREAD, x: 75, y: 29, from: 60, to: 100 },
  ],
};

describe('inHousePose', () => {
  it('starts the worker at the seeding point rather than at the first walk’s destination', () => {
    // The zero-length `0 0` window never plays; it only says where the walk after it starts from.
    expect(inHousePose(BAKER_PROGRAM, 0, 100)).toMatchObject({ state: 'moving', dx: 75, dy: 29 });
  });

  it('interpolates a walk across its own window', () => {
    const half = inHousePose(BAKER_PROGRAM, 10, 100); // halfway through the 0..20 window
    expect(half).toMatchObject({ state: 'moving', dx: 45, dy: 37, goodType: FLOUR, dir: 2 });
  });

  it('plays the sub-clip where the last walk left the worker, progressing across the window', () => {
    expect(inHousePose(BAKER_PROGRAM, 30, 100)).toEqual({
      state: 'acting',
      dir: 5,
      dx: 15,
      dy: 45,
      goodType: 0,
      clip: { action: MAKE_BREAD, subId: 1, progress: 0.25 },
    });
  });

  it('carries the outgoing good on the way back out', () => {
    expect(inHousePose(BAKER_PROGRAM, 80, 100)).toMatchObject({ goodType: BREAD, state: 'moving' });
  });

  it('stands where the last walk ended once every window has passed', () => {
    // The final tick of a performance: the worker is back at the door it leaves through, not nowhere.
    expect(inHousePose(BAKER_PROGRAM, 100, 100)).toMatchObject({ state: 'idle', dx: 75, dy: 29 });
  });

  it('reads a zero-length performance as its opening moment instead of dividing by zero', () => {
    expect(inHousePose(BAKER_PROGRAM, 0, 0)).toMatchObject({ state: 'moving', dx: 75, dy: 29 });
  });
});

/** A baker mid-batch inside the bakery at tile (4, 4), the shape the sim leaves behind. */
function bakingSnapshot(elapsed = 30, duration = 100) {
  const bakery = entity(10, 4, 4, { Building: { buildingType: 1, tribe: VIKING, built: ONE, level: 0 } });
  const baker = entity(1, 6, 6, {
    Settler: { tribe: VIKING, jobType: BAKER },
    Resting: { at: 10 },
    CurrentAtomic: {
      atomicId: MAKE_BREAD,
      elapsed,
      duration,
      effect: { kind: 'produce', recipeOutput: BREAD },
      targetEntity: 10,
    },
  });
  return snapshotOf([bakery, baker]);
}

const lookup = (tribe: number, job: number, action: number): GfxInHouseProgram | undefined =>
  tribe === VIKING && job === BAKER && action === MAKE_BREAD ? BAKER_PROGRAM : undefined;

describe('a choreographed worker in the sprite scene', () => {
  it('draws the worker against its workplace’s anchor, offset by the program', () => {
    const scene = collectSpriteScene(bakingSnapshot(), { inHousePrograms: lookup });
    const drawn = scene.items.find((i) => i.kind === 'settler');
    const house = tileToScreen(4, 4);
    // Anchored on the bakery, not on the doorstep the sim left it standing on.
    expect(drawn).toMatchObject({ x: house.x + 15, y: house.y + 45, inHouse: true, state: 'acting' });
    expect(drawn?.craftClip).toEqual({ action: MAKE_BREAD, subId: 1, progress: 0.25 });
    expect(drawn?.frozen).toBeUndefined();
  });

  it('hauls the program’s good rather than whatever the settler physically carries', () => {
    const scene = collectSpriteScene(bakingSnapshot(80), { inHousePrograms: lookup });
    const drawn = scene.items.find((i) => i.kind === 'settler');
    expect(drawn).toMatchObject({ state: 'moving', carrying: true, carryGood: BREAD });
    expect(drawn?.craftClip).toBeUndefined();
  });

  it('keeps the selected worker at his craft instead of soloing him into the portrait', () => {
    const scene = collectSpriteScene(bakingSnapshot(), { inHousePrograms: lookup, portraitRef: 1 });
    const drawn = scene.items.find((i) => i.kind === 'settler');
    // Without this the portrait subject skips the craft branch and is force-hidden on the map, so
    // selecting a craftsman empties his workshop while his co-workers keep working.
    expect(drawn).toMatchObject({ inHouse: true, state: 'acting' });
    expect(drawn?.portraitOnly).toBeUndefined();
  });

  it('still solos an indoor subject whose craft nothing choreographs', () => {
    const scene = collectSpriteScene(bakingSnapshot(), { portraitRef: 1 });
    expect(scene.items.find((i) => i.kind === 'settler')?.portraitOnly).toBe(true);
  });

  it('solos a choreographed subject the camera or the fog would have dropped', () => {
    // Being choreographed excuses the indoor hiding only; a subject forced past the culls for the
    // portrait's sake must not paint on the map the culls just kept it off.
    const offscreen = collectSpriteScene(bakingSnapshot(), {
      inHousePrograms: lookup,
      portraitRef: 1,
      viewport: { minX: 10_000, minY: 10_000, maxX: 10_100, maxY: 10_100 },
    });
    expect(offscreen.items.find((i) => i.kind === 'settler')?.portraitOnly).toBe(true);
    const fogged = collectSpriteScene(bakingSnapshot(), {
      inHousePrograms: lookup,
      portraitRef: 1,
      fogVisible: () => false,
    });
    expect(fogged.items.find((i) => i.kind === 'settler')?.portraitOnly).toBe(true);
  });

  it('keeps an unchoreographed craft out of sight, as it is without the programs at all', () => {
    const none = collectSpriteScene(bakingSnapshot(), {});
    expect(none.items.some((i) => i.kind === 'settler')).toBe(false);
    const otherTrade = collectSpriteScene(bakingSnapshot(), {
      inHousePrograms: () => undefined,
    });
    expect(otherTrade.items.some((i) => i.kind === 'settler')).toBe(false);
    // Still pooled either way - it is hidden, not gone.
    expect(none.liveRefs.has(1)).toBe(true);
  });
});
