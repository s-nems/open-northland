import { describe, expect, it } from 'vitest';
import {
  extractBuildingFootprints,
  extractConstructionCosts,
  parseIniSections,
} from '../src/decoders/ini.js';
import { HOUSES_INI } from './fixtures/ini-sources.js';

const GFXHOUSES_INI = `[GfxHouse]
EditName "wall"
LogicTribeType 1
LogicType 0 22
LogicConstructionGoods 0 3 3 26
GfxBobId 0 100
[GfxHouse]
EditName "viking home"
LogicTribeType 1
LogicType 0 2
LogicType 1 3
LogicConstructionGoods 0 5 5 2
LogicConstructionGoods 1 24 24
[GfxHouse]
EditName "headquarters"
LogicTribeType 1
LogicType 0 1
GfxBobId 0 200
`;

// The same logic typeIds (2, 3) recur for a HIGHER tribe with a DIFFERENT (cumulative) cost — the
// real data's per-(tribe, typeId) divergence. The lowest-tribeType record must win deterministically.
const GFXHOUSES_OTHER_TRIBE_INI = `[GfxHouse]
EditName "saracen residence"
LogicTribeType 4
LogicType 0 2
LogicType 1 3
LogicConstructionGoods 0 5 5 2 24 24
LogicConstructionGoods 1 5 5 2 24 24 26 26
`;

describe('extractConstructionCosts', () => {
  it('joins per-level LogicConstructionGoods onto typeId, run-length-encoding the good list', () => {
    const costs = extractConstructionCosts(parseIniSections(GFXHOUSES_INI));
    // wall: `3 3 26` -> 2x good 3 + 1x good 26
    expect(costs.get(22)).toEqual([
      { goodType: 3, amount: 2 },
      { goodType: 26, amount: 1 },
    ]);
    // home level 0 (typeId 2) and level 1 (typeId 3) each carry their OWN cost (not cumulative)
    expect(costs.get(2)).toEqual([
      { goodType: 5, amount: 2 },
      { goodType: 2, amount: 1 },
    ]);
    expect(costs.get(3)).toEqual([{ goodType: 24, amount: 2 }]);
    // headquarters has a LogicType but no LogicConstructionGoods -> no entry (free to start)
    expect(costs.has(1)).toBe(false);
  });

  it('collapses a per-(tribe, typeId) cost to the lowest-tribeType record (deterministic reference tribe)', () => {
    // viking (tribe 1) before saracen (tribe 4): the order in the parsed list must not matter.
    const costs = extractConstructionCosts(
      parseIniSections(`${GFXHOUSES_OTHER_TRIBE_INI}\n${GFXHOUSES_INI}`),
    );
    // tribe 1's cost wins for the shared typeIds even though tribe 4 was parsed first.
    expect(costs.get(2)).toEqual([
      { goodType: 5, amount: 2 },
      { goodType: 2, amount: 1 },
    ]);
    expect(costs.get(3)).toEqual([{ goodType: 24, amount: 2 }]);
  });

  it('collapses a typeId that maps to several sizeIdx within one record to the lowest sizeIdx (base stage)', () => {
    // Mirrors the real "viking pottery" (LogicType {1:21, 2:21}) and the multi-stage wonders: one
    // typeId at two sizeIdx, each with its OWN construction line. The lower sizeIdx (the first build
    // stage) must win deterministically regardless of which LogicConstructionGoods line is parsed first.
    const costs = extractConstructionCosts(
      parseIniSections(`[GfxHouse]
EditName "pottery"
LogicTribeType 1
LogicType 1 21
LogicType 2 21
LogicConstructionGoods 2 9 9 9
LogicConstructionGoods 1 3
`),
    );
    // sizeIdx 1 (`3`) wins over sizeIdx 2 (`9 9 9`), even though the size-2 line is parsed first.
    expect(costs.get(21)).toEqual([{ goodType: 3, amount: 1 }]);
  });

  it('returns an empty map for sources with no [GfxHouse] records (the logic-only tables)', () => {
    expect(extractConstructionCosts(parseIniSections(HOUSES_INI)).size).toBe(0);
  });
});

