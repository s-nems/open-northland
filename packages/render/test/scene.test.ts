import type { WorldSnapshot } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import { ONE, type SceneTerrain, buildScene, terrainMapToScene, tileToScreen } from '../src/index.js';

/**
 * Unit tests for the pure scene layer — the part of rendering an agent can self-verify (the pixels
 * are deferred to a human). They pin the two correctness properties a human eyeball would otherwise
 * have to catch: terrain always behind sprites, and sprites depth-sorted by feet anchor.
 *
 * A `WorldSnapshot` is plain data (no class instances / live Maps), so we hand-build one here rather
 * than spinning up a Simulation — this stays a render-package unit, not an integration test.
 */

/** Hand-build a snapshot entity with a Position (Fixed = whole tiles) + a marker component. */
function entity(
  id: number,
  tileX: number,
  tileY: number,
  marker: Record<string, unknown>,
): {
  id: number;
  components: Readonly<Record<string, unknown>>;
} {
  return {
    id,
    components: { Position: { x: tileX * ONE, y: tileY * ONE }, ...marker },
  };
}

function snapshotOf(entities: WorldSnapshot['entities']): WorldSnapshot {
  return { tick: 1, entities, events: [] };
}

const FLAT_3x2: SceneTerrain = { width: 3, height: 2, typeIds: [1, 1, 2, 2, 1, 1] };

