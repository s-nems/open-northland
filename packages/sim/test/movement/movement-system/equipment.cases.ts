import { describe, expect, it } from 'vitest';
import { Equipment, type EquipmentSlot, MISC_EQUIP_SLOTS } from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { wearStepOf } from '../../../src/systems/equipment/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { followerAt, grassMap, ticksToArrive } from './support.js';

// Worn boots: +40% cruise gait (fixture shoes, `equip.speedBonusPct`) and one wear step per
// waypoint arrival; a pair reaching its rating breaks mid-walk and the gait drops back to base.

const SHOES = 8; // 6000 rated uses - a fresh pair never breaks inside a test walk

function wearBoots(sim: Simulation, e: Entity, goodType: number, degreeOfUse = fx.fromInt(0)): void {
  sim.world.add(e, Equipment, {
    boots: { goodType, degreeOfUse },
    tool: null,
    weapon: null,
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
}

/** A three-cell E/W walk from rest - the straight-line pace probe. */
const WALK: Array<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 3, y: 0 },
];

describe('movementSystem — worn boots', () => {
  it('a booted walker beats a bare one over the same path (+40% cruise gait)', () => {
    const bare = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const bareTicks = ticksToArrive(bare, followerAt(bare, 0, 0, WALK));

    const booted = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(booted, 0, 0, WALK);
    wearBoots(booted, e, SHOES);
    const bootedTicks = ticksToArrive(booted, e);

    expect(bootedTicks).toBeLessThan(bareTicks);
    // The cruise ratio is 1.4 exactly; ramp/brake ticks dilute it a little over a short walk.
    expect(bootedTicks * 13).toBeLessThan(bareTicks * 10); // > ~30% faster end to end
  });

  it('wears the boots one step per waypoint arrival', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, WALK);
    wearBoots(sim, e, SHOES);
    ticksToArrive(sim, e);
    // Every waypoint (including the zero-length first one) is one arrival = one wear step.
    const step = wearStepOf(ctxOf(sim), SHOES);
    expect(sim.world.get(e, Equipment).boots?.degreeOfUse).toBe(step * WALK.length);
  });

  it('breaks the rated-out pair mid-walk: the slot clears and the walk still completes', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, WALK);
    // Two rated uses left on the pair - it breaks on the second of the walk's four arrivals.
    const step = wearStepOf(ctxOf(sim), SHOES);
    wearBoots(sim, e, SHOES, fx.sub(ONE, fx.mul(step, fx.fromInt(2))));
    const ticks = ticksToArrive(sim, e);
    expect(sim.world.get(e, Equipment).boots).toBeNull();

    // The tail was walked bootless, so the trip is slower than an unbroken booted one.
    const unbroken = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const u = followerAt(unbroken, 0, 0, WALK);
    wearBoots(unbroken, u, SHOES);
    expect(ticks).toBeGreaterThan(ticksToArrive(unbroken, u));
  });

  it('a spent pair grants no bonus (and wears no further)', () => {
    const bare = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const bareTicks = ticksToArrive(bare, followerAt(bare, 0, 0, WALK));

    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, WALK);
    wearBoots(sim, e, SHOES, ONE); // stamped fully spent
    expect(ticksToArrive(sim, e)).toBe(bareTicks);
    expect(sim.world.get(e, Equipment).boots).toEqual({ goodType: SHOES, degreeOfUse: ONE });
  });
});
