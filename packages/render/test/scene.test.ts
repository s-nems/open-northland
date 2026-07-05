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

  it('derives a settler facing from its heading toward the next PathFollow waypoint', () => {
    // Settler at (1,1); the waypoint it walks toward sets the screen-space heading -> direction index.
    // The staggered-raster projection (iso.ts) maps +col to screen-right and +row to screen-down, so a
    // grid step's screen heading is just its sign pair — map N/S/E/W coincide with the screen's (no
    // diamond rotation), e.g. walking +col reads E (not SE).
    const pf = (wx: number, wy: number): Record<string, unknown> => ({
      Settler: { tribe: 0 },
      PathFollow: { waypoints: [{ x: wx * ONE, y: wy * ONE }], index: 0 },
    });
    const facingOf = (wx: number, wy: number): number | undefined =>
      buildScene(snapshotOf([entity(1, 1, 1, pf(wx, wy))]), FLAT_3x2).find((d) => d.kind === 'settler')
        ?.facing;
    // Bob blocks face 0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N (docs/FIDELITY.md "Settler facing");
    // a grid step maps to the block facing its screen heading via STEP_TO_FACING.
    expect(facingOf(2, 1)).toBe(4); // grid-E (+col)       -> screen right      (E)  -> block 4
    expect(facingOf(0, 1)).toBe(1); // grid-W (-col)       -> screen left       (W)  -> block 1
    expect(facingOf(2, 2)).toBe(5); // grid-SE (+col,+row) -> screen down-right (SE) -> block 5
    expect(facingOf(0, 0)).toBe(2); // grid-NW (-col,-row) -> screen up-left    (NW) -> block 2
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
        // jobType 1 from a fixture adult using the same number (docs/LESSONS.md [dc3ef54]).
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

  it('nudges a chopping settler left so the axe lands in the tree, without moving its depth', () => {
    // A settler mid-chop (atomic 24) shares the tree's cell; its drawn x is shifted left of the cell
    // centre (so the right-swing axe connects with the trunk), but the depth sort key — derived from the
    // true tile, not the nudged x — is identical to an un-nudged sprite on that cell. Render-only.
    const cellCentreX = tileToScreen(2, 0).x;
    const scene = buildScene(
      snapshotOf([
        entity(1, 2, 0, { Settler: { tribe: 0 }, CurrentAtomic: { atomicId: 24, elapsed: 3 } }),
        // A settler on the SAME cell but NOT chopping (a different atomic) keeps the cell-centre x.
        entity(2, 2, 0, { Settler: { tribe: 0 }, CurrentAtomic: { atomicId: 23, elapsed: 3 } }),
      ]),
      FLAT_3x2,
    );
    const chopper = scene.find((d) => d.kind === 'settler' && d.ref === 1);
    const depositor = scene.find((d) => d.kind === 'settler' && d.ref === 2);
    expect(chopper?.x).toBe(cellCentreX - 24); // shifted left by CHOP_NUDGE_X
    expect(depositor?.x).toBe(cellCentreX); // a non-chop action is not nudged
    // Same cell ⇒ same depth despite the x nudge (depth uses the tile, not the drawn x).
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
