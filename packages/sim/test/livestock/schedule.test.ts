import { describe, expect, it } from 'vitest';
import { Health, Owner, Production, StayPoint } from '../../src/components/index.js';
import { LIVESTOCK_PROCESS_DRAIN_HP, LIVESTOCK_REGEN_HP_PER_TICK } from '../../src/systems/index.js';
import { SYSTEM_ORDER } from '../../src/systems/schedule.js';
import { breederAt, COW_HP, cowAt, ctxOf, farmAt, livestockSim, scoutAt, WATER, WHEAT } from './support.js';

/** The schedule's declared livestock slots, in order - the relationships the comments claim. */
const names = SYSTEM_ORDER.map((s) => s.name);

describe('livestock schedule relationships', () => {
  it('declares capture after the walk settles and regen before production', () => {
    expect(names.indexOf('separation')).toBeLessThan(names.indexOf('livestockCapture'));
    expect(names.indexOf('livestockCapture')).toBeLessThan(names.indexOf('livestockAssign'));
    expect(names.indexOf('livestockAssign')).toBeLessThan(names.indexOf('livestockRegen'));
    expect(names.indexOf('livestockRegen')).toBeLessThan(names.indexOf('production'));
  });

  it("regen tops an animal up before the same tick's feed gate reads its HP", () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 10, 10, {
      stock: [
        [WATER, 2],
        [WHEAT, 4],
      ],
    });
    breederAt(sim, 10, 10);
    // One regen tick short of the gate's floor (hp - drain >= max/2): only the declared order —
    // regen first, production after - lets this tick start the cycle.
    const cow = cowAt(sim, 12, 10, {
      owner: 0,
      hp: COW_HP / 2 + LIVESTOCK_PROCESS_DRAIN_HP - LIVESTOCK_REGEN_HP_PER_TICK,
    });

    const drives = SYSTEM_ORDER.filter((s) => s.name === 'livestockRegen' || s.name === 'production').map(
      (s) => s.system,
    );
    expect(drives).toHaveLength(2);
    for (const drive of drives) drive(sim.world, ctxOf(sim));

    expect(sim.world.get(farm, Production).cycles).toHaveLength(1);
    expect(sim.world.get(cow, Health).hitpoints).toBe(COW_HP / 2);
  });

  it("a contact claim re-anchors onto the player's farm in the same tick", () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: 0 });
    const cow = cowAt(sim, 11, 10);
    // The scout stands in contact; capture then assignment run in their declared order at tick 0.
    scoutAt(sim, 10, 10, 0);

    const drives = SYSTEM_ORDER.filter(
      (s) => s.name === 'livestockCapture' || s.name === 'livestockAssign',
    ).map((s) => s.system);
    expect(drives).toHaveLength(2);
    for (const drive of drives) drive(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(cow, Owner)?.player).toBe(0);
    const terrain = sim.terrain;
    expect(terrain).toBeDefined();
    expect(sim.world.tryGet(cow, StayPoint)?.cell).toBe(terrain?.nodeAt(20, 20));
  });
});
