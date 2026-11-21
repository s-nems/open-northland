import { expect, it } from 'vitest';
import {
  AttackOrder,
  Engagement,
  MoveGoal,
  Owner,
  PathFollow,
  PathRoute,
  Position,
} from '../../../src/components/index.js';
import { fx, positionOfNode, Simulation } from '../../../src/index.js';
import { MeleeSlots } from '../../../src/systems/conflict/melee-slots.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  OTHER,
  SOLDIER_SWORD_SHORT,
  VIKING,
  WOMAN,
} from './combat-cadence/support.js';

it.each(['previous pass', 'current pass', 'mid-stride'])(
  'gives a front reservation to the nearer ally (%s)',
  (state) => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(20, 20) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected terrain');
    const target = fighterAtNode(sim, 8, 10, OTHER, WOMAN);
    const far = fighterAtNode(sim, 20, 10, VIKING, SOLDIER_SWORD_SHORT);
    const near = fighterAtNode(sim, 10, 10, VIKING, SOLDIER_SWORD_SHORT);
    for (const e of [far, near]) {
      sim.world.add(e, Owner, { player: 0 });
      sim.world.add(e, Engagement, { target, repathAt: 100 });
    }
    const cell = terrain.nodeAt(9, 10);
    sim.world.add(far, MoveGoal, { cell });
    sim.world.add(far, AttackOrder, { target, breach: { resume: target, stand: cell } });
    const slots = new MeleeSlots(sim.world, ctxOf(sim), terrain);
    const chaser = { entity: near, target };
    if (state === 'mid-stride') {
      const p = sim.world.mut(far, Position);
      p.x = fx.sub(p.x, fx.fromFloat(0.25));
      sim.world.add(far, PathRoute, {
        waypoints: [19, 18, 17].map((hx) => ({ ...positionOfNode(hx, 10), node: terrain.nodeAt(hx, 10) })),
      });
      sim.world.add(far, PathFollow, { index: 0, legElapsed: 1, legCost: 4 });
    }
    if (state === 'current pass') slots.claim(cell, 0, { entity: far, target });
    expect(slots.isTaken(cell, undefined)).toBe(true);
    expect(slots.isTaken(cell, undefined, undefined, chaser)).toBe(false);
    expect(sim.world.get(far, MoveGoal).cell).toBe(cell); // probing does not take anything
    slots.claim(cell, 0, chaser);
    sim.world.add(near, MoveGoal, { cell });
    expect(sim.world.has(far, MoveGoal)).toBe(false);
    if (state === 'mid-stride') {
      expect(sim.world.get(far, PathRoute).waypoints).toEqual([
        { ...positionOfNode(19, 10), node: terrain.nodeAt(19, 10) },
      ]);
      expect(sim.world.get(far, PathFollow).legElapsed).toBe(1);
    }
    expect(sim.world.get(far, Engagement).repathAt).toBe(sim.tick);
    expect(sim.world.get(far, AttackOrder).breach).toEqual({ resume: target, stand: null });
    expect(slots.isTaken(cell, undefined, undefined, { entity: far, target })).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);
  },
);

