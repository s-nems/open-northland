import type { GoodQuantity } from '@open-northland/data';
import { producersOf, recipesOf } from './chains.js';
import { levelChain } from './entry-blocks.js';
import type { KnowledgeBase, KnowledgeBuilding } from './model.js';

/** What the whole line costs from its first level through `building`, merged per good in first-seen order. */
export function totalCost(base: KnowledgeBase, building: KnowledgeBuilding): readonly GoodQuantity[] {
  const line = levelChain(base, building);
  const through = line.slice(0, line.findIndex((level) => level.typeId === building.typeId) + 1);
  const amounts = new Map<number, number>();
  for (const level of through) {
    for (const { goodType, amount } of level.cost) {
      amounts.set(goodType, (amounts.get(goodType) ?? 0) + amount);
    }
  }
  return [...amounts].map(([goodType, amount]) => ({ goodType, amount }));
}

/** The houses `tribe` may raise; a tribe with no permission table may raise them all. */
function permittedHouse(base: KnowledgeBase, tribe: number): (building: KnowledgeBuilding) => boolean {
  const houses = base.content.tribes.find((t) => t.typeId === tribe)?.permissions?.house;
  if (houses === undefined) return () => true;
  const allowed = new Set(houses);
  return (building) => allowed.has(building.typeId);
}

/** The houses that make a good: its recipes' houses, else the ones that fill it with no recipe. A gathered
 *  good has neither. */
function makersOf(base: KnowledgeBase, goodType: number): readonly KnowledgeBuilding[] {
  const crafted = recipesOf(base, goodType).map((source) => source.building);
  return crafted.length > 0 ? crafted : producersOf(base, goodType);
}

interface LineLevel {
  readonly house: KnowledgeBuilding;
  readonly level: number;
}

/**
 * The houses `tribe` needs standing to make `building`'s own construction goods: the lowest level of each
 * upgrade line that makes a good, raised to the highest level any good of that line asks for, since an
 * upgraded house keeps making what its lower levels made.
 */
export function materialBuildings(
  base: KnowledgeBase,
  building: KnowledgeBuilding,
  tribe: number,
): readonly KnowledgeBuilding[] {
  const permitted = permittedHouse(base, tribe);
  // The building's own line is already named by its upgrade.
  const ownLine = new Set(levelChain(base, building).map((level) => level.typeId));
  const byLine = new Map<number, LineLevel>();
  for (const { goodType } of building.cost) {
    const lowestByLine = new Map<number, LineLevel>();
    for (const house of makersOf(base, goodType)) {
      if (ownLine.has(house.typeId) || !permitted(house)) continue;
      const line = levelChain(base, house);
      const root = line[0]?.typeId ?? house.typeId;
      const level = line.findIndex((row) => row.typeId === house.typeId);
      const held = lowestByLine.get(root);
      if (held === undefined || level < held.level) lowestByLine.set(root, { house, level });
    }
    for (const [root, lowest] of lowestByLine) {
      const held = byLine.get(root);
      if (held === undefined || lowest.level > held.level) byLine.set(root, lowest);
    }
  }
  return [...byLine.values()].map((entry) => entry.house);
}