describe('buildScene', () => {
  it('emits one tile per cell, in row-major order, carrying its landscape typeId', () => {
    const scene = buildScene(snapshotOf([]), FLAT_3x2);
    const tiles = scene.filter((d) => d.kind === 'tile');
    expect(tiles).toHaveLength(6); // 3*2 cells
    expect(tiles.map((t) => t.ref)).toEqual([0, 1, 2, 3, 4, 5]); // row-major cell ids
    expect(tiles.map((t) => t.typeId)).toEqual([1, 1, 2, 2, 1, 1]);
  });

  it('projects a tile to the iso position its (col,row) maps to', () => {
    const scene = buildScene(snapshotOf([]), FLAT_3x2);
    // cell 4 = (col 1, row 1) in a width-3 grid.
    const tile4 = scene.find((d) => d.kind === 'tile' && d.ref === 4);
    expect(tile4).toBeDefined();
    const expected = tileToScreen(1, 1);
    expect(tile4?.x).toBe(expected.x);
    expect(tile4?.y).toBe(expected.y);
  });

  it('draws every terrain tile behind every sprite', () => {
    const scene = buildScene(snapshotOf([entity(1, 0, 0, { Settler: { tribe: 0 } })]), FLAT_3x2);
    const lastTileIdx = scene.map((d) => d.kind).lastIndexOf('tile');
    const firstSpriteIdx = scene.findIndex((d) => d.kind !== 'tile');
    expect(lastTileIdx).toBeLessThan(firstSpriteIdx);
    // And every tile depth is strictly below every sprite depth.
    const maxTileDepth = Math.max(...scene.filter((d) => d.kind === 'tile').map((d) => d.depth));
    const minSpriteDepth = Math.min(...scene.filter((d) => d.kind !== 'tile').map((d) => d.depth));
    expect(maxTileDepth).toBeLessThan(minSpriteDepth);
  });

  it('depth-sorts sprites by feet anchor: lower (greater y) draws later/in front', () => {
    // back settler at y=0, front settler at y=2 — front must come AFTER back in draw order.
    const scene = buildScene(
      snapshotOf([
        entity(1, 1, 0, { Settler: { tribe: 0 } }), // back
        entity(2, 1, 2, { Settler: { tribe: 0 } }), // front
      ]),
      FLAT_3x2,
    );
    const sprites = scene.filter((d) => d.kind === 'settler');
    expect(sprites.map((s) => s.ref)).toEqual([1, 2]); // back (id 1) first, front (id 2) last
  });

  it('breaks an equal-feet tie by x then by entity id (a total, stable order)', () => {
    // Two on the same row (y=1): the one further right (greater x) draws in front.
    // Two on the exact same tile: lower entity id draws first.
    const scene = buildScene(
      snapshotOf([
        entity(3, 2, 1, { Settler: { tribe: 0 } }), // same y, greater x -> front-most of the row
        entity(1, 0, 1, { Settler: { tribe: 0 } }), // same y, least x -> back-most
        entity(2, 0, 1, { Settler: { tribe: 0 } }), // same tile as id 1 -> id tie-break after it
      ]),
      FLAT_3x2,
    );
    expect(scene.filter((d) => d.kind === 'settler').map((s) => s.ref)).toEqual([1, 2, 3]);
  });

  it('classifies buildings and resources, and skips a marker-less positioned entity', () => {
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Building: { buildingType: 5 } }),
        entity(2, 1, 1, { Resource: { goodType: 1 } }),
        entity(3, 2, 0, { PathFollow: { waypoints: [], index: 0 } }), // no drawable marker
      ]),
      FLAT_3x2,
    );
    const kinds = scene.filter((d) => d.kind !== 'tile').map((d) => d.kind);
    expect(kinds.sort()).toEqual(['building', 'resource']); // the marker-less entity is skipped
  });

  it('consumes a loaded terrain map (the parseTerrainMap shape) via terrainMapToScene', () => {
    // A "real" decoded map carries varied landscape typeIds (not just grass/water) — the multi-type
    // grid an emitted content/maps/<id>.json holds. terrainMapToScene must carry them through so the
    // GPU layer tints each tile by typeId, and buildScene must draw one tile per cell over the result.
    const loadedMap = { width: 2, height: 3, typeIds: [5, 1, 2, 5, 16, 1] };
    const terrain = terrainMapToScene(loadedMap);
    expect(terrain).toEqual({ width: 2, height: 3, typeIds: [5, 1, 2, 5, 16, 1] });

    const scene = buildScene(snapshotOf([]), terrain);
    const tiles = scene.filter((d) => d.kind === 'tile');
    expect(tiles).toHaveLength(6); // 2*3 cells
    expect(tiles.map((t) => t.typeId)).toEqual([5, 1, 2, 5, 16, 1]); // the map's typeIds, in order
  });

  it('derives a settler facing from its heading toward the next PathFollow waypoint', () => {
    // Settler at (1,1); the waypoint it walks toward sets the screen-space heading -> direction index.
    // Screen projection is iso (col-row, col+row) with a 2:1 aspect, so e.g. walking +col reads SE.
    const pf = (wx: number, wy: number): Record<string, unknown> => ({
      Settler: { tribe: 0 },
      PathFollow: { waypoints: [{ x: wx * ONE, y: wy * ONE }], index: 0 },
    });
    const facingOf = (wx: number, wy: number): number | undefined =>
      buildScene(snapshotOf([entity(1, 1, 1, pf(wx, wy))]), FLAT_3x2).find((d) => d.kind === 'settler')
        ?.facing;
    expect(facingOf(2, 1)).toBe(4); // east (+col)  -> screen down-right -> SE (4)
    expect(facingOf(0, 1)).toBe(0); // west (-col)  -> screen up-left   -> NW (0)
    expect(facingOf(2, 2)).toBe(3); // +col,+row    -> screen straight down -> S (3)
    expect(facingOf(0, 0)).toBe(7); // -col,-row    -> screen straight up   -> N (7)
  });

  it('omits facing when a settler has no heading (no path, or already on the waypoint)', () => {
    const idle = entity(1, 1, 1, { Settler: { tribe: 0 } }); // no PathFollow
    const arrived = entity(2, 1, 1, {
      Settler: { tribe: 0 },
      PathFollow: { waypoints: [{ x: 1 * ONE, y: 1 * ONE }], index: 0 }, // waypoint == position
    });
    const scene = buildScene(snapshotOf([idle, arrived]), FLAT_3x2);
    expect(scene.find((d) => d.ref === 1)?.facing).toBeUndefined();
    expect(scene.find((d) => d.ref === 2)?.facing).toBeUndefined();
  });

  it('derives a settler state from its components: acting > moving > idle', () => {
    const scene = buildScene(
      snapshotOf([
        // idle: a Settler with neither a CurrentAtomic nor a PathFollow.
        entity(1, 0, 0, { Settler: { tribe: 0 } }),
        // moving: a live PathFollow, no CurrentAtomic.
        entity(2, 1, 0, { Settler: { tribe: 0 }, PathFollow: { waypoints: [], index: 0 } }),
        // acting: a CurrentAtomic wins even with a (stale) PathFollow present.
        entity(3, 2, 0, {
          Settler: { tribe: 0 },
          CurrentAtomic: { atomicId: 24, elapsed: 6 },
          PathFollow: { waypoints: [], index: 0 },
        }),
      ]),
      FLAT_3x2,
    );
    const byRef = (r: number) => scene.find((d) => d.kind === 'settler' && d.ref === r);
    expect(byRef(1)?.state).toBe('idle');
    expect(byRef(1)?.atomicId).toBeUndefined();
    expect(byRef(1)?.elapsed).toBeUndefined();
    expect(byRef(2)?.state).toBe('moving');
    expect(byRef(2)?.atomicId).toBeUndefined();
    expect(byRef(3)?.state).toBe('acting');
    expect(byRef(3)?.atomicId).toBe(24); // the setatomic join key rides along
    expect(byRef(3)?.elapsed).toBe(6); // the atomic's tick clock rides along (the animation cadence)
  });

  it('marks buildings/resources idle with no atomicId (they do not animate per-state here)', () => {
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Building: { buildingType: 5 }, CurrentAtomic: { atomicId: 7 } }),
        entity(2, 1, 1, { Resource: { goodType: 1 }, PathFollow: { waypoints: [], index: 0 } }),
      ]),
      FLAT_3x2,
    );
    const building = scene.find((d) => d.kind === 'building');
    const resource = scene.find((d) => d.kind === 'resource');
    expect(building?.state).toBe('idle');
    expect(building?.atomicId).toBeUndefined();
    expect(resource?.state).toBe('idle');
  });

  it('is pure: the same snapshot yields a byte-identical draw list', () => {
    const snap = snapshotOf([
      entity(1, 1, 0, { Settler: { tribe: 0 } }),
      entity(2, 0, 2, { Building: { buildingType: 1 } }),
    ]);
    const a = buildScene(snap, FLAT_3x2);
    const b = buildScene(snap, FLAT_3x2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