it.each(['tie', 'arriving', 'other owner', 'other target', 'occupied', 'crossing a friend'] as const)(
  'keeps the incumbent front reservation when %s',
  (reason) => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(20, 20) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected terrain');
    const target = fighterAtNode(sim, 8, 10, OTHER, WOMAN);
    const far = fighterAtNode(sim, 20, 10, VIKING, SOLDIER_SWORD_SHORT);
    const near = fighterAtNode(sim, 10, 10, VIKING, SOLDIER_SWORD_SHORT);
    sim.world.add(far, Owner, { player: reason === 'other owner' ? 1 : 0 });
    sim.world.add(near, Owner, { player: 0 });
    const cell = terrain.nodeAt(9, 10);
    sim.world.add(far, MoveGoal, { cell });
    sim.world.add(far, Engagement, { target: reason === 'other target' ? near : target, repathAt: 100 });
    if (reason === 'tie') sim.world.add(near, Position, positionOfNode(20, 10));
    if (reason === 'arriving') {
      sim.world.add(far, Position, positionOfNode(10, 10));
      sim.world.add(near, Position, positionOfNode(9, 10));
    }
    if (reason === 'occupied') {
      const occupant = fighterAtNode(sim, 9, 10, VIKING, SOLDIER_SWORD_SHORT);
      sim.world.add(occupant, Owner, { player: 0 });
    }
    if (reason === 'crossing a friend') {
      // On the centre of a friend's node, its next leg just begun: a stop would rest it on his node.
      const friend = fighterAtNode(sim, 20, 10, VIKING, SOLDIER_SWORD_SHORT);
      sim.world.add(friend, Owner, { player: 0 });
      sim.world.add(far, PathRoute, {
        waypoints: [20, 19].map((hx) => ({ ...positionOfNode(hx, 10), node: terrain.nodeAt(hx, 10) })),
      });
      sim.world.add(far, PathFollow, { index: 1, legElapsed: 0, legCost: 4 });
    }
    const slots = new MeleeSlots(sim.world, ctxOf(sim), terrain);
    expect(slots.isTaken(cell, undefined, undefined, { entity: near, target })).toBe(true);
    expect(sim.world.get(far, MoveGoal).cell).toBe(cell);
  },
);

it('keeps the destination of a final step under way reserved', () => {
  const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(20, 20) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('expected terrain');
  const target = fighterAtNode(sim, 20, 13, OTHER, WOMAN);
  const far = fighterAtNode(sim, 20, 11, VIKING, SOLDIER_SWORD_SHORT);
  const near = fighterAtNode(sim, 22, 12, VIKING, SOLDIER_SWORD_SHORT);
  for (const e of [far, near]) sim.world.add(e, Owner, { player: 0 });
  // Partway along the SE edge from (20,11) to (21,12), its final step.
  const cell = terrain.nodeAt(21, 12);
  const from = positionOfNode(20, 11);
  const to = positionOfNode(21, 12);
  const start = sim.world.mut(far, Position);
  start.x = fx.add(from.x, fx.div(fx.sub(to.x, from.x), fx.fromInt(2)));
  start.y = fx.add(from.y, fx.div(fx.sub(to.y, from.y), fx.fromInt(2)));
  sim.world.add(far, MoveGoal, { cell });
  sim.world.add(far, Engagement, { target, repathAt: 100 });
  sim.world.add(far, PathRoute, {
    waypoints: [
      { ...from, node: terrain.nodeAt(20, 11) },
      { ...to, node: cell },
    ],
  });
  sim.world.add(far, PathFollow, { index: 1, legElapsed: 1, legCost: 8 });
  const slots = new MeleeSlots(sim.world, ctxOf(sim), terrain);
  expect(slots.isTaken(cell, undefined, undefined, { entity: near, target })).toBe(true);
  expect(sim.world.get(far, MoveGoal).cell).toBe(cell);
});

it('does not brake onto a reservation shared by an enemy and an ally', () => {
  const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(20, 20) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('expected terrain');
  const target = fighterAtNode(sim, 8, 10, OTHER, WOMAN);
  const cell = terrain.nodeAt(9, 10);
  for (const player of [1, 0]) {
    const e = fighterAtNode(sim, 20 + player, 10, VIKING, SOLDIER_SWORD_SHORT);
    sim.world.add(e, Owner, { player });
    sim.world.add(e, Engagement, { target, repathAt: 100 });
    sim.world.add(e, MoveGoal, { cell });
  }
  const near = fighterAtNode(sim, 10, 10, VIKING, SOLDIER_SWORD_SHORT);
  sim.world.add(near, Owner, { player: 0 });
  const slots = new MeleeSlots(sim.world, ctxOf(sim), terrain);
  expect(slots.canStop(cell, undefined, { entity: near, target })).toBe(false);
});
