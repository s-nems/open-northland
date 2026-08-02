import { type ContentSet, IR_VERSION, parseContentSet, parseTerrainMap } from '@open-northland/data';
import { buildTerrainGraph } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  NAV_LANDSCAPE_TYPES,
  TERRAIN_BARREN,
  TERRAIN_BLOCKED,
  TERRAIN_IMPASSABLE,
  TERRAIN_MARGIN,
  TERRAIN_OPEN,
} from '../src/catalog/terrain.js';
import type { CollisionIrView } from '../src/content/collision.js';
import { buildCollisionTerrain } from '../src/content/collision.js';

/**
 * The decoded-map → sim collision join (content/collision.ts): synthetic fixtures shaped like the
 * real lanes (ground triangle patterns by name → logicType → the trianglepatterntypes walk/build
 * flags; object placements by name → the `[GfxLandscape]` walk/build areas), asserting each source
 * lands in its semantic terrain class.
 */

/** A 6×4-cell map (a 12×8 half-cell collision grid): meadow ground except one all-water, one
 *  half-water, one mountain, one snow and one sand cell, plus one placed tree. */
function fixtureMap() {
  const W = 6;
  const H = 4;
  const meadow = 0;
  const water = 1;
  const mountain = 2;
  const snow = 3;
  const sand = 4;
  const a = new Array<number>(W * H).fill(meadow);
  const b = new Array<number>(W * H).fill(meadow);
  a[1 * W + 1] = water; // both triangles water: the cell is impassable
  b[1 * W + 1] = water;
  a[1 * W + 2] = water; // half-water shoreline: triangle B is still land
  b[2 * W + 4] = mountain;
  a[0 * W + 4] = snow;
  a[3 * W + 1] = sand; // walk+build but no biocanplanton - the whole cell must reject the plough
  return parseTerrainMap({
    width: W,
    height: H,
    typeIds: new Array(W * H).fill(1), // the raw lane (ignored by the join - 1 = "void" ground)
    ground: { patterns: ['meadow 01', 'water 01', 'mountain 01', 'snow 01', 'sand 01'], a, b },
    objects: {
      types: ['tree deciduous 01'],
      // Two trees on the 2W×2H grid: one anchored on an EVEN half-cell row (4, 6) - stamped
      // verbatim - and one on an ODD row (8, 3), whose odd-dy rows take the parity shift.
      placements: [4, 6, 0, 8, 3, 0],
      levels: [3, 3],
    },
  });
}

const IR = {
  gfxPatterns: [
    { editName: 'meadow 01', logicType: 2 },
    { editName: 'water 01', logicType: 1 },
    { editName: 'mountain 01', logicType: 3 },
    { editName: 'snow 01', logicType: 7 },
    { editName: 'sand 01', logicType: 4 },
  ],
  // The real table's flag shapes: land walk+build+plant, water neither, mountain + snow walk-only,
  // sand walk+build but NOT plantable (`biocanplanton` belongs to land alone).
  trianglePatternTypes: [
    { type: 2, humanCanWalkOn: true, houseCanBeBuildOn: true, bioCanPlantOn: true },
    { type: 1, humanCanWalkOn: false, houseCanBeBuildOn: false },
    { type: 3, humanCanWalkOn: true, houseCanBeBuildOn: false },
    { type: 7, humanCanWalkOn: true, houseCanBeBuildOn: false },
    { type: 4, humanCanWalkOn: true, houseCanBeBuildOn: true },
  ],
  landscapeGfx: [
    {
      editName: 'tree deciduous 01',
      // Full state 3: a 1-node trunk body + a 3-node build ring row above it (the real rows' shape;
      // offsets are HALF-CELL offsets - even-row anchors stamp them verbatim, odd-row anchors
      // parity-shift the odd-dy rows, which the two placements below pin).
      walkBlockAreas: [
        [3, 0, 0, 1],
        [1, 2, 0, 1], // a LOWER state's row on a DIFFERENT node - the full-state collapse must drop it
      ],
      buildBlockAreas: [
        [3, -1, -1, 3],
        [3, -1, 0, 3],
      ],
    },
  ],
} satisfies CollisionIrView;

/** The bridge fixture's placement column: the west abutment. */
const BRIDGE_HX = 3;
/** The corridor's node row, and the placement's own (cell row 1's 2×2 block spans node rows 2..3).
 *  EVEN, so the parapet rows stamp verbatim - the parity shift has its own test above. */
