import type { Entity, SimEvent } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { WorldMarks, type WorldMarksFrame } from '../src/gpu/world-renderer/world-marks.js';
import { cameraViewport, makeElevationField } from '../src/index.js';
import { entity, snapshotOf } from './support/fixtures.js';

/**
 * The marks group: which painter slot each layer's container lands in, and that every frame field still
 * reaches the layer it feeds. `mountPainterOrder` pins which slot draws over which; the risks left here
 * are a slot handed the wrong container (z-order kept, contents swapped) and a draw the group forgets to
 * make, neither of which any other test observes.
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
    drawn: { boundsOf: () => undefined, anchorOf: () => undefined },
    elevation: FLAT,
    viewport: VIEWPORT,
    renderTime: 0,
    damaged: [],
    selection: new Set(),
    flagged: new Set(),
    doorBadges: [],
    constructionSigns: [],
    settlerBubbles: [],
    livestockHearts: [],
    ...over,
  };
}

function marksIn(): WorldMarks {
  return new WorldMarks(new Container(), new TextureCache(), undefined);
}

describe('WorldMarks', () => {
  it('gives every painter slot a container of its own', () => {
    const marks = marksIn();
    const slots = Object.values(marks.slots);
    expect(new Set(slots).size).toBe(slots.length);
    marks.destroy();
  });

  it('routes bones to the ground slot and blood to the overlay slot', () => {
    const marks = marksIn();
    marks.ingest([died], 100);
    marks.draw(frameOf({ renderTime: 100 }));
    expect(marks.slots.bones.children).toHaveLength(1);
    expect(marks.slots.blood.children).toHaveLength(0);

    marks.ingest([hit], 101);
    marks.draw(frameOf({ renderTime: 101 }));
    expect(marks.slots.blood.children).toHaveLength(1);
    marks.destroy();
  });

  it('fades a mark on the interpolated render clock, not the integer tick it was ingested at', () => {
    const marks = marksIn();
    marks.ingest([hit], 0);
    marks.draw(frameOf({ renderTime: 30 }));
    const blood = marks.slots.blood.children[0];
    const atTick = blood?.alpha;
    expect(atTick).toBeLessThan(1); // past BLOOD_FADE_HOLD, so the fade is running

    // Half a tick later: only the interpolated clock can move a fade between two integer ticks.
    marks.draw(frameOf({ renderTime: 30.5 }));
    expect(blood?.alpha).toBeLessThan(atTick ?? 0);
    marks.destroy();
  });

  it('feeds each per-frame list to its own layer', () => {
    const marks = marksIn();
    marks.draw(
      frameOf({
        selection: new Set([SETTLER]),
        doorBadges: [{ id: 12, x: 0, y: 0, rows: [{ role: 'craftsman' }] }],
      }),
    );
    expect(marks.slots.selection.children).toHaveLength(1);
    // No decoded sign art in a headless test — the badge layer draws its placeholder squares.
    expect(marks.slots.doorBadges.children).toHaveLength(1);
    marks.destroy();
  });

  it('draws nothing for an empty frame and tears every slot down', () => {
    const marks = marksIn();
    marks.draw(frameOf());
    expect(Object.values(marks.slots).every((c) => c.children.length === 0)).toBe(true);
    marks.destroy();
    expect(Object.values(marks.slots).every((c) => c.destroyed)).toBe(true);
  });
});
