import type { BuildingType, ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { createKnowledgeBase, type KnowledgeBase } from '../../../src/hud/knowledge/base.js';
import { materialBuildings, totalCost } from '../../../src/hud/knowledge/build-cost.js';
import { FRANK, GOOD, HOUSE, knowledgeContent, VIKING } from '../../support/knowledge-content.js';

const FLOUR = { goodType: GOOD.flour, amount: 1 };
const MILL_TICKS = 10;

/** The mill upgrades to the bakery and both mill flour; the druid upgrades to the smithy. */
function linkedBase(vikingHouses: readonly number[]): KnowledgeBase {
  const content = knowledgeContent();
  const edit = (row: BuildingType): BuildingType => {
    switch (row.typeId) {
      case HOUSE.mill:
        return { ...row, upgradeTarget: HOUSE.bakery };
      case HOUSE.bakery:
        return { ...row, recipes: [...row.recipes, { inputs: [], outputs: [FLOUR], ticks: MILL_TICKS }] };
      case HOUSE.druid:
        return {
          ...row,
          upgradeTarget: HOUSE.smithy,
          construction: [
            { goodType: GOOD.wood, amount: 2 },
            { goodType: GOOD.flour, amount: 1 },
          ],
        };
      case HOUSE.smithy:
        return {
          ...row,
          construction: [
            { goodType: GOOD.wood, amount: 3 },
            { goodType: GOOD.bread, amount: 1 },
            { goodType: GOOD.water, amount: 1 },
          ],
        };
      default:
        return row;
    }
  };
  const tribes = content.tribes.map((tribe) =>
    tribe.typeId === VIKING && tribe.permissions !== undefined
      ? { ...tribe, permissions: { ...tribe.permissions, house: [...vikingHouses] } }
      : tribe,
  );
  const edited: ContentSet = { ...content, buildings: content.buildings.map(edit), tribes };
  return createKnowledgeBase(edited);
}

function house(base: KnowledgeBase, typeId: number) {
  const row = base.buildingByType.get(typeId);
  if (row === undefined) throw new Error(`fixture has house ${typeId}`);
  return row;
}

const ids = (rows: readonly { readonly id: string }[]) => rows.map((row) => row.id);

describe('total cost', () => {
  it('sums the line up to the level, merged per good', () => {
    const base = linkedBase([]);
    expect(totalCost(base, house(base, HOUSE.smithy))).toEqual([
      { goodType: GOOD.wood, amount: 5 },
      { goodType: GOOD.flour, amount: 1 },
      { goodType: GOOD.bread, amount: 1 },
      { goodType: GOOD.water, amount: 1 },
    ]);
    expect(totalCost(base, house(base, HOUSE.druid))).toEqual(house(base, HOUSE.druid).cost);
  });
});

describe('material buildings', () => {
  it('names the lowest level that makes each made good and nothing for a gathered one', () => {
    const base = linkedBase([]);
    expect(ids(materialBuildings(base, house(base, HOUSE.druid), FRANK))).toEqual(['work_mill_00']);
    expect(ids(materialBuildings(base, house(base, HOUSE.smithy), FRANK))).toEqual([
      'work_bakery_00',
      'work_well_00',
    ]);
  });

  it('names only the higher level when a line makes goods at two levels', () => {
    const base = linkedBase([]);
    const both = { ...house(base, HOUSE.smithy), cost: [FLOUR, { goodType: GOOD.bread, amount: 1 }] };
    expect(ids(materialBuildings(base, both, FRANK))).toEqual(['work_bakery_00']);
  });

  it("skips the building's own line", () => {
    const base = linkedBase([]);
    const bakery = { ...house(base, HOUSE.bakery), cost: [FLOUR] };
    expect(materialBuildings(base, bakery, FRANK)).toEqual([]);
  });

  it("keeps to the houses the reader's tribe may raise", () => {
    const base = linkedBase([HOUSE.well]);
    expect(ids(materialBuildings(base, house(base, HOUSE.smithy), VIKING))).toEqual(['work_well_00']);
  });
});
