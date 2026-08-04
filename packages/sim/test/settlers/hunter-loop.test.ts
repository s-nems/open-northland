import { describe, expect, it } from 'vitest';
import {
  DeliveryFlag,
  Health,
  KilledBy,
  Owner,
  Position,
  Resource,
  Settler,
  Stockpile,
  WorkFlag,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { CORE_INVARIANTS, checkInvariants, fx, positionOfNode, Simulation } from '../../src/index.js';
import { isYardHeap } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * The hunter's full working loop, end to end over whole sim ticks: an owned, flag-bound hunter
 * (default IGNORE stance) spots prey inside its hunting ground, walks up, shoots it dead
 * (`test_spear`, band [3, 17]), the kill leaves a carcass node, and the ordinary flag-gatherer drive
 * then harvests it pluck by pluck and banks every unit as ground heaps at the hunter's own flag -
 * accruing the `hunter_general` experience track (fixture typeId 37, factor 200) per unit, exactly
 * like any other work XP.
 */
describe('hunter - shoot, leave a carcass, carry it home to the flag (the full loop)', () => {
  const VIKING = 1;
  const HUNTER = 15;
  const COW = 13; // fixture yield: meat(21) ×4 (lastResort, but the only prey here)
  const MEAT = 21;
  const HUNTER_GENERAL_TRACK = 37;
  const HUNTER_GENERAL_FACTOR = 200;
  const P0 = 0;

  /** Step whole sim ticks, collecting the first invariant violation and every hunter a carcass named as
   *  its killer - a body is reaped once plucked dry, so the mark has to be read while it still lies. */
  function runTicks(sim: Simulation, ticks: number): { violations: string[]; killers: Entity[] } {
    const violations: string[] = [];
    const killers = new Set<Entity>();
    for (let i = 0; i < ticks; i++) {
      sim.step();
      for (const body of sim.world.query(KilledBy)) killers.add(sim.world.get(body, KilledBy).by);
      if (violations.length === 0) {
        const v = checkInvariants(sim.world, sim.content, CORE_INVARIANTS);
        if (v.length > 0) violations.push(`tick ${sim.tick}: ${v.join('; ')}`);
      }
    }
    return { violations, killers: [...killers].sort((a, b) => a - b) };
  }

  /** An owned, flag-bound hunter at visual cell (x, y) - its flag on its own node, ground radius 12. */
  function postedHunter(sim: Simulation, x: number, y: number): Entity {
    const e = settlerAt(sim, {
      jobType: HUNTER,
      tribe: VIKING,
      position: { x: fx.fromInt(x), y: fx.fromInt(y) },
    });
    sim.world.add(e, Health, { hitpoints: 1000, max: 1000 });
    sim.world.add(e, Owner, { player: P0 });
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(2 * x, 2 * y));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(e, WorkFlag, { flag, radius: 12 });
    return e;
  }

  /** A passive cow at visual cell (x, y) - it never fights back and never wanders (no StayPoint). */
  function prey(sim: Simulation, x: number, y: number): Entity {
    const e = settlerAt(sim, {
      jobType: null,
      tribe: COW,
      position: { x: fx.fromInt(x), y: fx.fromInt(y) },
    });
    sim.world.add(e, Health, { hitpoints: 1000, max: 1000 });
    return e;
  }

  function yardAmount(sim: Simulation, goodType: number): number {
    return [...sim.world.query(Stockpile)]
      .filter((e) => isYardHeap(sim.world, e))
      .reduce((sum, e) => sum + (sim.world.get(e, Stockpile).amounts.get(goodType) ?? 0), 0);
  }

  it('kills in-ground prey, then harvests the carcass to its flag, training hunter_general', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassCellMap(16, 4) });
    // The hunter at visual cell (1,1) → node (2,2); owned so the auto-engage drive runs (default
    // stance for job 15 is IGNORE + the predation exemption). The cow at node (8,2) is 6 nodes off -
    // inside the ground radius 12.
    const hunter = postedHunter(sim, 1, 1);
    const flag = sim.world.get(hunter, WorkFlag).flag;
    const cow = prey(sim, 4, 1);

    const { violations, killers } = runTicks(sim, 800);

    // The cow is dead and reaped; the carcass node is fully harvested away.
    expect(sim.world.isAlive(cow)).toBe(false);
    expect(killers).toEqual([hunter]); // the body named the hunter that shot it
    expect([...sim.world.query(Resource)]).toHaveLength(0);
    // Every meat unit was carried to the flag and piled on the ground beside it (the flag itself
    // stores nothing), and the hunter stands empty-handed.
    expect(yardAmount(sim, MEAT)).toBe(4);
    expect(sim.world.has(flag, Stockpile)).toBe(false);
    // Each harvested unit trained the hunter's general track through the ordinary work-XP seam.
    expect(sim.world.get(hunter, Settler).experience.get(HUNTER_GENERAL_TRACK)).toBe(
      4 * HUNTER_GENERAL_FACTOR,
    );
    expect(violations).toEqual([]);
  });

  it('two hunters take a cow each and bank their own kill - neither trails the other', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassCellMap(16, 4) });
    const west = postedHunter(sim, 1, 1);
    const east = postedHunter(sim, 1, 2);
    // Two cows, both in both grounds, and one of them nearer to BOTH hunters.
    const near = prey(sim, 4, 1);
    const far = prey(sim, 6, 1);

    const { violations, killers } = runTicks(sim, 1200);

    expect(sim.world.isAlive(near)).toBe(false);
    expect(sim.world.isAlive(far)).toBe(false); // the second hunter took the other cow, not this one
    // Both hunters made a kill of their own, and every unit of both bodies reached a flag.
    expect(killers).toEqual([west, east].sort((a, b) => a - b));
    expect(yardAmount(sim, MEAT)).toBe(8);
    expect(violations).toEqual([]);
  });
});
