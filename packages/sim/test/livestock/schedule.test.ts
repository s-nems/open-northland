import { describe, expect, it } from 'vitest';
import { Health, LivestockVisit, Owner, Production, Resting, StayPoint } from '../../src/components/index.js';
import {
  LIVESTOCK_GRAZE_RANGE_NODES,
  LIVESTOCK_PROCESS_DRAIN_HP,
  LIVESTOCK_REGEN_HP,
} from '../../src/systems/index.js';
import { SYSTEM_ORDER } from '../../src/systems/schedule.js';
import { breederAt, COW_HP, cowAt, ctxOf, farmAt, livestockSim, scoutAt, WATER, WHEAT } from './support.js';

/** The schedule's declared livestock slots, in order - the relationships the comments claim. */
const names = SYSTEM_ORDER.map((s) => s.name);

describe('livestock schedule relationships', () => {
  it('declares capture after the walk settles, regen before the summon, the summon before production', () => {
    expect(names.indexOf('separation')).toBeLessThan(names.indexOf('livestockCapture'));
    expect(names.indexOf('livestockCapture')).toBeLessThan(names.indexOf('livestockAssign'));
    expect(names.indexOf('livestockAssign')).toBeLessThan(names.indexOf('livestockRegen'));
    expect(names.indexOf('livestockRegen')).toBeLessThan(names.indexOf('livestockVisit'));
    expect(names.indexOf('livestockVisit')).toBeLessThan(names.indexOf('production'));
  });

  it("regen tops an animal up before the same tick's summon reads its HP", () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 10, 10, {
      stock: [
        [WATER, 2],
        [WHEAT, 4],
      ],
    });
    breederAt(sim, 10, 10);
    // One regen pulse short of the summon's floor (hp - drain >= max/2): only the declared order -
    // regen, then the summon, then production - lets this tick (0, a pulse tick) start the cycle. On
    // the door node, so the summoned cow counts as arrived and the batch admits it the same tick.
    const cow = cowAt(sim, 10, 10, {
      owner: 0,
      hp: COW_HP / 2 + LIVESTOCK_PROCESS_DRAIN_HP - LIVESTOCK_REGEN_HP,
    });

    const drives = SYSTEM_ORDER.filter(
      (s) => s.name === 'livestockRegen' || s.name === 'livestockVisit' || s.name === 'production',
    ).map((s) => s.system);
    expect(drives).toHaveLength(3);
    for (const drive of drives) drive(sim.world, ctxOf(sim));

    expect(sim.world.get(farm, Production).cycles).toHaveLength(1);
    // The batch admitted the cow (inside with the operator); the life cost waits for the release.
    expect(sim.world.tryGet(cow, Resting)?.at).toBe(farm);
    expect(sim.world.has(cow, LivestockVisit)).toBe(true);
    expect(sim.world.get(cow, Health).hitpoints).toBe(COW_HP / 2 + LIVESTOCK_PROCESS_DRAIN_HP);
  });

  it("a contact claim re-anchors onto the player's farm ring in the same tick", () => {
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
    if (terrain === undefined) throw new Error('livestockSim always has a map');
    const cell = sim.world.tryGet(cow, StayPoint)?.cell;
    if (cell === undefined) throw new Error('the claim must anchor a leash');
    const door = terrain.coordsOf(terrain.nodeAt(20, 20));
    const spot = terrain.coordsOf(cell);
    const distance = Math.abs(spot.x - door.x) + Math.abs(spot.y - door.y);
    expect(distance).toBeGreaterThan(0); // beside the door, never in the doorway
    expect(distance).toBeLessThanOrEqual(LIVESTOCK_GRAZE_RANGE_NODES);
  });
});
