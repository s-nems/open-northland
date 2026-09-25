import { FOG_MODE, FOG_STATE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ONE } from '../src/data/projection/index.js';
import { WorldFog } from '../src/gpu/world-renderer/world-fog.js';
import { entity, fogViewOf, snapshotOf } from './support/fixtures.js';

const VIEWPORT = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
// Both fixtures sit on even rows, where the stagger is 0 and cell (cx, cy) = (⌊tileX⌋, tileY).
const HOUSE = entity(1, 5, 4, { Building: { buildingType: 7, tribe: 1, built: ONE, level: 0 } });
const TREE = entity(2, 9, 4, { Resource: { goodType: 3 } });
const HOUSE_CELL = '5,4';
const TREE_CELL = '9,4';
const WORLD = snapshotOf([HOUSE, TREE]);

const watching = (cell: string, generation: number) =>
  fogViewOf(new Map([[cell, FOG_STATE.VISIBLE]]), generation);
const explored = (cell: string, generation: number) =>
  fogViewOf(new Map([[cell, FOG_STATE.EXPLORED]]), generation);

describe('WorldFog', () => {
  it('omits the fog cull and gates nothing while the view is off', () => {
    const fog = new WorldFog();
    const frame = fog.update(WORLD, VIEWPORT);
    expect(frame.fogVisible).toBeUndefined();
    expect(frame.ghosts).toBeUndefined();
    expect(fog.cellStateAt).toBeUndefined();
  });

  it('gates the tall map objects on the same view the wash composited', () => {
    const fog = new WorldFog();
    const view = watching(HOUSE_CELL, 1);
    fog.setView(view);
    fog.update(WORLD, VIEWPORT);
    expect(fog.cellStateAt).toBe(view.stateAt);
  });

  it('passes the statically-drawn refs through with or without a view', () => {
    const fog = new WorldFog();
    const refs = new Set([TREE.id]);
    fog.setStaticallyDrawnRefs(refs);
    expect(fog.update(WORLD, VIEWPORT).staticRefs).toBe(refs);
    fog.setView(watching(HOUSE_CELL, 1));
    expect(fog.update(WORLD, VIEWPORT).staticRefs).toBe(refs);
  });

  it('culls by the view the frame was drawn with, not the one the predicate was built with', () => {
    const fog = new WorldFog();
    fog.setView(watching(HOUSE_CELL, 1));
    const first = fog.update(WORLD, VIEWPORT).fogVisible;
    expect(first?.(5, 4)).toBe(true);
    expect(first?.(9, 4)).toBe(false);
    // The tree's cell is watched instead: the next frame's cull answers from the new view.
    fog.setView(watching(TREE_CELL, 2));
    const second = fog.update(WORLD, VIEWPORT).fogVisible;
    expect(second?.(5, 4)).toBe(false);
    expect(second?.(9, 4)).toBe(true);
  });

  it('emits a remembered static once its cell regresses to EXPLORED, and forgets it when fog goes off', () => {
    const fog = new WorldFog();
    fog.setView(watching(HOUSE_CELL, 1));
    expect(fog.update(WORLD, VIEWPORT).ghosts).toBeUndefined(); // watched: the live entity draws
    fog.setView(explored(HOUSE_CELL, 2));
    expect(fog.update(WORLD, VIEWPORT).ghosts).toMatchObject([{ ref: HOUSE.id, kind: 'building' }]);
    fog.setView(null);
    expect(fog.update(WORLD, VIEWPORT).ghosts).toBeUndefined();
    // Memory really cleared, not just withheld: the same explored view starts over with nothing seen.
    fog.setView(explored(HOUSE_CELL, 2));
    expect(fog.update(WORLD, VIEWPORT).ghosts).toBeUndefined();
  });

  it('remembers an adopted ref that was never seen, the static-layer handover', () => {
    const fog = new WorldFog();
    fog.setStaticallyDrawnRefs(new Set([TREE.id]));
    fog.setView(explored(TREE_CELL, 1));
    // Still drawn by the retained static layer: it is its own ghost, so the store skips it.
    expect(fog.update(WORLD, VIEWPORT).ghosts).toBeUndefined();
    fog.setStaticallyDrawnRefs(new Set());
    fog.adoptGhost(TREE.id);
    expect(fog.update(WORLD, VIEWPORT).ghosts).toMatchObject([{ ref: TREE.id, kind: 'resource' }]);
  });

  it('holds the fog epoch on a steady mask and bumps it on a generation or mode change', () => {
    const fog = new WorldFog();
    expect(fog.update(WORLD, VIEWPORT).fogEpoch).toBeUndefined(); // fog off: no cull, no key
    fog.setView(watching(HOUSE_CELL, 1));
    const first = fog.update(WORLD, VIEWPORT).fogEpoch;
    expect(first).toBeDefined();
    fog.setView(watching(HOUSE_CELL, 1));
    expect(fog.update(WORLD, VIEWPORT).fogEpoch).toBe(first);
    fog.setView(watching(HOUSE_CELL, 2));
    const rebuilt = fog.update(WORLD, VIEWPORT).fogEpoch;
    expect(rebuilt).not.toBe(first);
    // A RECON map remaps what stateAt answers without a mask rebuild, so the epoch must move too.
    fog.setView(fogViewOf(new Map([[HOUSE_CELL, FOG_STATE.VISIBLE]]), 2, FOG_MODE.RECON_FOG_OF_WAR));
    expect(fog.update(WORLD, VIEWPORT).fogEpoch).not.toBe(rebuilt);
  });

  it('bumps the epoch and starts the memory over when the viewer switches seat under one mask', () => {
    const fog = new WorldFog();
    fog.setView(explored(HOUSE_CELL, 1));
    fog.update(WORLD, VIEWPORT);
    fog.setView(watching(HOUSE_CELL, 2));
    const seen = fog.update(WORLD, VIEWPORT);
    fog.setView(explored(HOUSE_CELL, 3));
    const remembered = fog.update(WORLD, VIEWPORT);
    expect(remembered.ghosts).toMatchObject([{ ref: HOUSE.id }]);
    // The other seat never saw the house: same generation and mode, a different perspective.
    fog.setView({ ...explored(HOUSE_CELL, 3), player: 1 });
    const switched = fog.update(WORLD, VIEWPORT);
    expect(switched.fogEpoch).not.toBe(remembered.fogEpoch);
    expect(switched.fogEpoch).not.toBe(seen.fogEpoch);
    expect(switched.ghosts).toBeUndefined();
  });

  it('reads the mask once per generation, not once per frame', () => {
    const fog = new WorldFog();
    const base = watching(HOUSE_CELL, 1);
    let reads = 0;
    fog.setView({
      ...base,
      stateAt: (cx, cy) => {
        reads++;
        return base.stateAt(cx, cy);
      },
    });
    fog.update(WORLD, VIEWPORT);
    expect(reads).toBeGreaterThan(0); // the wash rasterized its band and the store captured
    reads = 0;
    fog.update(WORLD, VIEWPORT); // same generation, same viewport: both passes skip
    expect(reads).toBe(0);
  });
});
