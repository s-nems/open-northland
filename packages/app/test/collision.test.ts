import { parseTerrainMap } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { TERRAIN_BLOCKED, TERRAIN_IMPASSABLE, TERRAIN_MARGIN, TERRAIN_OPEN } from '../src/catalog/terrain.js';
import { buildCollisionTerrain } from '../src/content/collision.js';

/**
 * The decoded-map → sim collision join (content/collision.ts): synthetic fixtures shaped like the
 * real lanes (ground triangle patterns by name → logicType → the trianglepatterntypes walk/build
 * flags; object placements by name → the `[GfxLandscape]` walk/build areas), asserting each source
 * lands in its semantic terrain class.
 */

/** A 6×4 map: meadow ground except one water, one mountain and one snow cell, plus one placed tree. */
function fixtureMap() {
  const W = 6;
  const H = 4;
  const meadow = 0;
  const water = 1;
  const mountain = 2;
  const snow = 3;
  const a = new Array<number>(W * H).fill(meadow);
  const b = new Array<number>(W * H).fill(meadow);
  a[1 * W + 1] = water; // only triangle A is water — the whole cell must still block
  b[2 * W + 4] = mountain;
  a[0 * W + 4] = snow;
  return parseTerrainMap({
    width: W,
    height: H,
    typeIds: new Array(W * H).fill(1), // the raw lane (ignored by the join — 1 = "void" ground)
    ground: { patterns: ['meadow 01', 'water 01', 'mountain 01', 'snow 01'], a, b },
    objects: {
      types: ['tree deciduous 01'],
      // One tree anchored on cell (2, 3) (half-cell 4,6 → cell 2,3... rows: hy 6 → cell 3).
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
  ],
  // The real table's flag shapes: land walk+build, water neither, mountain + snow walk-only.
  trianglePatternTypes: [
    { type: 2, humanCanWalkOn: true, houseCanBeBuildOn: true },
    { type: 1, humanCanWalkOn: false, houseCanBeBuildOn: false },
    { type: 3, humanCanWalkOn: true, houseCanBeBuildOn: false },
    { type: 7, humanCanWalkOn: true, houseCanBeBuildOn: false },
  ],
  landscapeGfx: [
    {
      editName: 'tree deciduous 01',
      // Full state 3: a 1-cell trunk body + a 3-cell build ring row above it (the real rows' shape).
      walkBlockAreas: [
        [3, 0, 0, 1],
        [1, 2, 0, 1], // a LOWER state's row on a DIFFERENT cell — the full-state collapse must drop it
      ],
      buildBlockAreas: [
        [3, -1, -1, 3],
        [3, -1, 0, 3],
      ],
    },
  ],
};

describe('buildCollisionTerrain', () => {
  const grid = buildCollisionTerrain(fixtureMap(), IR);
  const at = (x: number, y: number): number => {
    const v = grid.typeIds[y * grid.width + x];
    if (v === undefined) throw new Error(`(${x},${y}) out of the fixture grid`);
    return v;
  };

  it('classes plain meadow ground open, ignoring the raw landscape-lane typeIds', () => {
    expect(at(0, 0)).toBe(TERRAIN_OPEN);
    expect(at(5, 3)).toBe(TERRAIN_OPEN);
  });

  it('blocks a cell when EITHER triangle is a no-walk ground class (water)', () => {
    expect(at(1, 1)).toBe(TERRAIN_IMPASSABLE); // water on triangle A only
  });

  it('classes walkable-but-unbuildable ground (mountain, snow) as margin, not impassable', () => {
    expect(at(4, 2)).toBe(TERRAIN_MARGIN); // mountain on triangle B — walkable in the real table
    expect(at(4, 0)).toBe(TERRAIN_MARGIN); // snow on triangle A
  });

  it("stamps a placed object's full-state walk body as blocked and its build ring as margin", () => {
    expect(at(2, 3)).toBe(TERRAIN_BLOCKED); // the trunk (walk-block wins over its own build ring)
    expect(at(4, 3)).toBe(TERRAIN_OPEN); // the lower-state row's cell (anchor+2) — collapsed away
    // The build-only ring cells around it (dy=-1 row spans x 1..3; dy=0 row spans x 1,3).
    expect(at(1, 2)).toBe(TERRAIN_MARGIN);
    expect(at(2, 2)).toBe(TERRAIN_MARGIN);
    expect(at(3, 2)).toBe(TERRAIN_MARGIN);
    expect(at(1, 3)).toBe(TERRAIN_MARGIN);
    expect(at(3, 3)).toBe(TERRAIN_MARGIN);
  });

  it('falls back to the pinned class split when the IR lacks the trianglePatternTypes lane', () => {
    const { trianglePatternTypes: _dropped, ...withoutLane } = IR;
    const g = buildCollisionTerrain(fixtureMap(), withoutLane);
    const gAt = (x: number, y: number): number => g.typeIds[y * g.width + x] as number;
    expect(gAt(1, 1)).toBe(TERRAIN_IMPASSABLE); // water
    expect(gAt(4, 2)).toBe(TERRAIN_MARGIN); // mountain — the fallback pins the same real flags
    expect(gAt(4, 0)).toBe(TERRAIN_MARGIN); // snow
  });

  it('degrades to all-open when the map carries no ground/object lanes', () => {
    const bare = parseTerrainMap({ width: 2, height: 2, typeIds: [1, 1, 1, 1] });
    const g = buildCollisionTerrain(bare, IR);
    expect(g.typeIds).toEqual([TERRAIN_OPEN, TERRAIN_OPEN, TERRAIN_OPEN, TERRAIN_OPEN]);
  });
});
