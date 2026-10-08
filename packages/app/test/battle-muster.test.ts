import { components, nodeOfPosition } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { battleScene } from '../src/scenes/battle.js';
import { createSceneSim } from '../src/scenes/runtime.js';

it('musters 1000 per side with mixed weapons, armor, distinct positions and orders for every fighter', () => {
  const sim = createSceneSim(battleScene);
  const occupied = new Set<string>();
  for (const owner of [0, 1]) {
    const jobs = new Map<number | null, number>();
    const armor = new Map<number | null, number>();
    const pairings = new Set<string>();
    const columns = new Map<number, Set<number | null>>();
    let count = 0;
    for (const e of sim.world.query(components.Settler, components.Owner, components.Equipment)) {
      if (sim.world.get(e, components.Owner).player !== owner) continue;
      count++;
      const job = sim.world.get(e, components.Settler).jobType;
      const equipment = sim.world.get(e, components.Equipment);
      expect(equipment.weapon).not.toBeNull();
      const worn = equipment.armor?.goodType ?? null;
      jobs.set(job, (jobs.get(job) ?? 0) + 1);
      armor.set(worn, (armor.get(worn) ?? 0) + 1);
      pairings.add(`${job}:${worn}`);
      const pos = sim.world.get(e, components.Position);
      const { hx, hy } = nodeOfPosition(pos.x, pos.y);
      occupied.add(`${hx},${hy}`);
      const column = columns.get(hx) ?? new Set();
      column.add(job);
      columns.set(hx, column);
    }
    expect(count).toBe(1000);
    expect([...jobs.values()]).toEqual([200, 200, 200, 200, 200]);
    expect([...armor.values()]).toEqual([200, 200, 200, 200, 200]);
    expect(pairings.size).toBe(25);
    expect([...columns.values()].filter((jobs) => jobs.size > 1).length).toBeGreaterThan(columns.size * 0.9);
  }
  expect(occupied.size).toBe(2000);
  sim.step();
  const ordered = [...sim.world.query(components.PlayerOrder)].filter(
    (e) => sim.world.get(e, components.PlayerOrder).attackMove !== null,
  );
  expect(ordered).toHaveLength(2000);
});
