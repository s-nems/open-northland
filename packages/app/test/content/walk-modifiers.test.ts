import { components, fx, halfCellMapFromCells, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../src/catalog/buildings.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

describe.runIf(hasRealIr())('real-content human walking', () => {
  it('preserves engine tribe/job reductions through the runtime merge', async () => {
    const { real, merge } = await loadContentUnderTest();
    for (const content of [real, merge.content]) {
      expect(content.tribes.find((t) => t.typeId === 3)?.walkStepReduction).toEqual({
        ticks: 2,
        jobType: 32,
      });
      expect(content.tribes.find((t) => t.typeId === 7)?.walkStepReduction).toEqual({ ticks: 2 });
      expect(content.tribes.find((t) => t.typeId === 1)?.walkStepReduction).toBeUndefined();
    }
  });

  it.each([false, true])(
    'does not confuse saber/sword weights (explicit weapon class: %s)',
    async (explicit) => {
      const {
        merge: { content },
      } = await loadContentUnderTest();
      const sim = new Simulation({ seed: 1, content, map: halfCellMapFromCells(grassTerrain(4, 2)) });
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('walk fixture requires terrain');
      const e = sim.world.create();
      components.addPerson(sim.world, e, {
        tribe: 1,
        jobType: 37,
        hunger: fx.fromInt(0),
        fatigue: fx.fromInt(0),
        piety: fx.fromInt(0),
        enjoyment: fx.fromInt(0),
      });
      sim.world.add(e, components.Equipment, {
        weapon: { goodType: 42, degreeOfUse: fx.fromInt(0) },
        armor: null,
        boots: null,
        tool: null,
        misc: [null, null, null, null],
      });
      if (explicit) sim.world.add(e, components.Weapon, { weaponTypeId: 11 });
      sim.world.add(e, components.Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
      sim.world.add(e, components.PathRoute, {
        waypoints: [
          { x: fx.fromInt(0), y: fx.fromInt(0), node: terrain.nodeAtClamped(0, 0) },
          { x: fx.fromFloat(0.5), y: fx.fromInt(0), node: terrain.nodeAtClamped(1, 0) },
        ],
      });
      sim.world.add(e, components.PathFollow, { index: 1, legCost: 0, legTicks: 0 });
      sim.step();
      expect(sim.world.get(e, components.PathFollow).legCost).toBe(8);
    },
  );
});
