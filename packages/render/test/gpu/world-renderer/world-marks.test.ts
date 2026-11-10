import type { Entity, SimEvent } from '@open-northland/sim';
import { Container, Mesh, TextureSource, UniformGroup } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { OVERHEAD_STEP } from '../../../src/data/scene/overhead-column.js';
import type { AtlasFrame } from '../../../src/data/sprites/index.js';
import { NO_WATER } from '../../../src/data/terrain/index.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { WorldMarks, type WorldMarksFrame } from '../../../src/gpu/world-renderer/world-marks.js';
import { cameraViewport, makeElevationField, ONE } from '../../../src/index.js';
import { entity, snapshotOf } from '../../support/fixtures.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

/**
 * `mountPainterOrder` owns which slot draws over which. What is left here is a slot handed the wrong
 * container, and a draw the group forgets to make.
 */

const VIEWPORT = cameraViewport({ offsetX: 0, offsetY: 0 }, 800, 600, 0);
const FLAT = makeElevationField(undefined, 0, 0);
const SETTLER = 7;

const BONES = 4;
const hit: SimEvent = {
  kind: 'combatHit',
  damage: 250,
  targetMaxHealth: 1000,
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
    ships: [],
    walkers: [],
    roadAt: () => false,
    water: NO_WATER,
    selectionStyle: 'ring-white',
    selection: new Set(),
    flagged: new Set(),
    focused: new Set(),
    rangeRings: [],
    orderMarkers: [],
    mapPings: [],
    lostGoals: [],
    lostGoalPulse: 0,
    doorBadges: [],
    constructionSigns: [],
    settlerBubbles: [],
    lifeHearts: [],
    experienceStars: [],
    groupNumbers: new Map(),
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
    const bones = { id: BONES, components: { BonePile: { hx: 8, hy: 10, tick: 100 } } };
    marks.draw(frameOf({ snapshot: snapshotOf([bones]), renderTime: 100 }));
    expect(marks.slots.bones.children).toHaveLength(1);
    expect(marks.slots.bloodGround.children).toHaveLength(0);

    marks.ingest([hit], 101);
    marks.draw(frameOf({ renderTime: 101 }));
    expect(marks.slots.bloodGround.children).toHaveLength(1);
    expect(sprites.children).toHaveLength(1);
    marks.destroy();
  });

  it('feeds the interpolated render clock to GPU fading, including clock wrapping', () => {
    const { marks } = marksIn();
    marks.ingest([hit], 0);
    marks.draw(frameOf({ renderTime: 1000 }));
    const blood = marks.slots.bloodGround.children[0];
    if (!(blood instanceof Mesh)) throw new Error('missing blood mesh');
    const clock = blood.shader?.resources.bloodTime;
    if (!(clock instanceof UniformGroup)) throw new Error('missing blood clock');
    expect(clock.uniforms.uTime).toBe(1000);

    // Only the interpolated clock can move a fade between two integer ticks.
    marks.draw(frameOf({ renderTime: 1000.5 }));
    expect(clock.uniforms.uTime).toBe(1000.5);
    marks.ingest([hit], 4100);
    marks.draw(frameOf({ renderTime: 4100.5 }));
    expect(clock.uniforms.uTime).toBe(4.5);
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

  it('lifts an icon only by the icons under it whose art loaded', () => {
    const { marks } = marksIn();
    const bob: AtlasFrame = { x: 0, y: 0, width: 9, height: 9, offsetX: -4, offsetY: -8 };
    const source = new TextureSource({ width: 9, height: 9 });
    const at = { id: SETTLER, x: 3 * ONE, y: 4 * ONE };
    const frame = frameOf({
      lifeHearts: [{ ...at, colour: 0xff0000, life: 1 }],
      experienceStars: [{ ...at, weaponTier: 1, jobTier: 0 }],
    });
    const heartY = (): number => marks.slots.hearts.children[0]?.y ?? Number.NaN;
    marks.draw(frame);
    const besideUndrawnStar = heartY();
    marks.setExperienceStarGfx({ source, frameByTier: [bob] });
    marks.draw(frame);
    expect(besideUndrawnStar - heartY()).toBe(OVERHEAD_STEP.weaponStar);
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

useHeadlessShaderContext();
