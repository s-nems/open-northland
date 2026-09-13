import type { ContentSet } from './schema/index.js';

/** Source-name bindings for the original house discovery side effects; goods remain catalog IDs. */
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