// Mirrors the real footprint grammar: `LogicBuildBlockArea <x> <y> <run>` (record-wide, NO level
// index), `LogicWalkBlockArea <sizeIdx> <x> <y> <run>` and `LogicDoorPoint <sizeIdx> <x> <y>` (per
// level). The two-level "hut" grows its walk-block between levels while the build zone stays fixed.
const GFXHOUSE_FOOTPRINT_INI = `[GfxHouse]
EditName "viking hut"
LogicTribeType 1
LogicType 0 2
LogicType 1 3
LogicBuildBlockArea -2 -1 4
LogicBuildBlockArea -2 0 5
LogicBuildBlockArea -1 1 3
LogicDoorPoint 0 -1 1
LogicDoorPoint 1 0 1
LogicWalkBlockArea 0 -1 -1 2
LogicWalkBlockArea 0 -1 0 3
LogicWalkBlockArea 1 -1 -1 3
LogicWalkBlockArea 1 -1 0 3
LogicWalkBlockArea 1 0 1 1
`;

describe('extractBuildingFootprints', () => {
  it('expands area runs, keys walk-block/door by level, and shares the build zone family-wide', () => {
    const footprints = extractBuildingFootprints(parseIniSections(GFXHOUSE_FOOTPRINT_INI));
    const level0 = footprints.get(2);
    const level1 = footprints.get(3);
    expect(level0).toBeDefined();
    expect(level1).toBeDefined();
    // Level 0's body: rows (-1,-1)x2 and (-1,0)x3, canonical (y then x) order.
    expect(level0?.blocked).toEqual([
      { dx: -1, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ]);
    // Level 1 grows: an extra cell in the -1 row and the (0,1) cell.
    expect(level1?.blocked).toContainEqual({ dx: 1, dy: -1 });
    expect(level1?.blocked).toContainEqual({ dx: 0, dy: 1 });
    // familyBody = union of BOTH levels' bodies — identical on every level's typeId.
    expect(level0?.familyBody).toEqual(level1?.familyBody);
    expect(level0?.familyBody).toContainEqual({ dx: 0, dy: 1 }); // level 1's growth, visible at level 0
    // reserved = familyBody ∪ the build zone (the level-independent exclusion ring).
    expect(level0?.reserved).toEqual(level1?.reserved);
    expect(level0?.reserved).toContainEqual({ dx: -2, dy: -1 }); // build-zone-only margin cell
    // Every family-body cell is reserved (the union keeps walk cells the build zone misses).
    for (const c of level0?.familyBody ?? []) expect(level0?.reserved).toContainEqual(c);
    // The door is per level.
    expect(level0?.door).toEqual({ dx: -1, dy: 1 });
    expect(level1?.door).toEqual({ dx: 0, dy: 1 });
  });

  it('collapses a per-(tribe, typeId) footprint to the lowest-tribeType record', () => {
    const otherTribe = `[GfxHouse]
EditName "saracen hut"
LogicTribeType 4
LogicType 0 2
LogicBuildBlockArea -9 -9 1
LogicWalkBlockArea 0 -9 -9 1
LogicDoorPoint 0 -9 -8
`;
    const footprints = extractBuildingFootprints(
      parseIniSections(`${otherTribe}\n${GFXHOUSE_FOOTPRINT_INI}`),
    );
    // tribe 1 wins even though tribe 4 was parsed first.
    expect(footprints.get(2)?.door).toEqual({ dx: -1, dy: 1 });
  });

  it('skips a record with no collision data and returns an empty map without [GfxHouse]', () => {
    const noAreas = `[GfxHouse]
EditName "cart"
LogicTribeType 1
LogicType 0 40
`;
    expect(extractBuildingFootprints(parseIniSections(noAreas)).size).toBe(0);
    expect(extractBuildingFootprints(parseIniSections(HOUSES_INI)).size).toBe(0);
  });
});

// Mirrors the real construction-layer grammar: `GfxBobConstructionLayer <sizeIdx> <upgrade> <bobId>
// <shadowBobId|-1> <fromPct> <toPct>`, joined to typeIds via `LogicType` and fanned out per palette.
