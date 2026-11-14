import { describe, expect, it } from 'vitest';
import {
  Engagement,
  Frightened,
  Health,
  HerdMember,
  MoveGoal,
  Owner,
  Projectile,
  Resting,
  StayPoint,
  WildHabitat,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type Fixed, positionOfNode, Simulation } from '../../../src/index.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { animalFrightSystem, FLIGHT_REACH_NODES } from '../../../src/systems/conflict/fright.js';
import { SHELTER_SHOT_PERIOD_TICKS } from '../../../src/systems/conflict/shelter-fire.js';
import { isTravelling } from '../../../src/systems/movement/nav-state.js';
import {
  KIN_ALARM_RADIUS_NODES,
  reactToBlowOnAnimal,
} from '../../../src/systems/settlers/atomics/effects/combat/hit/reactions.js';
import { looseProjectile } from '../../../src/systems/settlers/atomics/effects/combat/index.js';
import { hexNodeDistance } from '../../../src/systems/spatial/metric.js';
import { entityNode } from '../../../src/systems/spatial/nodes.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassCellMap, waterColumnMap } from '../../fixtures/terrain.js';
import { BEAR, COW, DEER, fighterAtNode, HUNTER, VIKING } from './combat-system/support.js';
import { P0 } from './stances/support.js';

// An animal's flight from a blow: a struck leader that does not fight runs once to the point farthest from
// its attacker within reach, its followers run after it, and kin of its kind and side within the alarm
// radius answer the blow as if struck.

/** A wild animal anchored where it stands. */
function wildAtNode(sim: Simulation, hx: number, hy: number, tribe: number): Entity {
  const e = fighterAtNode(sim, hx, hy, tribe, null);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('test map missing');
  sim.world.add(e, StayPoint, { cell: entityNode(sim.world, terrain, e) });
  return e;
}

function joinHerd(sim: Simulation, leader: Entity, ...followers: Entity[]): void {
  sim.world.add(leader, HerdMember, { leader });
  for (const f of followers) sim.world.add(f, HerdMember, { leader });
}

function mapTerrain(sim: Simulation): TerrainGraph {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('test map missing');
  return terrain;
}

function nodeOf(sim: Simulation, e: Entity): NodeId {
  return entityNode(sim.world, mapTerrain(sim), e);
}

/** Loose one arrow from `shooter` at `target`, coming down at `aim`. */
function loose(sim: Simulation, shooter: Entity, target: Entity, aim: { x: Fixed; y: Fixed }): void {
  looseProjectile(sim.world, ctxOf(sim), {
    source: shooter,
    target,
    player: null,
    weapon: {
      munitionType: 1,
      speed: 8,
      hitSelf: false,
      area: false,
      damage: { '0': 70 },
      hitSounds: {},
      missSounds: {},
    },
    weaponMainType: null,
    blowTicks: SHELTER_SHOT_PERIOD_TICKS,
    cover: null,
    aim,
  });
}

function stepUntilLanded(sim: Simulation): void {
  let guard = 100;
  while ([...sim.world.query(Projectile)].length > 0 && guard-- > 0) sim.step();
}

