import { describe, expect, it } from 'vitest';
import { buildScene, ONE, type SceneTerrain, terrainMapToScene, tileToScreen } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * Unit tests for {@link buildScene} — projection, depth order & facing. Pins the two correctness
 * properties a human eyeball would otherwise catch: terrain always behind sprites, sprites depth-sorted
 * by feet anchor; plus tile projection, classification, and the settler facing derivation.
 */

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

  it('paints a settler IN FRONT of the resource node it stands on (same cell), overriding id order', () => {
    // Settler id 1 shares the node's cell (a harvester stands ON the deposit/tree). The settler has the
    // LOWER id, so the plain id tiebreak would draw it FIRST (behind) — the "worker vanishes into the
    // node" bug. The per-kind paint bias must reorder it AFTER the node (in front).
    const scene = buildScene(
      snapshotOf([
        entity(1, 1, 1, { Settler: { tribe: 0 } }),
        entity(2, 1, 1, { Resource: { goodType: 1 } }),
      ]),
      FLAT_3x2,
    );
    const order = scene.filter((d) => d.kind === 'settler' || d.kind === 'resource').map((d) => d.kind);
    expect(order).toEqual(['resource', 'settler']); // node behind, settler in front
  });

  it('paints a bare stockpile pile IN FRONT of the ground drops on its cell, overriding id order', () => {
    // The bare pile (Stockpile, id 3) sits on the same cell as a loose ore/log drop (Stockpile+GroundDrop,
    // id 4). The pile has the LOWER id, so id order would draw it behind the drop; the paint bias lifts the
    // stockpile in front (a stockpile outranks a grounddrop).
    const scene = buildScene(
      snapshotOf([
        entity(3, 1, 1, { Stockpile: { amounts: [[1, 2]] } }),
        entity(4, 1, 1, { Stockpile: { amounts: [[1, 1]] }, GroundDrop: {} }),
      ]),
      FLAT_3x2,
    );
    const order = scene.filter((d) => d.kind === 'grounddrop' || d.kind === 'stockpile').map((d) => d.kind);
    expect(order).toEqual(['grounddrop', 'stockpile']); // drop behind, flag in front
  });

  it('paints a delivery FLAG in front of a co-located goods heap of its own kind (FLAG_PAINT_STEP)', () => {
    // A flag (DeliveryFlag marker, id 3) shares a tile with a goods heap (bare Stockpile, id 5) piling up on
    // it. Both classify as `stockpile`, so the kind bias ties and the id tiebreak would bury the earlier
    // flag under the later heap; the half-step flag bump lifts the flag in front. (Both drawn as `stockpile`
    // kind — the flag is `isFlag`, the heap carries a good.)
    const scene = buildScene(
      snapshotOf([
        entity(3, 1, 1, { DeliveryFlag: {} }),
        entity(5, 1, 1, { Stockpile: { amounts: [[1, 3]] } }),
      ]),
      FLAT_3x2,
    );
    const stock = scene.filter((d) => d.kind === 'stockpile');
    expect(stock.map((d) => d.ref)).toEqual([5, 3]); // heap (id 5) behind, flag (id 3) in front
    const flag = stock.find((d) => d.ref === 3);
    const heap = stock.find((d) => d.ref === 5);
    expect(flag?.isFlag).toBe(true);
    expect(flag?.goodType).toBeUndefined(); // a flag holds no goods
    expect((flag?.depth ?? 0) > (heap?.depth ?? 0)).toBe(true); // strictly in front
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

  it('stamps a building draw item with its buildingType (so a per-type binding picks its bob)', () => {
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Building: { buildingType: 6 } }),
        entity(2, 1, 1, { Resource: { goodType: 1 } }),
      ]),
      FLAT_3x2,
    );
    expect(scene.find((d) => d.kind === 'building')?.typeId).toBe(6);
    // A resource keys off no type, so it carries no typeId (only tiles + buildings do).
    expect(scene.find((d) => d.kind === 'resource')?.typeId).toBeUndefined();
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

  it('derives a settler facing from its PROJECTED screen heading toward the next waypoint', () => {
    // Settler at (1,1) — an ODD (half-shifted) row; the waypoint it walks toward sets the screen-space
    // heading -> direction index. Facing quantizes the PROJECTED (tileToScreen) heading, so it is
    // parity-correct under the staggered raster — the same grid step reads differently per row parity.
    const pf = (wx: number, wy: number): Record<string, unknown> => ({
      Settler: { tribe: 0 },
      PathFollow: { waypoints: [{ x: wx * ONE, y: wy * ONE }], index: 0 },
    });
    const facingOf = (wx: number, wy: number): number | undefined =>
      buildScene(snapshotOf([entity(1, 1, 1, pf(wx, wy))]), FLAT_3x2).find((d) => d.kind === 'settler')
        ?.facing;
    // Bob blocks face 0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N (source basis "Settler facing").
    // The six lattice headings from an odd-row cell:
    expect(facingOf(2, 1)).toBe(4); // E  column step          -> screen right      -> block 4
    expect(facingOf(0, 1)).toBe(1); // W  column step          -> screen left       -> block 1
    expect(facingOf(2, 2)).toBe(5); // SE lattice edge (+1,+1) -> screen down-right -> block 5
    expect(facingOf(1, 2)).toBe(0); // SW lattice edge (0,+1)  -> screen down-left  -> block 0
    expect(facingOf(2, 0)).toBe(3); // NE lattice edge (+1,-1) -> screen up-right   -> block 3
    expect(facingOf(1, 0)).toBe(2); // NW lattice edge (0,-1)  -> screen up-left    -> block 2
  });

  it('faces N/S on a vertical leg — the seam waypoint projects to a dead-vertical screen heading', () => {
    // A vertical lattice step is routed as cell centre -> SEAM -> cell centre (routing.ts): from the
    // odd row 1 the seam below sits at grid (1.5, 2), which projects to the SAME screen x as (1,1) —
    // heading straight down -> block 6 (S); the seam above at (1.5, 0) heads straight up -> block 7 (N).
    const walker = (ref: number, seamY: number): ReturnType<typeof entity> =>
      entity(ref, 1, 1, {
        Settler: { tribe: 0 },
        PathFollow: { waypoints: [{ x: 1.5 * ONE, y: seamY * ONE }], index: 0 },
      });
    const scene = buildScene(snapshotOf([walker(1, 2), walker(2, 0)]), FLAT_3x2);
    const settlers = scene.filter((d) => d.kind === 'settler');
    expect(settlers.find((d) => d.ref === 1)?.facing).toBe(6); // straight down -> S
    expect(settlers.find((d) => d.ref === 2)?.facing).toBe(7); // straight up   -> N
  });

  it('faces the same grid step by ROW PARITY: (0,+1) reads SW from an odd row, SE from an even one', () => {
    // The stagger flips which way a one-row-down step slides: odd row -> half a cell LEFT (SW), even
    // row -> half a cell RIGHT (SE). The old sign-pair table faced both "S" — a zigzag artifact.
    const walker = (ref: number, x: number, y: number): ReturnType<typeof entity> =>
      entity(ref, x, y, {
        Settler: { tribe: 0 },
        PathFollow: { waypoints: [{ x: x * ONE, y: (y + 1) * ONE }], index: 0 },
      });
    const scene = buildScene(snapshotOf([walker(1, 1, 1), walker(2, 1, 2)]), FLAT_3x2);
    const settlers = scene.filter((d) => d.kind === 'settler');
    expect(settlers.find((d) => d.ref === 1)?.facing).toBe(0); // odd row 1 -> screen down-left  (SW)
    expect(settlers.find((d) => d.ref === 2)?.facing).toBe(5); // even row 2 -> screen down-right (SE)
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

  it('an attacker (atomic 81) faces its target LIVE tile, overriding any stale path heading', () => {
    // The attacker at odd row (1,1) swings at entity 2 one column EAST (2,1) → block 4 (E). Its lingering
    // path points the other way (west, block 1); combat facing must win so it never swings at empty air.
    const attacker = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 81, elapsed: 3, targetEntity: 2, targetTile: null },
      PathFollow: { waypoints: [{ x: 0 * ONE, y: 1 * ONE }], index: 0 },
    });
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([attacker, target]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'settler' && d.ref === 1)?.facing).toBe(4); // faces E, not W
  });

  it('a harvester (atomic 24) likewise faces the node it works, overriding a stale path heading', () => {
    // The woodcutter at (1,1) chops the tree one column EAST (2,1) → block 4 (E); its lingering path
    // points west (block 1). Target facing must win or the axe swings into empty air beside the trunk.
    const chopper = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 24, elapsed: 3, targetEntity: 2, targetTile: null },
      PathFollow: { waypoints: [{ x: 0 * ONE, y: 1 * ONE }], index: 0 }, // west → block 1
    });
    const target = entity(2, 2, 1, { Resource: { goodType: 1, remaining: 3 } });
    const scene = buildScene(snapshotOf([chopper, target]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'settler' && d.ref === 1)?.facing).toBe(4); // faces E, into the tree
  });

  it('a NON-target atomic (a deposit) keeps its movement facing — target facing stays scoped', () => {
    // atomic 23 (pileup) is neither the attack nor a harvest action, so no target lookup applies.
    const depositor = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 23, elapsed: 3, targetEntity: 2, targetTile: null },
      PathFollow: { waypoints: [{ x: 0 * ONE, y: 1 * ONE }], index: 0 }, // west → block 1
    });
    const target = entity(2, 2, 1, { Stockpile: { amounts: [[1, 2]] } });
    const scene = buildScene(snapshotOf([depositor, target]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'settler' && d.ref === 1)?.facing).toBe(1); // W from path, not E
  });
});
