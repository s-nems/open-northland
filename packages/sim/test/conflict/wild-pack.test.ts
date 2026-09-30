import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  CurrentAtomic,
  Engagement,
  Frightened,
  Health,
  HerdMember,
  MoveGoal,
  StayPoint,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { ANIMAL_AGGRO_RADIUS_NODES, ANIMAL_LEASH_NODES } from '../../src/systems/conflict/targeting.js';
import { atomicSystem, cleanupSystem, combatSystem, herdingSystem } from '../../src/systems/index.js';
import { hexNodeDistance } from '../../src/systems/spatial/metric.js';
import { testContent } from '../fixtures/content.js';
import { nextTickCtxOf } from '../fixtures/context.js';
import {
  ATTACK_ATOMIC,
  BEAR,
  BOAR,
  ctxOf,
  fighterAtNode,
  grassMap,
  VIKING,
  WOODCUTTER,
} from './combat-system/support.js';

// Wild packs: the fixture BEAR is aggressive with a reach of 2 map points and follows a leader; the BOAR
// fights only once struck. Every animal here stands on row 0 of the half-cell lattice, where one node
// step is one map point.

function mapTerrain(sim: Simulation): TerrainGraph {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped fixture expected');
  return terrain;
}

/** An animal of `tribe` at node (hx, 0), anchored where it stands unless `stayAt` names another node. */
function animalAt(sim: Simulation, tribe: number, hx: number, stayAt = hx): Entity {
  const e = fighterAtNode(sim, hx, 0, tribe, null);
  sim.world.add(e, StayPoint, { cell: mapTerrain(sim).nodeAt(stayAt, 0) });
  return e;
}

function joinHerd(sim: Simulation, leader: Entity, ...followers: Entity[]): void {
  sim.world.add(leader, HerdMember, { leader });
  for (const f of followers) sim.world.add(f, HerdMember, { leader });
}

function swingTarget(sim: Simulation, e: Entity): number | undefined {
  const effect = sim.world.tryGet(e, CurrentAtomic)?.effect;
  return effect?.kind === 'attack' ? effect.target : undefined;
}

function node(sim: Simulation, hx: number): NodeId {
  return mapTerrain(sim).nodeAt(hx, 0);
}

