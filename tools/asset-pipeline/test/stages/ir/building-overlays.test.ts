import {
  BuildingType,
  buildingFootprintFor,
  buildingHitpointsFor,
  houseRecordsFor,
} from '@open-northland/data';
import {
  extractBuildingFootprints,
  extractHouseHitpoints,
  extractRecordFootprints,
  parseIniSections,
  type RecordFootprint,
} from '@open-northland/formats/ini';
import { describe, expect, it } from 'vitest';
import {
  applyBuildingGraphicsOverlays,
  fillBaseRecordFootprints,
} from '../../../src/stages/ir/building-overlays.js';

const VIKING = 1;
const FRANK = 2;
const SARACEN = 4;
const HUT = 2;

// One typeId three tribes describe: a longhouse, a frank house with its own body but no hitpoints line,
// and a saracen tent with both.
const HUTS_INI = `[GfxHouse]
EditName "viking hut"
LogicTribeType 1
LogicType 0 2
LogicWalkBlockArea 0 0 0 3
LogicDoorPoint 0 1 1
logichitpoints 0 30000
[GfxHouse]
EditName "saracen tent"
LogicTribeType 4
LogicType 0 2
LogicWalkBlockArea 0 0 0 1
LogicDoorPoint 0 0 1
logichitpoints 0 20000
[GfxHouse]
EditName "frank hut"
LogicTribeType 2
LogicType 0 2
LogicWalkBlockArea 0 -1 0 2
[GfxHouse]
EditName "viking hall"
LogicTribeType 1
LogicType 0 2
LogicWalkBlockArea 0 0 0 1
LogicDoorPoint 0 0 1
[GfxHouse]
EditName "viking hut copy"
LogicTribeType 1
LogicType 0 2
LogicWalkBlockArea 0 0 0 3
LogicDoorPoint 0 1 1
`;

function joinedHut(): BuildingType {
  const sections = parseIniSections(HUTS_INI);
  const [hut] = applyBuildingGraphicsOverlays(
    [BuildingType.parse({ typeId: HUT, id: 'hut', kind: 'home' })],
    {
      constructionCosts: new Map(),
      hitpoints: extractHouseHitpoints(sections),
      upgradeTargets: new Map(),
      footprints: extractBuildingFootprints(sections),
      recordFootprints: extractRecordFootprints(sections),
    },
  );
  if (hut === undefined) throw new Error('the join dropped the building');
  return BuildingType.parse(hut);
}

describe('applyBuildingGraphicsOverlays', () => {
  it("puts the lowest tribe's values on the type and every other tribe's in its variants", () => {
    const hut = joinedHut();
    expect(hut.hitpoints).toBe(30000);
    expect(hut.footprint?.door).toEqual({ dx: 1, dy: 1 });
    expect(hut.tribeVariants.map((v) => v.tribe)).toEqual([FRANK, SARACEN]);
    expect(hut.tribeVariants[0]?.hitpoints).toBeUndefined();
  });

  it("resolves each tribe's own values, falling back to the lowest tribe's where a tribe has none", () => {
    const hut = joinedHut();
    expect(buildingFootprintFor(hut, SARACEN)?.blocked).toEqual([{ dx: 0, dy: 0 }]);
    expect(buildingFootprintFor(hut, FRANK)?.blocked).toEqual([
      { dx: -1, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
    expect(buildingFootprintFor(hut, VIKING)).toEqual(hut.footprint);
    expect(buildingHitpointsFor(hut, SARACEN)).toBe(20000);
    expect(buildingHitpointsFor(hut, FRANK)).toBe(30000);
    expect(buildingHitpointsFor(hut, undefined)).toBe(30000);
  });

  it('keeps a named record of the same tribe that stands on another footprint', () => {
    const hut = joinedHut();
    // The copy stands on the default footprint, so only the hall is kept.
    expect(hut.recordFootprints.map((r) => r.editName)).toEqual(['viking hall']);
    expect(buildingFootprintFor(hut, VIKING, 'viking hall')?.blocked).toEqual([{ dx: 0, dy: 0 }]);
    expect(buildingFootprintFor(hut, VIKING, 'viking hut copy')).toEqual(hut.footprint);
    expect(buildingFootprintFor(hut, FRANK, 'viking hall')).toEqual(buildingFootprintFor(hut, FRANK));
    expect(houseRecordsFor(hut, VIKING)).toEqual(['viking hall']);
  });

  it("keeps a base-only record for the maps that name it, off a placement's choice", () => {
    const sections = parseIniSections(HUTS_INI);
    const baseOnly = new Map<number, RecordFootprint[]>();
    fillBaseRecordFootprints(baseOnly, extractRecordFootprints(sections));
    const [hut] = applyBuildingGraphicsOverlays(
      [BuildingType.parse({ typeId: HUT, id: 'hut', kind: 'home' })],
      {
        constructionCosts: new Map(),
        hitpoints: new Map(),
        upgradeTargets: new Map(),
        footprints: extractBuildingFootprints(sections),
        recordFootprints: baseOnly,
      },
    );
    if (hut === undefined) throw new Error('the join dropped the building');
    const parsed = BuildingType.parse(hut);
    expect(parsed.recordFootprints.map((r) => [r.editName, r.mapOnly])).toEqual([['viking hall', true]]);
    expect(buildingFootprintFor(parsed, VIKING, 'viking hall')?.blocked).toEqual([{ dx: 0, dy: 0 }]);
    expect(houseRecordsFor(parsed, VIKING)).toEqual([]);
  });

  it('leaves a record the game table defines on offer when the base table repeats it', () => {
    const rows = extractRecordFootprints(parseIniSections(HUTS_INI));
    const ruleRecords = new Map([...rows].map(([typeId, records]) => [typeId, [...records]]));
    fillBaseRecordFootprints(ruleRecords, rows);
    const joined = [...ruleRecords.values()].flat();
    expect(joined).toHaveLength([...rows.values()].flat().length);
    expect(joined.some((record) => record.mapOnly === true)).toBe(false);
  });
});
