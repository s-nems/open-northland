import type { ContentSet } from './schema/index.js';

/** The goods a house's discovery also discovers, which the original fixes by house type (reading of
 *  `EnableHouse`: well, hive and animal farm), bound here by catalog name. */
const HOUSE_DISCOVERY_GOODS: Readonly<Record<string, readonly string[]>> = {
  work_well_00: ['water'],
  work_hive_00: ['honey'],
  work_animal_farm: ['meat', 'leather', 'wool'],
};

export function houseDiscoveryGoods(content: ContentSet, houseType: number): readonly number[] {
  const house = content.buildings.find((row) => row.typeId === houseType);
  const names = house === undefined ? undefined : HOUSE_DISCOVERY_GOODS[house.id];
  if (names === undefined) return [];
  return content.goods.filter((good) => names.includes(good.id)).map((good) => good.typeId);
}
