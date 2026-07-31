import { describe, expect, it } from 'vitest';
import {
  DeliveryFlag,
  Health,
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

  function runTicks(sim: Simulation, ticks: number): string[] {
    const violations: string[] = [];
    for (let i = 0; i < ticks; i++) {
      sim.step();
      if (violations.length === 0) {
        const v = checkInvariants(sim.world, CORE_INVARIANTS);
        if (v.length > 0) violations.push(`tick ${sim.tick}: ${v.join('; ')}`);
      }
    }
    return violations;
  }

  function yardAmount(sim: Simulation, goodType: number): number {
    return [...sim.world.query(Stockpile)]
      .filter((e) => isYardHeap(sim.world, e))
      .reduce((sum, e) => sum + (sim.world.get(e, Stockpile).amounts.get(goodType) ?? 0), 0);
  }

  it('kills in-ground prey, then harvests the carcass to its flag, training hunter_general', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassCellMap(16, 4) });
    // The hunter at visual cell (1,1) → node (2,2); owned so the auto-engage drive runs (default
    // stance for job 15 is IGNORE + the predation exemption).
    const hunter = settlerAt(sim, {
      jobType: HUNTER,
      tribe: VIKING,
      position: { x: fx.fromInt(1), y: fx.fromInt(1) },
    });
    sim.world.add(hunter, Health, { hitpoints: 1000, max: 1000 });
    sim.world.add(hunter, Owner, { player: P0 });
    // Its work flag on its own node, ground radius 12 - the cow at node (8,2) is 6 nodes off, inside.
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(2, 2));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(hunter, WorkFlag, { flag, radius: 12 });
    // The prey: a passive cow (it never fights back and never wanders - no StayPoint).
    const cow: Entity = settlerAt(sim, {
      jobType: null,
      tribe: COW,
      position: { x: fx.fromInt(4), y: fx.fromInt(1) },
    });
    sim.world.add(cow, Health, { hitpoints: 1000, max: 1000 });

    const violations = runTicks(sim, 800);

    // The cow is dead and reaped; the carcass node is fully harvested away.
    expect(sim.world.isAlive(cow)).toBe(false);
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
});
