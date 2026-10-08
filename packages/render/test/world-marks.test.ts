import type { Entity, SimEvent } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { NO_WATER } from '../src/data/terrain/index.js';
import { CALM_WIND_SWAY } from '../src/data/weather/climate.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { WorldMarks, type WorldMarksFrame } from '../src/gpu/world-renderer/world-marks.js';
import { cameraViewport, makeElevationField } from '../src/index.js';
import { entity, snapshotOf } from './support/fixtures.js';

/**
 * `mountPainterOrder` owns which slot draws over which. What is left here is a slot handed the wrong
 * container, and a draw the group forgets to make.
 */

const VIEWPORT = cameraViewport({ offsetX: 0, offsetY: 0 }, 800, 600, 0);
const FLAT = makeElevationField(undefined, 0, 0);
const SETTLER = 7;

const died: SimEvent = {
  kind: 'settlerDied',
  entity: 4 as Entity,
  cause: 'damage',
  player: 0,
  at: { hx: 8, hy: 10 },
};
const hit: SimEvent = {
  kind: 'combatHit',
  attacker: 1 as Entity,
  target: 2 as Entity,
  at: { hx: 4, hy: 6 },
};

function frameOf(over: Partial<WorldMarksFrame> = {}): WorldMarksFrame {
  return {
    snapshot: snapshotOf([entity(SETTLER, 3, 4, { Settler: {} })]),
    zoom: 1,
    drawn: { boundsOf: () => undefined, anchorOf: () => undefined },
    elevation: FLAT,
    viewport: VIEWPORT,
    renderTime: 0,
    damaged: [],
    ships: [],
    water: NO_WATER,
    selectionStyle: 'ring-white',
    selection: new Set(),
    flagged: new Set(),
    focused: new Set(),
    rangeRings: [],
    orderMarkers: [],
    lostGoals: [],
    lostGoalPulse: 0,
    doorBadges: [],
    constructionSigns: [],
    settlerBubbles: [],
    lifeHearts: [],
    groupNumbers: new Map(),
    wind: CALM_WIND_SWAY,
    ...over,
  };
}

/** `sprites` stands in for the renderer's depth-sorted sprite layer, where the marks that must occlude
 *  like sprites draw instead of into a slot. */
function marksIn(): { marks: WorldMarks; sprites: Container } {
  const sprites = new Container();
  return { marks: new WorldMarks(sprites, new TextureCache(), undefined), sprites };
}

describe('WorldMarks', () => {
  it('gives every painter slot a container of its own', () => {
    const { marks } = marksIn();
    const slots = Object.values(marks.slots);
    expect(new Set(slots).size).toBe(slots.length);
    marks.destroy();
  });

  it('routes bones and stains to the ground and airborne blood to the sorted sprites', () => {
    const { marks, sprites } = marksIn();
    marks.ingest([died], 100);
    marks.draw(frameOf({ renderTime: 100 }));
    expect(marks.slots.bones.children).toHaveLength(1);
    expect(marks.slots.bloodGround.children).toHaveLength(0);

    marks.ingest([hit], 101);
    marks.draw(frameOf({ renderTime: 101 }));
    expect(marks.slots.bloodGround.children).toHaveLength(1);
    expect(sprites.children).toHaveLength(1);
    marks.destroy();
  });

  it('fades a mark on the interpolated render clock, not the integer tick it was ingested at', () => {
    const { marks } = marksIn();
    marks.ingest([hit], 0);
    marks.draw(frameOf({ renderTime: 600 }));
    const blood = marks.slots.bloodGround.children[0];
    const atTick = blood?.alpha;
    expect(atTick).toBeLessThan(1); // the ground stain is fading

    // Only the interpolated clock can move a fade between two integer ticks.
    marks.draw(frameOf({ renderTime: 600.5 }));
    expect(blood?.alpha).toBeLessThan(atTick ?? 0);
    marks.destroy();
  });

  it('feeds each per-frame list to its own layer', () => {
    const { marks, sprites } = marksIn();
    marks.draw(
      frameOf({
        selection: new Set([SETTLER]),
        doorBadges: [{ id: 12, x: 0, y: 0, rows: [{ role: 'craftsman' }] }],
        groupNumbers: new Map([[SETTLER, ['1']]]),
        drawn: {
          boundsOf: () => undefined,
          anchorOf: (id) => (id === SETTLER ? { x: 20, y: 40 } : undefined),
        },
      }),
    );
    expect(marks.slots.selection.children).toHaveLength(1);
    expect(marks.slots.groupNumbers.children).toHaveLength(1);
    // Without decoded sign art the badge layer draws placeholder squares, into the depth-sorted sprite
    // layer rather than a slot of its own.
    expect(sprites.children).toHaveLength(1);
    marks.destroy();
  });

  it('draws nothing for an empty frame and tears every slot down', () => {
    const { marks } = marksIn();
    marks.draw(frameOf());
    expect(Object.values(marks.slots).every((c) => c.children.length === 0)).toBe(true);
    marks.destroy();
    expect(Object.values(marks.slots).every((c) => c.destroyed)).toBe(true);
  });
});