describe('reactToBlowOnAnimal - who answers a blow', () => {
  it('a passive leader runs, and so does every leader of its kind and side within the alarm radius', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = fighterAtNode(sim, 20, 40, VIKING, HUNTER);
    const struck = wildAtNode(sim, 30, 40, COW);
    const atEdge = wildAtNode(sim, 30 + KIN_ALARM_RADIUS_NODES, 40, COW);
    const beyond = wildAtNode(sim, 31 + KIN_ALARM_RADIUS_NODES, 40, COW);
    const deer = wildAtNode(sim, 32, 40, DEER);
    const owned = wildAtNode(sim, 33, 40, COW);
    sim.world.add(owned, Owner, { player: P0 });
    const indoors = wildAtNode(sim, 34, 40, COW);
    sim.world.add(indoors, Resting, { at: sim.world.create() });

    reactToBlowOnAnimal(sim.world, ctxOf(sim), hunter, struck);

    expect(sim.world.get(struck, Frightened).from).toBe(nodeOf(sim, hunter));
    expect(sim.world.has(atEdge, Frightened)).toBe(true);
    expect(sim.world.has(beyond, Frightened)).toBe(false);
    expect(sim.world.has(deer, Frightened)).toBe(false);
    expect(sim.world.has(owned, Frightened)).toBe(false);
    expect(sim.world.has(indoors, Frightened)).toBe(false);
  });

  it('a struck follower leaves the flight to its leader and runs after it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = fighterAtNode(sim, 20, 40, VIKING, HUNTER);
    const leader = wildAtNode(sim, 32, 40, COW);
    const struck = wildAtNode(sim, 30, 40, COW);
    joinHerd(sim, leader, struck);

    reactToBlowOnAnimal(sim.world, ctxOf(sim), hunter, struck);
    // The leader aims its flight and alarms its herd; the follower takes the leader's route a tick later.
    animalFrightSystem(sim.world, ctxOf(sim));
    animalFrightSystem(sim.world, ctxOf(sim));

    const flight = sim.world.get(leader, Frightened).dest;
    expect(flight).not.toBeNull();
    expect(sim.world.get(struck, Frightened).dest).toBe(flight);
    expect(sim.world.get(struck, MoveGoal).cell).toBe(flight);
  });

  it('a follower out of earshot of the blow still runs after its fleeing leader', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = fighterAtNode(sim, 20, 40, VIKING, HUNTER);
    const leader = wildAtNode(sim, 30, 40, COW);
    const straggler = wildAtNode(sim, 30, 90, COW);
    joinHerd(sim, leader, straggler);
    expect(hexNodeDistance(mapTerrain(sim), nodeOf(sim, leader), nodeOf(sim, straggler))).toBeGreaterThan(
      KIN_ALARM_RADIUS_NODES,
    );

    reactToBlowOnAnimal(sim.world, ctxOf(sim), hunter, leader);
    expect(sim.world.has(straggler, Frightened)).toBe(false);
    animalFrightSystem(sim.world, ctxOf(sim));
    animalFrightSystem(sim.world, ctxOf(sim));

    const flight = sim.world.get(leader, Frightened).dest;
    expect(flight).not.toBeNull();
    expect(sim.world.get(straggler, MoveGoal).cell).toBe(flight);
  });

  it('an angry animal a player owns runs from a blow rather than standing it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = fighterAtNode(sim, 20, 40, VIKING, HUNTER);
    const bear = wildAtNode(sim, 30, 40, BEAR);
    sim.world.add(bear, Owner, { player: P0 });

    reactToBlowOnAnimal(sim.world, ctxOf(sim), hunter, bear);

    expect(sim.world.has(bear, Engagement)).toBe(false);
    expect(sim.world.get(bear, Frightened).from).toBe(nodeOf(sim, hunter));
  });

  it('an adult angry animal struck by a person takes the striker instead of running', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = fighterAtNode(sim, 20, 40, VIKING, HUNTER);
    const bear = wildAtNode(sim, 30, 40, BEAR);
    const packmate = wildAtNode(sim, 31, 41, BEAR);

    reactToBlowOnAnimal(sim.world, ctxOf(sim), hunter, bear);

    expect(sim.world.has(bear, Frightened)).toBe(false);
    expect(sim.world.get(bear, Engagement).target).toBe(hunter);
    expect(sim.world.get(packmate, Engagement).target).toBe(hunter);
  });
});