describe('wild pack targeting', () => {
  it("a reaped leader's pack fights on under the lowest-id survivor", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const leader = animalAt(sim, BEAR, 6);
    const first = animalAt(sim, BEAR, 8);
    const second = animalAt(sim, BEAR, 10);
    joinHerd(sim, leader, first, second);
    const viking = fighterAtNode(sim, 12, 0, VIKING, WOODCUTTER);

    sim.world.mut(leader, Health).hitpoints = 0;
    cleanupSystem(sim.world, ctxOf(sim));
    herdingSystem(sim.world, ctxOf(sim));
    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.isAlive(leader)).toBe(false);
    // The new leader finds the viking 4 points off its stay point and closes; the other copies it and,
    // already in reach, swings.
    expect(sim.world.get(first, Engagement).target).toBe(viking);
    expect(swingTarget(sim, second)).toBe(viking);
  });

  it('a struck follower hits back while its leader stands idle', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const leader = fighterAtNode(sim, 2, 0, BOAR, null);
    const follower = fighterAtNode(sim, 4, 0, BOAR, null);
    joinHerd(sim, leader, follower);
    const viking = fighterAtNode(sim, 6, 0, VIKING, WOODCUTTER);
    addCurrentAtomic(sim.world, viking, {
      atomicId: ATTACK_ATOMIC,
      duration: 1,
      effect: { kind: 'attack', target: follower, damage: 50 },
      targetEntity: follower,
      targetTile: null,
    });

    atomicSystem(sim.world, nextTickCtxOf(sim)); // the blow lands and provokes the follower
    combatSystem(sim.world, ctxOf(sim));

    expect(swingTarget(sim, follower)).toBe(viking);
    expect(sim.world.has(leader, CurrentAtomic)).toBe(false); // an unprovoked boar stays out of it
  });

  it('a struck follower whose leader flees takes no target', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const leader = fighterAtNode(sim, 2, 0, BOAR, null);
    const follower = fighterAtNode(sim, 4, 0, BOAR, null);
    joinHerd(sim, leader, follower);
    sim.world.add(leader, Frightened, { until: 100, repathAt: 0, from: node(sim, 6) });
    const viking = fighterAtNode(sim, 6, 0, VIKING, WOODCUTTER);
    addCurrentAtomic(sim.world, viking, {
      atomicId: ATTACK_ATOMIC,
      duration: 1,
      effect: { kind: 'attack', target: follower, damage: 50 },
      targetEntity: follower,
      targetTile: null,
    });

    atomicSystem(sim.world, nextTickCtxOf(sim));

    expect(sim.world.tryGet(follower, Engagement)?.target).toBeUndefined();
  });

  it('a leader pursuing 41 points from its stay point drops its target and walks back', () => {
    const run = (hx: number) => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(24, 1) });
      const bear = animalAt(sim, BEAR, hx, 0);
      joinHerd(sim, bear);
      const viking = fighterAtNode(sim, hx + 2, 0, VIKING, WOODCUTTER); // inside the bear's reach
      sim.world.add(bear, Engagement, { repathAt: 0, target: viking });
      combatSystem(sim.world, ctxOf(sim));
      return { sim, bear, viking };
    };

    const atLeash = run(ANIMAL_LEASH_NODES);
    expect(
      hexNodeDistance(mapTerrain(atLeash.sim), node(atLeash.sim, ANIMAL_LEASH_NODES), node(atLeash.sim, 0)),
    ).toBe(ANIMAL_LEASH_NODES);
    expect(swingTarget(atLeash.sim, atLeash.bear)).toBe(atLeash.viking);

    const past = run(ANIMAL_LEASH_NODES + 1);
    expect(past.sim.world.has(past.bear, Engagement)).toBe(false);
    expect(past.sim.world.has(past.bear, CurrentAtomic)).toBe(false);
    expect(past.sim.world.get(past.bear, MoveGoal).cell).toBe(node(past.sim, 0));
  });

  it("a follower's own target is on the same leash", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(24, 1) });
    const hx = ANIMAL_LEASH_NODES + 1;
    const leader = animalAt(sim, BEAR, hx - 2, 0);
    const follower = animalAt(sim, BEAR, hx, 0);
    joinHerd(sim, leader, follower);
    const viking = fighterAtNode(sim, hx + 2, 0, VIKING, WOODCUTTER);
    sim.world.add(follower, Engagement, { repathAt: 0, target: viking });

    combatSystem(sim.world, ctxOf(sim));

    expect(swingTarget(sim, follower)).toBeUndefined();
    expect(sim.world.get(follower, MoveGoal).cell).toBe(node(sim, 0));
  });

  it('a leader searches around its stay point and takes the enemy nearest it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(24, 1) });
    const stay = 30;
    const bear = animalAt(sim, BEAR, 10, stay);
    joinHerd(sim, bear);
    fighterAtNode(sim, 4, 0, VIKING, WOODCUTTER); // beside the bear, but off the stay point's circle
    fighterAtNode(sim, 13, 0, VIKING, WOODCUTTER); // nearer the bear than the pick
    const nearStay = fighterAtNode(sim, 44, 0, VIKING, WOODCUTTER);
    const terrain = mapTerrain(sim);
    expect(hexNodeDistance(terrain, node(sim, 4), node(sim, stay))).toBeGreaterThan(
      ANIMAL_AGGRO_RADIUS_NODES,
    );
    expect(hexNodeDistance(terrain, node(sim, 44), node(sim, stay))).toBeLessThan(
      hexNodeDistance(terrain, node(sim, 13), node(sim, stay)),
    );

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(bear, Engagement).target).toBe(nearStay);
  });
});
