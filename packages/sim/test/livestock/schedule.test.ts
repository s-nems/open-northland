import { describe, expect, it } from 'vitest';
import { FarmAnimal, MoveGoal, Owner, StayPoint } from '../../src/components/index.js';
import { SYSTEM_ORDER } from '../../src/systems/schedule.js';
import { breederAt, cowAt, ctxOf, farmAt, livestockSim, scoutAt } from './support.js';

/** The schedule's declared livestock slots, in order - the relationships the comments claim. */
const names = SYSTEM_ORDER.map((s) => s.name);

describe('livestock schedule relationships', () => {
  it('declares the claim after the walk settles, then the herd sweep, growth, and the summon', () => {
    expect(names.indexOf('separation')).toBeLessThan(names.indexOf('livestockCapture'));
    expect(names.indexOf('livestockCapture')).toBeLessThan(names.indexOf('livestockAssign'));
    expect(names.indexOf('livestockAssign')).toBeLessThan(names.indexOf('livestockGrowth'));
    expect(names.indexOf('livestockGrowth')).toBeLessThan(names.indexOf('livestockSummon'));
    expect(names.indexOf('livestockSummon')).toBeLessThan(names.indexOf('production'));
  });

  it("a claim re-anchors onto the player's base yard in the same tick", () => {
    const sim = livestockSim();
    farmAt(sim, 20, 20, { owner: 0, buildingType: 1 });
    const cow = cowAt(sim, 11, 10);
    scoutAt(sim, 10, 10, 0);

    const drives = SYSTEM_ORDER.filter(
      (s) => s.name === 'livestockCapture' || s.name === 'livestockAssign',
    ).map((s) => s.system);
    expect(drives).toHaveLength(2);
    for (const drive of drives) drive(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(cow, Owner)?.player).toBe(0);
    expect(sim.world.has(cow, StayPoint)).toBe(true);
  });

  it('the summon walks a taken animal in the same tick the breeder took it', () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 20, 20, { owner: 0 });
    const breeder = breederAt(sim, 20, 20, farm);
    const target = cowAt(sim, 22, 20, { owner: 0, farm });
    for (let i = 0; i < 2; i++) cowAt(sim, 4 + i, 4, { owner: 0, farm });

    sim.step();

    expect(sim.world.get(target, FarmAnimal).summoner).toBe(breeder);
    expect(sim.world.has(target, MoveGoal) || sim.world.has(target, StayPoint)).toBe(true);
  });
});