describe('animalFrightSystem - the flight and its end', () => {
  it('aims the leader the full flight reach away from its attacker', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = fighterAtNode(sim, 29, 40, VIKING, HUNTER);
    const cow = wildAtNode(sim, 30, 40, COW);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    reactToBlowOnAnimal(sim.world, ctxOf(sim), hunter, cow);
    animalFrightSystem(sim.world, ctxOf(sim));
    const goal = terrain.coordsOf(sim.world.get(cow, MoveGoal).cell);
    // One of the eight walk directions, the full reach along each axis it moves on.
    expect(Math.max(Math.abs(goal.x - 30), Math.abs(goal.y - 40))).toBe(FLIGHT_REACH_NODES);
    expect(goal.x).toBeGreaterThan(30);
  });

  it('a flight cut short by water ends at the farthest point before it', () => {
    // Water fills node columns 60 and 61; the cow stands ten points short of it.
    const sim = new Simulation({ seed: 1, content: testContent(), map: waterColumnMap(64, 64, 30) });
    const terrain = mapTerrain(sim);
    const hunter = fighterAtNode(sim, 30, 40, VIKING, HUNTER);
    const cow = wildAtNode(sim, 50, 40, COW);
    reactToBlowOnAnimal(sim.world, ctxOf(sim), hunter, cow);

    animalFrightSystem(sim.world, ctxOf(sim));

    // The diagonal away from the hunter, cut to the last point on its bank, beats every point the full
    // reach lands on that bank.
    const goal = sim.world.get(cow, MoveGoal).cell;
    expect(goal).toBe(terrain.nodeAt(59, 31));
    expect(terrain.componentOf(goal)).toBe(terrain.componentOf(nodeOf(sim, cow)));
  });

  it('a wild leader settles where it fled: the flight goal becomes its stay point and work center', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = fighterAtNode(sim, 29, 40, VIKING, HUNTER);
    const cow = wildAtNode(sim, 30, 40, COW);
    const home = nodeOf(sim, cow);
    sim.world.add(cow, WildHabitat, { birth: home, workCenter: home, fedUntil: 0, food: 0, nextStayAt: 0 });
    reactToBlowOnAnimal(sim.world, ctxOf(sim), hunter, cow);

    animalFrightSystem(sim.world, ctxOf(sim));

    const flight = sim.world.get(cow, Frightened).dest;
    expect(flight).not.toBeNull();
    expect(flight).not.toBe(home);
    expect(sim.world.get(cow, StayPoint).cell).toBe(flight);
    expect(sim.world.get(cow, WildHabitat).workCenter).toBe(flight);
    expect(sim.world.get(cow, WildHabitat).birth).toBe(home);
  });

  it('a follower holding a target lets it go and runs after its fleeing leader', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = fighterAtNode(sim, 20, 40, VIKING, HUNTER);
    const leader = wildAtNode(sim, 30, 40, COW);
    const follower = wildAtNode(sim, 32, 40, COW);
    joinHerd(sim, leader, follower);
    const victim = fighterAtNode(sim, 34, 40, VIKING, HUNTER);
    sim.world.add(follower, Engagement, { repathAt: 0, target: victim });
    reactToBlowOnAnimal(sim.world, ctxOf(sim), hunter, leader);

    animalFrightSystem(sim.world, ctxOf(sim));
    animalFrightSystem(sim.world, ctxOf(sim));

    const flight = sim.world.get(leader, Frightened).dest;
    expect(flight).not.toBeNull();
    expect(sim.world.has(follower, Engagement)).toBe(false);
    expect(sim.world.get(follower, MoveGoal).cell).toBe(flight);
  });

  it('runs once: the flight ends where it arrives and the herd drives take the animal back', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = fighterAtNode(sim, 20, 40, VIKING, HUNTER);
    const leader = wildAtNode(sim, 32, 40, COW);
    const follower = wildAtNode(sim, 30, 40, COW);
    joinHerd(sim, leader, follower);
    const before = hexNodeDistance(mapTerrain(sim), nodeOf(sim, hunter), nodeOf(sim, leader));
    reactToBlowOnAnimal(sim.world, ctxOf(sim), hunter, follower);

    let guard = 1000;
    while (sim.world.has(leader, Frightened) && guard-- > 0) sim.step();
    expect(sim.world.has(leader, Frightened)).toBe(false);
    expect(isTravelling(sim.world, leader)).toBe(false);
    expect(hexNodeDistance(mapTerrain(sim), nodeOf(sim, hunter), nodeOf(sim, leader))).toBeGreaterThan(
      before,
    );
    sim.step();
    expect(sim.world.has(follower, Frightened)).toBe(false); // calmed with its leader
  });

  it('a shot that lands on its quarry scatters the herd away from the shooter', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const shooter = fighterAtNode(sim, 30, 40, VIKING, HUNTER);
    const cow = wildAtNode(sim, 40, 40, COW);
    const bystander = wildAtNode(sim, 42, 41, COW);
    loose(sim, shooter, cow, positionOfNode(40, 40));
    stepUntilLanded(sim);

    expect(sim.world.get(cow, Health).hitpoints).toBeLessThan(1000); // the arrow struck
    expect(sim.world.get(cow, Frightened).from).toBe(nodeOf(sim, shooter));
    expect(sim.world.get(bystander, Frightened).from).toBe(nodeOf(sim, shooter));
  });

  it('a shot that misses scares nothing, so the next one is loosed at a standing target', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const shooter = fighterAtNode(sim, 30, 40, VIKING, HUNTER);
    const cow = wildAtNode(sim, 40, 40, COW);
    loose(sim, shooter, cow, positionOfNode(34, 42)); // comes down well short, on bare ground
    stepUntilLanded(sim);

    expect(sim.world.get(cow, Health).hitpoints).toBe(1000);
    expect(sim.world.has(cow, Frightened)).toBe(false);
  });
});