const CORRIDOR_NODE_Y = 2;
/** The south parapet's node row: the bridge's walk body, one row off the corridor. */
const PARAPET_NODE_Y = 3;

/**
 * `specjalna_mosty_na_rzece` in miniature: two land banks split by a water column, crossed at cell
 * row 1 by the half-water cell the mapmaker painted under the bridge sprite. The bridge's walk area
 * is a parapet outline like the real records - two rails with the crossing corridor open between
 * them - so the crossing survives only when a half-water cell stays walkable.
 */
function bridgeMap() {
  const W = 5;
  const H = 3;
  const meadow = 0;
  const water = 1;
  const a = new Array<number>(W * H).fill(meadow);
  const b = new Array<number>(W * H).fill(meadow);
  for (const row of [0, 2]) {
    a[row * W + 2] = water;
    b[row * W + 2] = water;
  }
  a[1 * W + 2] = water; // the crossing cell: water on triangle A, land on B
  return parseTerrainMap({
    width: W,
    height: H,
    typeIds: new Array(W * H).fill(1),
    ground: { patterns: ['meadow 01', 'water 01'], a, b },
    objects: { types: ['bridge stone'], placements: [BRIDGE_HX, CORRIDOR_NODE_Y, 0], levels: [1] },
  });
}

const BRIDGE_IR = {
  gfxPatterns: IR.gfxPatterns,
  trianglePatternTypes: IR.trianglePatternTypes,
  landscapeGfx: [
    {
      editName: 'bridge stone',
      editGroups: ['misc_bridges'],
      // The two parapet rails (dy ±1), leaving the anchor's own row open - the hollow outline the
      // real `LogicWalkBlockArea` records draw. The build area covers the corridor as well.
      walkBlockAreas: [
        [1, 0, -1, 4],
        [1, 0, 1, 4],
      ],
      buildBlockAreas: [
        [1, 0, -1, 4],
        [1, 0, 0, 4],
        [1, 0, 1, 4],
      ],
    },
  ],
} satisfies CollisionIrView;

/** The minimum content a collision grid needs to become a graph: `buildTerrainGraph` resolves node
 *  typeIds through `landscape` alone, so the economy tables stay empty. */
function collisionContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'collision.test' } },
    goods: [],
    jobs: [],
    buildings: [],
    landscape: [...NAV_LANDSCAPE_TYPES],
  });
}

