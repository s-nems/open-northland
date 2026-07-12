import { describe, expect, it } from 'vitest';
import { collectSpriteScene } from '../src/data/scene/index.js';
import {
  buildScene,
  depositVisualLevel,
  ONE,
  PROJECTILE_ARC_PEAK_FRACTION,
  PROJECTILE_ARC_PEAK_MAX_PX,
  type SceneTerrain,
  terrainMapToScene,
  tileToScreen,
} from '../src/index.js';
import { entity, snapshotOf } from './support/fixtures.js';

/**
 * Unit tests for the pure scene layer — the part of rendering an agent can self-verify (the pixels
 * are deferred to a human). They pin the two correctness properties a human eyeball would otherwise
 * have to catch: terrain always behind sprites, and sprites depth-sorted by feet anchor.
 *
 * A `WorldSnapshot` is plain data (no class instances / live Maps), so we hand-build one here rather
 * than spinning up a Simulation — this stays a render-package unit, not an integration test.
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

  it('classifies an in-flight Projectile and aims its rotation at the target', () => {
    // The shot at (1,1) homes on a target one column EAST (2,1): the screen heading is (+x, 0) → 0 rad.
    const shot = entity(1, 1, 1, {
      Projectile: { target: 2, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile');
    expect(arrow?.ref).toBe(1);
    expect(arrow?.rotation).toBeCloseTo(0); // points screen-east, along the flight
  });

  it('a projectile whose target left the snapshot draws with no rotation (never a throw)', () => {
    const shot = entity(1, 1, 1, {
      Projectile: { target: 99, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const scene = buildScene(snapshotOf([shot]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'projectile')?.rotation).toBeUndefined();
  });

  /** A Projectile payload homing on `target`, loosed from origin tile (ox, oy). */
  function projectileFrom(target: number, ox: number, oy: number): Record<string, unknown> {
    return {
      Projectile: {
        target,
        source: 3,
        damage: 34,
        speed: 8,
        munitionType: 1,
        originX: ox * ONE,
        originY: oy * ONE,
      },
    };
  }

  it('lobs a projectile with a readable origin: peak lift at mid-chord, level tangent, depth untouched', () => {
    // Origin (0,1) → target (2,1) on one row: chord = 2 cells = 136 px. The shot sits exactly halfway
    // (1,1) → p = 0.5: lift = the parabola's peak (chord × the peak fraction), tangent slope 0 → the
    // rotation is the flat straight-line heading (east).
    const shot = entity(1, 1, 1, projectileFrom(2, 0, 1));
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    // A flat control shot (no readable origin → no arc) on the SAME cell: the arc must ride the LIFT
    // channel only, never the depth key, so mid-lob occlusion order can't reshuffle.
    const flatShot = entity(4, 1, 1, {
      Projectile: { target: 2, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const scene = buildScene(snapshotOf([shot, target, flatShot]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile' && d.ref === 1);
    const chord = tileToScreen(2, 1).x - tileToScreen(0, 1).x;
    expect(arrow?.lift).toBeCloseTo(chord * PROJECTILE_ARC_PEAK_FRACTION); // 4·peak·½·½ = peak at mid-flight
    expect(arrow?.rotation).toBeCloseTo(0); // level at the apex — still the straight heading
    const flat = scene.find((d) => d.kind === 'projectile' && d.ref === 4);
    expect(arrow?.depth).toBe(flat?.depth); // arc never moves the depth key
  });

  it('caps the lob peak on a long chord (a max-range shot must not leave the screen)', () => {
    // Origin (0,1) → target (12,1): chord = 12 cells = 816 px, whose fractional peak (~98 px) exceeds
    // the cap — the drawn peak clamps to PROJECTILE_ARC_PEAK_MAX_PX exactly at mid-flight (6,1).
    const shot = entity(1, 6, 1, projectileFrom(2, 0, 1));
    const target = entity(2, 12, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const chord = tileToScreen(12, 1).x - tileToScreen(0, 1).x;
    expect(chord * PROJECTILE_ARC_PEAK_FRACTION).toBeGreaterThan(PROJECTILE_ARC_PEAK_MAX_PX); // the cap really binds
    expect(scene.find((d) => d.kind === 'projectile')?.lift).toBeCloseTo(PROJECTILE_ARC_PEAK_MAX_PX);
  });

  it('tilts a descending projectile nose-DOWN along the arc tangent past mid-flight', () => {
    // Same 2-cell chord, shot ¾ of the way (1.5, 1): the parabola is falling, so the drawn heading
    // tilts screen-down (positive rotation toward an eastbound target) instead of the flat 0.
    const shot = entity(1, 1.5, 1, projectileFrom(2, 0, 1));
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile');
    expect(arrow?.rotation ?? 0).toBeGreaterThan(0);
    expect(arrow?.lift ?? 0).toBeGreaterThan(0); // still airborne
  });

  it('a mid-swing attacker plays the swing IN PLACE: anchor untouched, facing its target', () => {
    // Attacker (1,1) swings (atomic 81) at a target one column EAST (2,1). The drawn anchor must
    // stay exactly on the attacker's own feet — the attack frames carry their authored advance in
    // per-frame foot offsets, and an extra positional nudge doubled it into a ground slide (the
    // rejected melee "lunge"). Facing still resolves toward the live target; the depth key is pinned
    // against an idle twin on the attacker's own cell.
    const attacker = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 81, elapsed: 6, duration: 12, targetEntity: 2, targetTile: null },
    });
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const idleTwin = entity(4, 1, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([attacker, target, idleTwin]), FLAT_3x2);
    const drawn = scene.find((d) => d.kind === 'settler' && d.ref === 1);
    const base = tileToScreen(1, 1);
    expect(drawn?.x).toBeCloseTo(base.x); // swings where it stands
    expect(drawn?.y).toBeCloseTo(base.y);
    expect(drawn?.facing).toBe(4); // faces its mark (E)
    expect(drawn?.depth).toBe(scene.find((d) => d.kind === 'settler' && d.ref === 4)?.depth);
  });

  it('a RANGED attacker likewise stands its ground and faces its target', () => {
    // The archer at (1,1) draws on a target 5 columns east: anchor in place, the arrow crosses the
    // gap, not the archer.
    const archer = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 81, elapsed: 3, targetEntity: 2, targetTile: null },
    });
    const target = entity(2, 6, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([archer, target]), FLAT_3x2);
    const drawn = scene.find((d) => d.kind === 'settler' && d.ref === 1);
    const base = tileToScreen(1, 1);
    expect(drawn?.x).toBeCloseTo(base.x);
    expect(drawn?.facing).toBe(4); // still faces its mark (E)
  });

  it('marks a settler engaged when it carries the Engagement component', () => {
    const scene = buildScene(
      snapshotOf([
        entity(1, 1, 1, { Settler: { tribe: 0 }, Engagement: { repathAt: 0 } }),
        entity(2, 1, 1, { Settler: { tribe: 0 } }),
      ]),
      FLAT_3x2,
    );
    expect(scene.find((d) => d.kind === 'settler' && d.ref === 1)?.engaged).toBe(true);
    expect(scene.find((d) => d.kind === 'settler' && d.ref === 2)?.engaged).toBeUndefined();
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

  it('reads a between-paths settler (MoveGoal / pending PathRequest) as moving, not a stutter', () => {
    // A chaser re-issuing its route drops PathFollow for a tick while it still holds a MoveGoal or a fresh
    // PathRequest — it is walking, not standing. Reading that gap as `idle` was the visible march stutter
    // (the walk animation snapping to the standing pose each tile). A FAILED PathRequest is the genuinely
    // stuck case and stays `idle` so the unit doesn't moonwalk against an unreachable goal.
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Settler: { tribe: 0 }, MoveGoal: { cell: 5 } }),
        entity(2, 1, 0, { Settler: { tribe: 0 }, PathRequest: { start: 0, goal: 5, failed: false } }),
        entity(3, 2, 0, { Settler: { tribe: 0 }, PathRequest: { start: 0, goal: 5, failed: true } }),
        // MoveGoal present but its path already failed → still stuck, still idle (failure wins).
        entity(4, 2, 1, {
          Settler: { tribe: 0 },
          MoveGoal: { cell: 5 },
          PathRequest: { start: 0, goal: 5, failed: true },
        }),
      ]),
      FLAT_3x2,
    );
    const byRef = (r: number) => scene.find((d) => d.kind === 'settler' && d.ref === r);
    expect(byRef(1)?.state).toBe('moving'); // holding a goal, path not yet issued
    expect(byRef(2)?.state).toBe('moving'); // route queued, not yet a PathFollow
    expect(byRef(3)?.state).toBe('idle'); // unreachable goal — stuck, not moving
    expect(byRef(4)?.state).toBe('idle'); // failed route wins over the lingering goal
  });

  it('reads a settler’s owning player (the team-colour key) from its Owner component', () => {
    // The render team-colour join: Owner.player → DrawItem.player → the PalettedSprite LUT row. An UNOWNED
    // settler (no Owner) carries no player and draws the base palette (row 0).
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Settler: { tribe: 0 }, Owner: { player: 3 } }),
        entity(2, 1, 0, { Settler: { tribe: 0 } }), // wildlife / neutral — unowned
        entity(3, 2, 0, { Settler: { tribe: 0 }, Owner: { player: 0 } }), // player 0 is a real slot, not "none"
      ]),
      FLAT_3x2,
    );
    const byRef = (r: number) => scene.find((d) => d.kind === 'settler' && d.ref === r);
    expect(byRef(1)?.player).toBe(3);
    expect(byRef(2)?.player).toBeUndefined();
    expect(byRef(3)?.player).toBe(0);
  });

  it('flags a settler hauling a good with carrying:true (the loaded-gait join key)', () => {
    const scene = buildScene(
      snapshotOf([
        // empty-handed walker: no Carrying component → flag omitted.
        entity(1, 0, 0, { Settler: { tribe: 0 }, PathFollow: { waypoints: [], index: 0 } }),
        // hauling a log home: a Carrying component present → carrying:true rides along orthogonal to state.
        entity(2, 1, 0, {
          Settler: { tribe: 0 },
          PathFollow: { waypoints: [], index: 0 },
          Carrying: { goodType: 1, amount: 1 },
        }),
      ]),
      FLAT_3x2,
    );
    const byRef = (r: number) => scene.find((d) => d.kind === 'settler' && d.ref === r);
    expect(byRef(1)?.state).toBe('moving');
    expect(byRef(1)?.carrying).toBeUndefined();
    expect(byRef(1)?.carryGood).toBeUndefined();
    expect(byRef(2)?.state).toBe('moving'); // still moving — carrying is orthogonal to the coarse state
    expect(byRef(2)?.carrying).toBe(true);
    expect(byRef(2)?.carryGood).toBe(1); // the hauled goodType rides along — the per-good look join key
  });

  it('carries the settler jobType + the young (Age) flag — the per-character body join keys', () => {
    const scene = buildScene(
      snapshotOf([
        // An adult with a job: jobType rides along, no young flag (no Age component).
        entity(1, 0, 0, { Settler: { tribe: 0, jobType: 31 } }),
        // A jobless adult (jobType null): the field is omitted → the binding's default look.
        entity(2, 1, 0, { Settler: { tribe: 0, jobType: null } }),
        // A born-young settler: the Age component flips young:true, disambiguating the age-class
        // jobType 1 from a fixture adult using the same number (AGENTS.md [dc3ef54]).
        entity(3, 2, 0, { Settler: { tribe: 0, jobType: 1 }, Age: { ticks: 5 } }),
        // A fixture ADULT whose job id collides with an age class: jobType 1 but NO Age → young omitted.
        entity(4, 2, 1, { Settler: { tribe: 0, jobType: 1 } }),
      ]),
      FLAT_3x2,
    );
    const byRef = (r: number) => scene.find((d) => d.kind === 'settler' && d.ref === r);
    expect(byRef(1)?.jobType).toBe(31);
    expect(byRef(1)?.young).toBeUndefined();
    expect(byRef(2)?.jobType).toBeUndefined();
    expect(byRef(3)?.jobType).toBe(1);
    expect(byRef(3)?.young).toBe(true);
    expect(byRef(4)?.jobType).toBe(1);
    expect(byRef(4)?.young).toBeUndefined();
  });

  it('draws a chopping settler at its cell centre — the swing plays in place, no positional nudge', () => {
    // The worker stands on the work cell BESIDE its tree (the planner's adjacent stance) and FACES it;
    // the swing's advance is authored into the frames. The old fixed −24 px chop nudge assumed the
    // settler shared the tree's cell and popped on/off across the between-swings replan gap — the
    // reported forward-back slide — so a chopping and a non-chopping settler now share the same anchor.
    const cellCentreX = tileToScreen(2, 0).x;
    const scene = buildScene(
      snapshotOf([
        entity(1, 2, 0, { Settler: { tribe: 0 }, CurrentAtomic: { atomicId: 24, elapsed: 3 } }),
        entity(2, 2, 0, { Settler: { tribe: 0 }, CurrentAtomic: { atomicId: 23, elapsed: 3 } }),
      ]),
      FLAT_3x2,
    );
    const chopper = scene.find((d) => d.kind === 'settler' && d.ref === 1);
    const depositor = scene.find((d) => d.kind === 'settler' && d.ref === 2);
    expect(chopper?.x).toBe(cellCentreX);
    expect(depositor?.x).toBe(cellCentreX);
    expect(chopper?.depth).toBe(depositor?.depth);
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

describe('depositVisualLevel — the shrink-by-level fill bucket', () => {
  it('buckets remaining/initial into [1, levels]: full → levels, dregs → 1, exhausted → 0', () => {
    // initial 10 over 5 levels — ~2 units per level (ceil rounds a partial level UP).
    expect(depositVisualLevel(10, 10, 5)).toBe(5); // full
    expect(depositVisualLevel(9, 10, 5)).toBe(5); // still reads full until a whole level is gone
    expect(depositVisualLevel(8, 10, 5)).toBe(4);
    expect(depositVisualLevel(2, 10, 5)).toBe(1);
    expect(depositVisualLevel(1, 10, 5)).toBe(1); // the dregs — one unit still shows a level
    expect(depositVisualLevel(0, 10, 5)).toBe(0); // exhausted (the node is then removed, so 0 never draws)
  });

  it('steps one level per unit when the deposit size equals the level count', () => {
    expect(depositVisualLevel(5, 5, 5)).toBe(5);
    expect(depositVisualLevel(3, 5, 5)).toBe(3);
    expect(depositVisualLevel(1, 5, 5)).toBe(1);
  });

  it('guards a mis-stamped deposit (never divides by zero)', () => {
    expect(depositVisualLevel(4, 0, 5)).toBe(0); // no size
    expect(depositVisualLevel(4, 5, 0)).toBe(0); // no levels
    expect(depositVisualLevel(-1, 5, 5)).toBe(0); // negative remaining
  });
});

describe('buildScene — resource + stockpile (gathering economy) classification', () => {
  it("carries a resource node's goodType (the per-good node join key)", () => {
    const scene = buildScene(
      snapshotOf([entity(1, 1, 1, { Resource: { goodType: 7, remaining: 5 } })]),
      FLAT_3x2,
    );
    const node = scene.find((d) => d.kind === 'resource');
    expect(node?.goodType).toBe(7);
    expect(node?.fill).toBeUndefined(); // a node has no fill amount (that's a pile's)
  });

  it('carries a MINED node its fill level (MineDeposit + Resource.remaining); a plain node carries none', () => {
    // A half-mined deposit: remaining 5 of 10 over 5 levels → level 3 (ceil(5·5/10)).
    const mined = buildScene(
      snapshotOf([
        entity(1, 1, 1, { Resource: { goodType: 4, remaining: 5 }, MineDeposit: { initial: 10, levels: 5 } }),
      ]),
      FLAT_3x2,
    ).find((d) => d.kind === 'resource');
    expect(mined?.level).toBe(3);
    expect(mined?.levels).toBe(5); // the ladder size rides along so the resolver can rescale it
    // A plain node (no MineDeposit) carries no level — the binding draws its full-state frame.
    const plain = buildScene(
      snapshotOf([entity(1, 1, 1, { Resource: { goodType: 4, remaining: 5 } })]),
      FLAT_3x2,
    ).find((d) => d.kind === 'resource');
    expect(plain?.level).toBeUndefined();
    expect(plain?.levels).toBeUndefined();
  });

  it('classifies a bare Stockpile (no Building) as a stockpile, carrying its dominant good + fill', () => {
    // The snapshot clones a Stockpile.amounts Map to an ascending-by-goodType [good, amount] array.
    const scene = buildScene(snapshotOf([entity(1, 1, 1, { Stockpile: { amounts: [[3, 4]] } })]), FLAT_3x2);
    const pile = scene.find((d) => d.kind === 'stockpile');
    expect(pile).toBeDefined();
    expect(pile?.goodType).toBe(3);
    expect(pile?.fill).toBe(4);
  });

  it('reads an EMPTY bare Stockpile as a flag: stockpile kind, no goodType, no fill', () => {
    const scene = buildScene(snapshotOf([entity(1, 1, 1, { Stockpile: { amounts: [] } })]), FLAT_3x2);
    const flag = scene.find((d) => d.kind === 'stockpile');
    expect(flag).toBeDefined();
    expect(flag?.goodType).toBeUndefined();
    expect(flag?.fill).toBeUndefined();
  });

  it('classifies a Stockpile carrying a GroundDrop marker as a grounddrop (the felled trunk), not a flag', () => {
    const scene = buildScene(
      snapshotOf([entity(1, 1, 1, { Stockpile: { amounts: [[3, 9]] }, GroundDrop: { goodType: 3 } })]),
      FLAT_3x2,
    );
    const drop = scene.find((d) => d.kind === 'grounddrop');
    expect(drop?.goodType).toBe(3); // its held good keys the per-good pickup (trunk) graphic
    expect(scene.find((d) => d.kind === 'stockpile')).toBeUndefined(); // never the flag/heap path
  });

  it('picks the dominant good (most units, lowest goodType on a tie) for a mixed pile', () => {
    // amounts ascending by goodType: good 2 has 5 units (the max), good 5 has 3 → dominant is good 2.
    const most = buildScene(
      snapshotOf([
        entity(1, 1, 1, {
          Stockpile: {
            amounts: [
              [2, 5],
              [5, 3],
            ],
          },
        }),
      ]),
      FLAT_3x2,
    ).find((d) => d.kind === 'stockpile');
    expect(most?.goodType).toBe(2);
    expect(most?.fill).toBe(5);
    // On a tie the first (lowest goodType) wins — deterministic, order-independent.
    const tie = buildScene(
      snapshotOf([
        entity(1, 1, 1, {
          Stockpile: {
            amounts: [
              [2, 3],
              [5, 3],
            ],
          },
        }),
      ]),
      FLAT_3x2,
    ).find((d) => d.kind === 'stockpile');
    expect(tie?.goodType).toBe(2);
  });

  it('keeps a building store (Building + Stockpile) a building, never a stockpile', () => {
    const scene = buildScene(
      snapshotOf([entity(1, 1, 1, { Building: { buildingType: 7 }, Stockpile: { amounts: [[1, 10]] } })]),
      FLAT_3x2,
    );
    expect(scene.find((d) => d.kind === 'building')).toBeDefined();
    expect(scene.find((d) => d.kind === 'stockpile')).toBeUndefined();
  });
});

describe('collectSpriteScene — the single-pass draw list + liveness set', () => {
  // The retained pool's destroy-vs-cull rule hangs on this invariant: a viewport-CULLED entity must
  // still be in `liveRefs` (alive, kept pooled for when it scrolls back) while absent from `items`
  // (not drawn). If `liveRefs` were ever collected after the cull, every off-screen sprite would be
  // destroyed and re-minted on each scroll — the churn the retained pool exists to prevent.
  it('keeps a culled entity in liveRefs while dropping it from items', () => {
    const near = tileToScreen(1, 1);
    // A viewport framing only the near settler's anchor; the far one (way off to the right) is culled.
    const viewport = { minX: near.x - 10, maxX: near.x + 10, minY: near.y - 10, maxY: near.y + 10 };
    const scene = collectSpriteScene(
      snapshotOf([
        entity(1, 1, 1, { Settler: { tribe: 0 } }), // framed
        entity(2, 40, 40, { Settler: { tribe: 0 } }), // far off-screen — culled, still alive
      ]),
      { viewport },
    );
    expect(scene.items.map((d) => d.ref)).toEqual([1]);
    expect([...scene.liveRefs].sort()).toEqual([1, 2]);
  });

  it('excludes non-drawable entities from BOTH items and liveRefs (they were never pooled)', () => {
    const scene = collectSpriteScene(
      snapshotOf([
        entity(1, 1, 1, { Settler: { tribe: 0 } }),
        entity(2, 1, 1, {}), // a Position with no drawable marker (e.g. a pure mover)
      ]),
    );
    expect(scene.items.map((d) => d.ref)).toEqual([1]);
    expect([...scene.liveRefs]).toEqual([1]);
  });

  // The `?map=` static→dynamic handover rule: a virgin map resource is drawn by the RETAINED static
  // object layer, so the pool must see it in NEITHER items (not drawn twice) NOR liveRefs (never
  // pooled). Releasing the ref (first-touch) makes the same entity draw normally on the next frame.
  it('skips staticRefs entities from both items and liveRefs, and draws them once released', () => {
    const snapshot = snapshotOf([
      entity(1, 1, 1, { Resource: { goodType: 1 } }), // statically drawn (virgin map node)
      entity(2, 2, 1, { Resource: { goodType: 1 } }), // pool-drawn (admin spawn / handed over)
    ]);
    const withStatic = collectSpriteScene(snapshot, { staticRefs: new Set([1]) });
    expect(withStatic.items.map((d) => d.ref)).toEqual([2]);
    expect([...withStatic.liveRefs]).toEqual([2]);
    const released = collectSpriteScene(snapshot, { staticRefs: new Set() });
    expect(released.items.map((d) => d.ref)).toEqual([1, 2]);
  });

  // A settler exchanging goods with a completed BUILDING store (a pileup deposit / a pickup lift) has
  // walked INSIDE for the exchange (the original's carrier vanishes into the house — observed), so it
  // is kept alive/pooled but NOT drawn for the atomic's duration. A ground pile / flag / construction
  // site is not enterable — those exchanges keep the settler visible.
  it('hides a settler mid-exchange inside a completed building, but not at a ground pile or a site', () => {
    const building = entity(10, 2, 2, { Building: { buildingType: 1, tribe: 1, built: ONE, level: 0 } });
    const site = entity(11, 4, 4, {
      Building: { buildingType: 1, tribe: 1, built: ONE / 2, level: 0 },
      UnderConstruction: {},
    });
    const pile = entity(12, 6, 6, { Stockpile: { amounts: [[1, 2]] } });
    const scene = collectSpriteScene(
      snapshotOf([
        building,
        site,
        pile,
        // Depositing INTO the completed building — inside, not drawn.
        entity(1, 2, 2, { Settler: { tribe: 0 }, CurrentAtomic: { effect: { kind: 'pileup', store: 10 } } }),
        // Lifting FROM the completed building — inside too (the fetch enters the same way).
        entity(2, 2, 2, {
          Settler: { tribe: 0 },
          CurrentAtomic: { effect: { kind: 'pickup', from: 10, goodType: 1, amount: 1 } },
        }),
        // Delivering to a CONSTRUCTION SITE — no house to enter yet; stays visible.
        entity(3, 4, 4, { Settler: { tribe: 0 }, CurrentAtomic: { effect: { kind: 'pileup', store: 11 } } }),
        // Lifting from a loose GROUND PILE — stays visible.
        entity(4, 6, 6, {
          Settler: { tribe: 0 },
          CurrentAtomic: { effect: { kind: 'pickup', from: 12, goodType: 1, amount: 1 } },
        }),
      ]),
    );
    const drawnSettlers = scene.items.filter((d) => d.kind === 'settler').map((d) => d.ref);
    expect(drawnSettlers.sort()).toEqual([3, 4]); // the two inside (1, 2) are not drawn…
    expect([...scene.liveRefs].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 10, 11, 12]); // …but stay live
  });

  it('hides a settler RESTING inside its workplace (waiting between chores), keeping it live', () => {
    const scene = collectSpriteScene(
      snapshotOf([
        entity(10, 2, 2, { Building: { buildingType: 1, tribe: 1, built: ONE, level: 0 } }),
        entity(1, 2, 2, { Settler: { tribe: 0 }, Resting: { at: 10 } }), // waiting inside — not drawn
        entity(2, 3, 3, { Settler: { tribe: 0 } }), // an ordinary settler stays visible
      ]),
    );
    expect(scene.items.filter((d) => d.kind === 'settler').map((d) => d.ref)).toEqual([2]);
    expect([...scene.liveRefs].sort((a, b) => a - b)).toEqual([1, 2, 10]);
  });

  // The details panel's worker field opts INTO drawing a building's indoor occupants: `keepIndoorSettlers`
  // turns the suppressed resting / mid-exchange settlers back into draw items, FORCED to the `idle`
  // standing pose (no stale gait, no orphan action swing) so they stand in the panel instead of vanishing.
  it('keepIndoorSettlers keeps the indoor settlers, forcing away a lingering gait/swing', () => {
    // Each indoor settler carries state the forcing must OVERRIDE — not a bare settler that would read
    // idle anyway: a stale PathFollow (would read `moving`) and a live pickup atomic (would read `acting`
    // and drag its atomicId/elapsed along). So the assertions below fail if the `!indoorSettler` guards
    // that force idle are dropped.
    const entities = [
      entity(10, 2, 2, { Building: { buildingType: 1, tribe: 1, built: ONE, level: 0 } }),
      // Resting inside its workplace, still holding the path from the tick it stepped in — kept, forced idle.
      entity(1, 2, 2, { Settler: { tribe: 0 }, Resting: { at: 10 }, PathFollow: {} }),
      // Mid-exchange inside the completed store, mid-atomic — kept, forced idle; its atomicId/elapsed must
      // NOT ride along (the pose is a plain stand, not a truncated pickup stoop).
      entity(2, 2, 2, {
        Settler: { tribe: 0 },
        CurrentAtomic: {
          atomicId: 22,
          elapsed: 6,
          effect: { kind: 'pickup', from: 10, goodType: 1, amount: 1 },
        },
      }),
    ];
    const drawn = collectSpriteScene(snapshotOf(entities), {
      keepIndoorSettlers: true,
    }).items.filter((d) => d.kind === 'settler');
    expect(drawn.map((d) => d.ref).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(drawn.every((d) => d.state === 'idle')).toBe(true);
    expect(drawn.every((d) => d.atomicId === undefined && d.elapsed === undefined)).toBe(true);
  });
});
