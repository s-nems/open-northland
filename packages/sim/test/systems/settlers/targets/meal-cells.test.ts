import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { BerryBush, Building, Position, Stockpile } from '../../../../src/components/index.js';
import { GENERATION_JOURNAL_LIMIT } from '../../../../src/ecs/generation-journal.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { ONE, positionOfNode, Simulation } from '../../../../src/index.js';
import { ACCEPT_ALL } from '../../../../src/systems/settlers/targets/cell-index.js';
import { mealCells } from '../../../../src/systems/settlers/targets/meal-cells.js';
import { testContent } from '../../../fixtures/content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';

const FOOD = 3;
const STORE = 90;
const OTHER_STORE = 91;
const footprint = (dx: number) => ({ blocked: [], door: { dx, dy: 0 } });

function fixture() {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    tribes: [...base.tribes, { typeId: 7, id: 'meal_test_tribe' }],
    buildings: [
      ...base.buildings,
      {
        typeId: STORE,
        id: 'meal_store',
        kind: 'storage',
        footprint: footprint(-4),
        tribeVariants: [{ tribe: 7, footprint: footprint(4) }],
      },
      { typeId: OTHER_STORE, id: 'other_meal_store', kind: 'storage', footprint: footprint(6) },
    ],
  });
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(40, 12) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture terrain missing');
  const add = (kind: 'stock' | 'ripe' | 'bare', x: number): Entity => {
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(x, 6));
    if (kind === 'stock') sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, 1]]) });
    else sim.world.add(e, BerryBush, { stage: kind });
    return e;
  };
  const index = () => mealCells(sim.world, content, terrain);
  const nearest = () => index().nearest(terrain.nodeAt(2, 6), ACCEPT_ALL);
  return { sim, terrain, add, index, nearest };
}

describe('meal index maintenance', () => {
  it('does not visit bare bushes during repeated empty meal searches', () => {
    const { sim, terrain, add, index } = fixture();
    for (let i = 0; i < 80; i++) add('bare', 4 + (i % 30));
    const ripening = add('bare', 6);
    let visits = 0;
    const search = () =>
      index().nearest(terrain.nodeAt(2, 6), () => {
        visits++;
        return { payload: null };
      });
    expect(search()).toBeNull();
    expect(search()).toBeNull();
    expect(visits).toBe(0);
    sim.world.mut(ripening, BerryBush).stage = 'ripe';
    expect(search()?.entity).toBe(ripening);
    sim.world.mut(ripening, BerryBush).stage = 'bare';
    visits = 0;
    expect(search()).toBeNull();
    expect(visits).toBe(0);
  });

  it.each(['membership', 'values'] as const)(
    'rebuilds both source kinds after a %s journal gap',
    (journal) => {
      const { sim, terrain, add, index, nearest } = fixture();
      const stock = add('stock', 10);
      const eatenBush = add('ripe', 4);
      const ripeningBush = add('bare', 6);
      const removed = add('stock', 12);
      expect(nearest()?.entity).toBe(eatenBush);

      sim.world.mut(eatenBush, BerryBush).stage = 'bare';
      sim.world.mut(ripeningBush, BerryBush).stage = 'ripe';
      sim.world.destroy(removed);
      const fresh = add('stock', 14);
      for (let i = 0; i <= GENERATION_JOURNAL_LIMIT; i++) {
        if (journal === 'membership') sim.world.add(stock, Position, positionOfNode(20 + (i % 2), 6));
        else sim.world.mut(ripeningBush, BerryBush).gfxIndex = i;
      }

      expect(nearest()?.entity).toBe(ripeningBush);
      const current = index();
      const find = (entity: Entity) =>
        current.nearest(terrain.nodeAt(2, 6), (e) => (e === entity ? { payload: null } : null));
      expect(find(stock)?.cell).toBe(terrain.nodeAt(journal === 'membership' ? 20 : 10, 6));
      expect(find(fresh)?.entity).toBe(fresh);
      expect(find(eatenBush)).toBeNull();
      expect(find(removed)).toBeNull();
      expect(sim.world.verifyCaches()).toEqual([]);
    },
  );

  it('reranks a stocked building when its tribe or type moves the entrance', () => {
    const { sim, terrain, add, nearest } = fixture();
    const store = add('stock', 12);
    sim.world.add(store, Building, { buildingType: STORE, tribe: 1, built: ONE, level: 0 });
    const bush = add('ripe', 10);
    expect(nearest()).toMatchObject({ entity: store, cell: terrain.nodeAt(8, 6), distance: 6 });
    sim.world.mut(store, Building).tribe = 7;
    expect(nearest()?.entity).toBe(bush);
    sim.world.mut(store, Building).tribe = 1;
    expect(nearest()?.entity).toBe(store);
    sim.world.mut(store, Building).buildingType = OTHER_STORE;
    expect(nearest()?.entity).toBe(bush);
    sim.world.remove(store, Building);
    expect(nearest()?.entity).toBe(bush);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
