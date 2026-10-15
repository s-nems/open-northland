import { BuildingType, buildingFootprintFor } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStringCif } from '../../../packages/formats/test/fixtures/cif.js';
import { BASE_BUILDING_GRAPHICS_FILE, BUILDING_GRAPHICS_FILE } from '../src/data-layout.js';
import { resolveGraphicsBindings } from '../src/stages/bmd/bindings.js';
import { applyBuildingGraphicsOverlays } from '../src/stages/ir/building-overlays.js';
import { resolveIniSources } from '../src/stages/ir/sources.js';
import { extractIniTables } from '../src/stages/ir/tables.js';
import { type GameOutTemp, makeGameOutTemp } from './support/game-tree.js';

const SARACEN = 4;
const TENT = 2;
const PALACE = 7;

const RULE_TENT_BMD = 'data/bobs/rule_tent.bmd';
const BASE_TENT_BMD = 'data/bobs/base_tent.bmd';
const BASE_PALACE_BMD = 'data/bobs/base_palace.bmd';

/** One `[GfxHouse]` record's lines after its `EditName`, as the base table and the rule table share them. */
function houseLines(typeId: number, bmd: string, bobId: number, hitpoints = 20000): string[] {
  return [
    `LogicTribeType ${SARACEN}`,
    `LogicType 0 ${typeId}`,
    `logichitpoints 0 ${hitpoints}`,
    'LogicConstructionGoods 0 3 3',
    'LogicWalkBlockArea 0 0 0 2',
    'LogicDoorPoint 0 1 1',
    `GfxBobLibs "${bmd}"`,
    'GfxPalette "house01"',
    `GfxBobId 0 ${bobId}`,
    'GfxBobConstructionLayer 0 0 5 -1 0 100',
    'GfxFlagPoint 0 12 34',
  ];
}

function baseRecord(name: string, typeId: number, bmd: string, bobId: number, hitpoints?: number) {
  return [
    { level: 1, text: 'GfxHouse' },
    { level: 2, text: `EditName "${name}"` },
    ...houseLines(typeId, bmd, bobId, hitpoints).map((text) => ({ level: 2, text })),
  ];
}

describe('base-only houses', () => {
  let tree: GameOutTemp;

  beforeEach(async () => {
    tree = await makeGameOutTemp('base-houses');
    const rule = ['[GfxHouse]', 'EditName "saracen tent"', ...houseLines(TENT, RULE_TENT_BMD, 1), ''];
    await tree.write(BUILDING_GRAPHICS_FILE, new TextEncoder().encode(rule.join('\r\n')));
    await tree.write(
      BASE_BUILDING_GRAPHICS_FILE,
      buildStringCif([
        // The rule table defines this name with other art, so the base record must not surface.
        ...baseRecord('saracen tent', TENT, BASE_TENT_BMD, 9, 99),
        ...baseRecord('saracen palace', PALACE, BASE_PALACE_BMD, 3),
      ]),
    );
  });

  afterEach(async () => {
    await tree.cleanup();
  });

  it('adds the names only the base table defines, stamped base, while the rule row keeps its name', async () => {
    const roots = { data: tree.game };
    const tables = await extractIniTables(roots, await resolveIniSources(roots));

    expect(tables.buildingBobs.map((b) => [b.editName, b.bmd, b.source?.layer])).toEqual([
      ['saracen tent', RULE_TENT_BMD, 'mod'],
      ['saracen palace', BASE_PALACE_BMD, 'base'],
    ]);
    expect(tables.buildingBobs[1]?.source?.file).toBe(BASE_BUILDING_GRAPHICS_FILE);
    expect(tables.constructionLayers.map((l) => [l.editName, l.bmd])).toEqual([
      ['saracen tent', RULE_TENT_BMD],
      ['saracen palace', BASE_PALACE_BMD],
    ]);
    expect(tables.buildingFlagPoints.map((p) => [p.editName, p.typeId])).toEqual([
      ['saracen tent', TENT],
      ['saracen palace', PALACE],
    ]);

    const [tent, palace] = applyBuildingGraphicsOverlays(
      [
        BuildingType.parse({ typeId: TENT, id: 'tent', kind: 'home' }),
        BuildingType.parse({ typeId: PALACE, id: 'palace', kind: 'home' }),
      ],
      tables.buildingGraphicsOverlays,
    );
    expect(tent?.hitpoints).toBe(20000);
    expect(palace?.hitpoints).toBe(20000);
    expect(palace?.construction).toEqual([{ goodType: 3, amount: 2 }]);
    expect(palace && buildingFootprintFor(palace, SARACEN)?.door).toEqual({ dx: 1, dy: 1 });
  });

  it('binds and bakes the base-only art, never the base art of a ruled name', async () => {
    const { bindings, buildTimeBmds } = await resolveGraphicsBindings({ data: tree.game });
    const bmds = bindings.map((b) => b.bmd);
    expect(bmds).toContain(BASE_PALACE_BMD);
    expect(bmds).not.toContain(BASE_TENT_BMD);
    expect(buildTimeBmds.has(BASE_PALACE_BMD)).toBe(true);
  });
});
