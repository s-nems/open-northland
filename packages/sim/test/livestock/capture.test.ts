import { describe, expect, it } from 'vitest';
import {
  DraughtAnimal,
  FarmAnimal,
  HerdMember,
  MoveGoal,
  Owner,
  setDiplomacyStance,
} from '../../src/components/index.js';
import { positionOfNode } from '../../src/index.js';
import { livestockCaptureSystem } from '../../src/systems/index.js';
import { settlerAt } from '../fixtures/settler.js';
import { BEAR_TRIBE, cowAt, ctxOf, farmAt, livestockSim, scoutAt } from './support.js';

const P0 = 0;
const P1 = 1;
const P2 = 2;
/** The economy fixture's woodcutter - an owned civilian that must not claim. */
const WOODCUTTER = 1;

describe('livestock capture - a scout claims the catchable animals it passes', () => {
  it('claims an adjacent wild cow: Owner stamped, wild-herd follow dropped', () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 11, 10);
    sim.world.add(cow, HerdMember, { leader: cow });

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(cow, Owner)?.player).toBe(P0);
    expect(sim.world.has(cow, HerdMember)).toBe(false);
  });

  it('reaches two map points out, but no farther', () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const near = cowAt(sim, 12, 10); // two map points east
    const far = cowAt(sim, 13, 10); // three

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(near, Owner)?.player).toBe(P0);
    expect(sim.world.has(far, Owner)).toBe(false);
  });

  it('only the scout trade claims - an owned woodcutter on the same node does not', () => {
    const sim = livestockSim();
    const woodcutter = settlerAt(sim, { jobType: WOODCUTTER, position: positionOfNode(10, 10) });
    sim.world.add(woodcutter, Owner, { player: P0 });
    const cow = cowAt(sim, 10, 10);

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cow, Owner)).toBe(false);
  });

  it("steals an enemy's stock, and leaves a neighbour's alone", () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const enemyCow = cowAt(sim, 10, 11, { owner: P1 });
    const neighbourCow = cowAt(sim, 11, 10, { owner: P2 });
    setDiplomacyStance(sim.world, P0, P1, 'enemy');
    setDiplomacyStance(sim.world, P0, P2, 'neutral');

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(enemyCow, Owner)?.player).toBe(P0);
    expect(sim.world.get(neighbourCow, Owner).player).toBe(P2);
  });

  it("takes a stolen animal out of the enemy farm's herd", () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 20, 20, { owner: P1 });
    scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 10, 11, { owner: P1, farm });
    setDiplomacyStance(sim.world, P0, P1, 'enemy');

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(cow, Owner).player).toBe(P0);
    expect(sim.world.has(cow, FarmAnimal)).toBe(false);
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

  it("a steal mid-walk drops a cart's recruitment and the walk to its door with it", () => {
    const sim = livestockSim();
    const cart = sim.world.create(); // any entity stands in for the cart: only the link is tested
    scoutAt(sim, 10, 10, P0);
    const recruit = cowAt(sim, 10, 11, { owner: P1 });
    sim.world.add(recruit, DraughtAnimal, { vehicle: cart });
    sim.world.add(recruit, MoveGoal, { cell: sim.terrain?.nodeAtClamped(20, 20) ?? 0 });

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(recruit, Owner).player).toBe(P0);
    expect(sim.world.has(recruit, DraughtAnimal)).toBe(false);
    expect(sim.world.has(recruit, MoveGoal)).toBe(false);
  });

  it('never claims a non-catchable animal (the bear stays wild)', () => {
    const sim = livestockSim();
    scoutAt(sim, 10, 10, P0);
    const bear = cowAt(sim, 11, 10, { tribe: BEAR_TRIBE });

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(bear, Owner)).toBe(false);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const claim = (): { hash: string; claimed: boolean } => {
      const sim = livestockSim();
      scoutAt(sim, 10, 10, P0);
      const cow = cowAt(sim, 11, 10);
      sim.world.add(cow, HerdMember, { leader: cow });
      farmAt(sim, 14, 10, { owner: P0 });
      for (let i = 0; i < 120; i++) sim.step();
      return { hash: sim.hashState(), claimed: sim.world.tryGet(cow, Owner)?.player === P0 };
    };
    const a = claim();
    const b = claim();
    expect(a.claimed).toBe(true); // the scout really claimed (not a vacuous hash)
    expect(a.hash).toBe(b.hash);
  });
});
