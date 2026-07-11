import { parseTerrainMap } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import {
  TERRAIN_BARREN,
  TERRAIN_BLOCKED,
  TERRAIN_IMPASSABLE,
  TERRAIN_MARGIN,
  TERRAIN_OPEN,
} from '../src/catalog/terrain.js';
import { buildCollisionTerrain } from '../src/content/collision.js';

/**
 * The decoded-map → sim collision join (content/collision.ts): synthetic fixtures shaped like the
 * real lanes (ground triangle patterns by name → logicType → the trianglepatterntypes walk/build
 * flags; object placements by name → the `[GfxLandscape]` walk/build areas), asserting each source
 * lands in its semantic terrain class.
 */

/** A 6×4-cell map (a 12×8 half-cell collision grid): meadow ground except one water, one mountain,
 *  one snow and one sand cell, plus one placed tree. */
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
  a[1 * W + 1] = water; // only triangle A is water — the whole cell must still block
  b[2 * W + 4] = mountain;
  a[0 * W + 4] = snow;
  a[3 * W + 1] = sand; // walk+build but no biocanplanton — the whole cell must reject the plough
  return parseTerrainMap({
    width: W,
    height: H,
    typeIds: new Array(W * H).fill(1), // the raw lane (ignored by the join — 1 = "void" ground)
    ground: { patterns: ['meadow 01', 'water 01', 'mountain 01', 'snow 01', 'sand 01'], a, b },
    objects: {
      types: ['tree deciduous 01'],
      // One tree anchored at half-cell node (4, 6) — stamped VERBATIM on the 2W×2H grid.
      placements: [4, 6, 0],
      levels: [3],
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
      // offsets are HALF-CELL offsets, applied verbatim to the anchor node).
      walkBlockAreas: [
        [3, 0, 0, 1],
        [1, 2, 0, 1], // a LOWER state's row on a DIFFERENT node — the full-state collapse must drop it
      ],
      buildBlockAreas: [
        [3, -1, -1, 3],
        [3, -1, 0, 3],
      ],
    },
  ],
};

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

  it('blocks a cell when EITHER triangle is a no-walk ground class (water)', () => {
    // Water cell (1,1) stamps its whole 2×2 node block (2..3, 2..3).
    expect(at(2, 2)).toBe(TERRAIN_IMPASSABLE); // water on triangle A only
    expect(at(3, 3)).toBe(TERRAIN_IMPASSABLE);
  });

  it('classes walkable-but-unbuildable ground (mountain, snow) as margin, not impassable', () => {
    expect(at(8, 4)).toBe(TERRAIN_MARGIN); // mountain cell (4,2), triangle B — walkable in the real table
    expect(at(8, 0)).toBe(TERRAIN_MARGIN); // snow cell (4,0), triangle A
  });

  it('classes walk+build ground with no biocanplanton (sand) as barren — open to all but the plough', () => {
    expect(at(2, 6)).toBe(TERRAIN_BARREN); // sand cell (1,3), triangle A — the whole cell rejects sowing
    expect(at(3, 7)).toBe(TERRAIN_BARREN);
  });

  it("stamps a placed object's full-state walk body as blocked and its build ring as margin", () => {
    expect(at(4, 6)).toBe(TERRAIN_BLOCKED); // the trunk at its anchor node (walk-block wins over its own build ring)
    expect(at(6, 6)).toBe(TERRAIN_OPEN); // the lower-state row's node (anchor+2) — collapsed away
    // The build-only ring nodes around it (dy=-1 row spans hx 3..5; dy=0 row spans hx 3,5).
    expect(at(3, 5)).toBe(TERRAIN_MARGIN);
    expect(at(4, 5)).toBe(TERRAIN_MARGIN);
    expect(at(5, 5)).toBe(TERRAIN_MARGIN);
    expect(at(3, 6)).toBe(TERRAIN_MARGIN);
    expect(at(5, 6)).toBe(TERRAIN_MARGIN);
  });

  it('falls back to the pinned class split when the IR lacks the trianglePatternTypes lane', () => {
    const { trianglePatternTypes: _dropped, ...withoutLane } = IR;
    const g = buildCollisionTerrain(fixtureMap(), withoutLane);
    const gAt = (x: number, y: number): number => g.typeIds[y * g.width + x] as number;
    expect(gAt(2, 2)).toBe(TERRAIN_IMPASSABLE); // water
    expect(gAt(8, 4)).toBe(TERRAIN_MARGIN); // mountain — the fallback pins the same real flags
    expect(gAt(8, 0)).toBe(TERRAIN_MARGIN); // snow
    expect(gAt(2, 6)).toBe(TERRAIN_BARREN); // sand — walk+build in the fallback too, still no plough
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
