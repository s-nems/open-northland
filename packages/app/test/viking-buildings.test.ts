import { describe, expect, it } from 'vitest';
import {
  findVikingBuildings,
  resolveVikingBuilding,
  VIKING_BUILDINGS,
  vikingBuildingById,
  vikingBuildingByTypeId,
} from '../src/catalog/buildings.js';

/**
 * The committed viking-building catalog is the single source of truth for name → typeId — its pure
 * shape and lookup contract, self-verifiable on any checkout. The pin back to the pipeline's real
 * output (id + kind match, bound viking bobs) lives in the real-content suite
 * (`test/content/viking-buildings.test.ts`).
 */

describe('viking building catalog', () => {
  it('has a unique typeId and id per entry', () => {
    expect(new Set(VIKING_BUILDINGS.map((b) => b.typeId)).size).toBe(VIKING_BUILDINGS.length);
    expect(new Set(VIKING_BUILDINGS.map((b) => b.id)).size).toBe(VIKING_BUILDINGS.length);
  });
});

describe('viking building lookups', () => {
  it('resolves a building by its exact id and typeId', () => {
    expect(vikingBuildingById('stock_02')?.typeId).toBe(9);
    expect(vikingBuildingByTypeId(9)?.id).toBe('stock_02');
    expect(vikingBuildingById('does_not_exist')).toBeUndefined();
  });

  it('finds buildings by a fuzzy id/label query (the "warehouse level 2" use case)', () => {
    // The label carries the human synonym ("Warehouse"), so a search the game/user would type resolves the
    // three stocks even though the machine ids say "stock_*".
    const warehouses = findVikingBuildings('warehouse');
    expect(warehouses.map((b) => b.id)).toEqual(['stock_00', 'stock_01', 'stock_02']);
    expect(findVikingBuildings('temple').map((b) => b.typeId)).toEqual([37]);
  });

  it('resolves by id or typeId and throws on an unknown ref', () => {
    expect(resolveVikingBuilding('headquarters').typeId).toBe(1);
    expect(resolveVikingBuilding(1).id).toBe('headquarters');
    expect(() => resolveVikingBuilding('nope')).toThrow();
    expect(() => resolveVikingBuilding(999)).toThrow();
  });
});