describe('buildCollisionTerrain', () => {
  // The join returns the sim's HALF-CELL grid (2W×2H nodes); `at` indexes NODE coordinates.
  const grid = buildCollisionTerrain(fixtureMap(), IR);
  const at = (x: number, y: number): number => {
    const v = grid.typeIds[y * grid.width + x];
    if (v === undefined) throw new Error(`(${x},${y}) out of the fixture grid`);
    return v;
  };

  it('classes plain meadow ground open, ignoring the raw landscape-lane typeIds', () => {
    expect(at(0, 0)).toBe(TERRAIN_OPEN);
    expect(at(11, 7)).toBe(TERRAIN_OPEN); // cell (5,3)'s far corner node
  });

  it('blocks a cell whose BOTH triangles are a no-walk ground class (water)', () => {
    // Water cell (1,1) stamps its whole 2×2 node block (2..3, 2..3).
    expect(at(2, 2)).toBe(TERRAIN_IMPASSABLE);
    expect(at(3, 3)).toBe(TERRAIN_IMPASSABLE);
  });

  it('keeps a half-water shoreline cell walkable but unbuildable', () => {
    // Cell (2,1) is water on triangle A, meadow on B: the original walks it (a walkable triangle
    // wins its node), and the build refusal stays conservative.
    expect(at(4, 2)).toBe(TERRAIN_MARGIN);
    expect(at(5, 3)).toBe(TERRAIN_MARGIN);
  });

  it('classes walkable-but-unbuildable ground (mountain, snow) as margin, not impassable', () => {
    expect(at(8, 4)).toBe(TERRAIN_MARGIN); // mountain cell (4,2), triangle B - walkable in the real table
    expect(at(8, 0)).toBe(TERRAIN_MARGIN); // snow cell (4,0), triangle A
  });

  it('classes walk+build ground with no biocanplanton (sand) as barren - open to all but the plough', () => {
    expect(at(2, 6)).toBe(TERRAIN_BARREN); // sand cell (1,3), triangle A - the whole cell rejects sowing
    expect(at(3, 7)).toBe(TERRAIN_BARREN);
  });

  it("stamps a placed object's full-state walk body as blocked and its build ring as margin", () => {
    expect(at(4, 6)).toBe(TERRAIN_BLOCKED); // the trunk at its anchor node (walk-block wins over its own build ring)
    expect(at(6, 6)).toBe(TERRAIN_OPEN); // the lower-state row's node (anchor+2) - collapsed away
    // The build-only ring nodes around it (dy=-1 row spans hx 3..5; dy=0 row spans hx 3,5).
    expect(at(3, 5)).toBe(TERRAIN_MARGIN);
    expect(at(4, 5)).toBe(TERRAIN_MARGIN);
    expect(at(5, 5)).toBe(TERRAIN_MARGIN);
    expect(at(3, 6)).toBe(TERRAIN_MARGIN);
    expect(at(5, 6)).toBe(TERRAIN_MARGIN);
  });

  it("shifts an odd-row anchor's odd-dy rows one node +x (the original lmwb parity rule)", () => {
    expect(at(8, 3)).toBe(TERRAIN_BLOCKED); // the trunk on its own anchor node (dy 0 - never shifts)
    // The dy=-1 build row (odd dy) spans dx -1..1 but stamps at hx 8..10, one node +x.
    expect(at(8, 2)).toBe(TERRAIN_MARGIN);
    expect(at(9, 2)).toBe(TERRAIN_MARGIN);
    expect(at(10, 2)).toBe(TERRAIN_MARGIN);
    expect(at(7, 2)).toBe(TERRAIN_OPEN); // where the unshifted stamp would have landed
    // The dy=0 build row (even dy) stays verbatim: hx 7 and 9 flank the trunk.
    expect(at(7, 3)).toBe(TERRAIN_MARGIN);
    expect(at(9, 3)).toBe(TERRAIN_MARGIN);
  });

  it('falls back to the pinned class split when the IR lacks the trianglePatternTypes lane', () => {
    const { trianglePatternTypes: _dropped, ...withoutLane } = IR;
    const g = buildCollisionTerrain(fixtureMap(), withoutLane);
    const gAt = (x: number, y: number): number => g.typeIds[y * g.width + x] as number;
    expect(gAt(2, 2)).toBe(TERRAIN_IMPASSABLE); // water on both triangles
    expect(gAt(4, 2)).toBe(TERRAIN_MARGIN); // half-water - still walkable under the fallback flags
    expect(gAt(8, 4)).toBe(TERRAIN_MARGIN); // mountain - the fallback pins the same real flags
    expect(gAt(8, 0)).toBe(TERRAIN_MARGIN); // snow
    expect(gAt(2, 6)).toBe(TERRAIN_BARREN); // sand - walk+build in the fallback too, still no plough
  });

  it('routes a crossing through the bridge corridor, not over its parapet', () => {
    const g = buildCollisionTerrain(bridgeMap(), BRIDGE_IR);
    const graph = buildTerrainGraph(collisionContent(), g);
    const componentAt = (x: number, y: number): number => graph.componentOf(graph.nodeAt(x, y));
    const nodeAt = (x: number, y: number): number => g.typeIds[y * g.width + x] as number;

    // The parapet is a walk body like any other object's: settlers do not stand on the rail.
    expect(nodeAt(BRIDGE_HX, PARAPET_NODE_Y)).toBe(TERRAIN_BLOCKED);
    // The corridor between the rails walks and refuses a building, over the half-water cell too.
    expect(nodeAt(BRIDGE_HX, CORRIDOR_NODE_Y)).toBe(TERRAIN_MARGIN);
    expect(nodeAt(BRIDGE_HX + 1, CORRIDOR_NODE_Y)).toBe(TERRAIN_MARGIN);

    // West bank and east bank are one component. Guarding the label against -1 first, or two
    // unwalkable banks would satisfy the equality vacuously.
    const westBank = componentAt(0, CORRIDOR_NODE_Y);
    expect(westBank).toBeGreaterThanOrEqual(0);
    expect(componentAt(g.width - 1, CORRIDOR_NODE_Y)).toBe(westBank);
  });

  it('degrades to all-open when the map carries no ground/object lanes', () => {
    const bare = parseTerrainMap({ width: 2, height: 2, typeIds: [1, 1, 1, 1] });
    const g = buildCollisionTerrain(bare, IR);
    // A 2×2-cell map yields a 4×4 all-open node grid.
    expect(g.width).toBe(4);
    expect(g.height).toBe(4);
    expect(g.typeIds).toEqual(new Array(16).fill(TERRAIN_OPEN));
  });
});
