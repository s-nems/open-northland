import { describe, expect, it } from 'vitest';
import { HerdMember, LivestockVisit, Owner, Resting } from '../../src/components/index.js';
import { positionOfNode } from '../../src/index.js';
import { livestockCaptureSystem } from '../../src/systems/index.js';
import { settlerAt } from '../fixtures/settler.js';
import { BEAR_TRIBE, cowAt, ctxOf, farmAt, livestockSim, scoutAt } from './support.js';

const P0 = 0;
const P1 = 1;
/** The economy fixture's woodcutter - an owned civilian that must not claim. */
const WOODCUTTER = 1;

describe('livestock capture - a scout claims catchable animals by contact', () => {
  it('claims an adjacent wild cow: Owner stamped, wild-herd follow dropped', () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 11, 10);
    sim.world.add(cow, HerdMember, { leader: cow });

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(cow, Owner)?.player).toBe(P0);
    expect(sim.world.has(cow, HerdMember)).toBe(false);
  });

  it('does not reach a cow two nodes away', () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 12, 10);

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cow, Owner)).toBe(false);
  });

  it('only the scout trade claims - an owned woodcutter on the same node does not', () => {
    const sim = livestockSim();
    const woodcutter = settlerAt(sim, { jobType: WOODCUTTER, position: positionOfNode(10, 10) });
    sim.world.add(woodcutter, Owner, { player: P0 });
    const cow = cowAt(sim, 10, 10);

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cow, Owner)).toBe(false);
  });

  it("re-claims another player's stock (the original's livestock stealing)", () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 10, 11, { owner: P1 });

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(cow, Owner)?.player).toBe(P0);
  });

  it("re-points a claimed leader's wild followers onto a successor (no conga to the farm)", () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const leader = cowAt(sim, 11, 10);
    const followerA = cowAt(sim, 14, 10);
    const followerB = cowAt(sim, 15, 10);
    sim.world.add(leader, HerdMember, { leader });
    sim.world.add(followerA, HerdMember, { leader });
    sim.world.add(followerB, HerdMember, { leader });

    livestockCaptureSystem(sim.world, ctxOf(sim)); // only the leader is in contact

    expect(sim.world.tryGet(leader, Owner)?.player).toBe(P0);
    expect(sim.world.has(leader, HerdMember)).toBe(false);
    // The lowest-id remaining member leads; both wild followers point at it.
    expect(sim.world.get(followerA, HerdMember).leader).toBe(followerA);
    expect(sim.world.get(followerB, HerdMember).leader).toBe(followerA);
  });

  it('cannot steal an animal inside a workplace; a steal mid-walk abandons its visit', () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 20, 20, { owner: P1 });
    scoutAt(sim, 10, 10, P0);
    const inside = cowAt(sim, 11, 10, { owner: P1 });
    sim.world.add(inside, LivestockVisit, { at: farm });
    sim.world.add(inside, Resting, { at: farm });
    const walking = cowAt(sim, 10, 11, { owner: P1 });
    sim.world.add(walking, LivestockVisit, { at: farm });

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(inside, Owner).player).toBe(P1); // out of reach until released
    expect(sim.world.get(walking, Owner).player).toBe(P0);
    expect(sim.world.has(walking, LivestockVisit)).toBe(false);
  });

  it('the steal protection survives the full schedule (the planner must not shed a visitor Resting)', () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 20, 20, { owner: P1 });
    const cow = cowAt(sim, 20, 20, { owner: P1 });
    sim.world.add(cow, LivestockVisit, { at: farm });
    sim.world.add(cow, Resting, { at: farm });
    scoutAt(sim, 21, 20, P0);

    sim.step();

    expect(sim.world.get(cow, Owner).player).toBe(P1);
    expect(sim.world.has(cow, Resting)).toBe(true);
    expect(sim.world.tryGet(cow, LivestockVisit)?.at).toBe(farm);
  });

  it('never claims a non-catchable animal (the bear stays wild)', () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const bear = cowAt(sim, 11, 10, { tribe: BEAR_TRIBE });

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(bear, Owner)).toBe(false);
  });
});
