import { describe, expect, it } from 'vitest';
import {
  ClaimAnimalOrder,
  OrderQueue,
  Owner,
  PlayerOrder,
  Position,
  setDiplomacyStance,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { playerCommand, positionOfNode, type Simulation } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import { clearNavState } from '../../src/systems/movement/nav-state.js';
import { settlerAt } from '../fixtures/settler.js';
import { cowAt, livestockSim, scoutAt } from './support.js';

const P0 = 0;
const P1 = 1;
/** The economy fixture's woodcutter - an owned civilian the order refuses. */
const WOODCUTTER = 1;
/** Ticks a chase across the test map may take before the test calls it stuck. */
const CHASE_TICKS = 2000;

function stepUntilOwned(sim: Simulation, animal: Entity): void {
  for (let i = 0; i < CHASE_TICKS && sim.world.tryGet(animal, Owner)?.player !== P0; i++) sim.step();
  expect(sim.world.tryGet(animal, Owner)?.player).toBe(P0);
}

/** Put `animal` down on node (hx, hy), dropping any walk it had. */
function relocate(sim: Simulation, animal: Entity, hx: number, hy: number): void {
  clearNavState(sim.world, animal);
  sim.world.add(animal, Position, positionOfNode(hx, hy));
}

describe('claimAnimal - a scout sent after an animal follows it until it is claimed', () => {
  it('walks to a far wild cow and claims it, then the order and its walk end', () => {
    const sim = livestockSim();
    const scout = scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 50, 40);
    sim.enqueue(playerCommand(P0, { kind: 'claimAnimal', entity: scout, animal: cow }));
    sim.step();
    expect(sim.world.get(scout, ClaimAnimalOrder).animal).toBe(cow);

    stepUntilOwned(sim, cow);
    sim.step();
    expect(sim.world.has(scout, ClaimAnimalOrder)).toBe(false);
    expect(sim.world.has(scout, PlayerOrder)).toBe(false);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('re-aims at an animal that moves off, and claims it where it went', () => {
    const sim = livestockSim();
    const scout = scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 30, 30);
    sim.enqueue(playerCommand(P0, { kind: 'claimAnimal', entity: scout, animal: cow }));
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.world.has(scout, ClaimAnimalOrder)).toBe(true);

    relocate(sim, cow, 55, 10);
    stepUntilOwned(sim, cow);
    const at = nodeOfPosition(sim.world.get(scout, Position).x, sim.world.get(scout, Position).y);
    expect(at.hx).toBeGreaterThan(40); // went to where the cow is now, not where it was ordered
    sim.step();
    expect(sim.world.has(scout, ClaimAnimalOrder)).toBe(false);
  });

  it('re-aims an arrival short of a moved animal before the player-order pass would retire the walk', () => {
    const sim = livestockSim();
    const scout = scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 30, 30);
    sim.enqueue(playerCommand(P0, { kind: 'claimAnimal', entity: scout, animal: cow }));
    sim.step();
    // The walk ends this tick, and the cow has moved off since the order aimed it.
    clearNavState(sim.world, scout);
    relocate(sim, cow, 50, 10);
    sim.step();
    expect(sim.world.has(scout, PlayerOrder)).toBe(true);
    expect(sim.world.get(scout, ClaimAnimalOrder).goal).toBe(sim.terrain?.nodeAt(50, 10));
  });

  it("ends at once when the animal becomes the player's some other way", () => {
    const sim = livestockSim();
    const scout = scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 50, 40);
    sim.enqueue(playerCommand(P0, { kind: 'claimAnimal', entity: scout, animal: cow }));
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.world.has(scout, PlayerOrder)).toBe(true);

    sim.world.add(cow, Owner, { player: P0 });
    sim.step();
    expect(sim.world.has(scout, ClaimAnimalOrder)).toBe(false);
    expect(sim.world.has(scout, PlayerOrder)).toBe(false);
  });

  it('walks on from an arrival out of reach of an animal that drifted the other way', () => {
    const sim = livestockSim();
    const scout = scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 30, 30);
    sim.enqueue(playerCommand(P0, { kind: 'claimAnimal', entity: scout, animal: cow }));
    sim.step();
    // The walk ended a point short of the ordered node, and the cow stepped two points the other way.
    clearNavState(sim.world, scout);
    relocate(sim, scout, 29, 30);
    relocate(sim, cow, 32, 30);
    stepUntilOwned(sim, cow);
  });

  it('ends when the animal dies mid-walk', () => {
    const sim = livestockSim();
    const scout = scoutAt(sim, 10, 10, P0);
    const cow = cowAt(sim, 50, 40);
    sim.enqueue(playerCommand(P0, { kind: 'claimAnimal', entity: scout, animal: cow }));
    for (let i = 0; i < 5; i++) sim.step();
    sim.world.destroy(cow);
    sim.step();
    expect(sim.world.has(scout, ClaimAnimalOrder)).toBe(false);
    expect(sim.world.has(scout, PlayerOrder)).toBe(false);
  });

  it('refuses a non-scout and an animal the player already holds', () => {
    const sim = livestockSim();
    const woodcutter = settlerAt(sim, { jobType: WOODCUTTER, position: positionOfNode(10, 10) });
    sim.world.add(woodcutter, Owner, { player: P0 });
    const scout = scoutAt(sim, 10, 20, P0);
    const wild = cowAt(sim, 50, 40);
    const own = cowAt(sim, 50, 10, { owner: P0 });
    sim.enqueue(playerCommand(P0, { kind: 'claimAnimal', entity: woodcutter, animal: wild }));
    sim.enqueue(playerCommand(P0, { kind: 'claimAnimal', entity: scout, animal: own }));
    sim.step();
    expect(sim.world.has(woodcutter, ClaimAnimalOrder)).toBe(false);
    expect(sim.world.has(woodcutter, PlayerOrder)).toBe(false);
    expect(sim.world.has(scout, ClaimAnimalOrder)).toBe(false);
    expect(sim.world.has(scout, PlayerOrder)).toBe(false);
  });

  it('queues behind the current order with Shift: two cows claimed one after the other', () => {
    const sim = livestockSim();
    const scout = scoutAt(sim, 10, 10, P0);
    const first = cowAt(sim, 50, 10);
    const second = cowAt(sim, 50, 50, { owner: P1 });
    // An enemy's stock is claimable too.
    setDiplomacyStance(sim.world, P0, P1, 'enemy');
    sim.enqueue(playerCommand(P0, { kind: 'claimAnimal', entity: scout, animal: first }));
    sim.enqueue(playerCommand(P0, { kind: 'claimAnimal', entity: scout, animal: second, queued: true }));
    sim.step();
    expect(sim.world.get(scout, ClaimAnimalOrder).animal).toBe(first);
    expect(sim.world.get(scout, OrderQueue).orders.map((o) => o.kind)).toEqual(['claimAnimal']);

    stepUntilOwned(sim, first);
    expect(sim.world.tryGet(second, Owner)?.player).toBe(P1);
    stepUntilOwned(sim, second);
    expect(sim.world.has(scout, OrderQueue)).toBe(false);
    expect(sim.checkInvariants()).toEqual([]);
  });
});
