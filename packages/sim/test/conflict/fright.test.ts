import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Frightened,
  Health,
  HerdMember,
  Owner,
  Projectile,
  Resting,
  StayPoint,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, positionOfNode, Simulation } from '../../src/index.js';
import {
  FRIGHT_DURATION_TICKS,
  FRIGHT_RADIUS_NODES,
  frightenKin,
} from '../../src/systems/conflict/fright.js';
import { isTravelling } from '../../src/systems/movement/nav-state.js';
import { stayPointRangeOf } from '../../src/systems/readviews/index.js';
import { looseProjectile } from '../../src/systems/settlers/atomics/effects/combat/index.js';
import { manhattan } from '../../src/systems/spatial/metric.js';
import { entityNode } from '../../src/systems/spatial/nodes.js';
import { combatContent } from '../fixtures/content/combat.js';
import { economyContent } from '../fixtures/content/economy.js';
import { TEST_MANIFEST } from '../fixtures/content/index.js';
import { societyContent } from '../fixtures/content/societies.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { BEAR, COW, DEER, fighterAtNode, HUNTER, VIKING } from './combat-system/support.js';
import { P0 } from './stances/support.js';

/**
 * The wildlife FRIGHT reaction: a blow landed on a wild animal scares the passive animals around it into
 * scattering away from the attacker (`frightenKin` stamps {@link Frightened}, the
 * `animalFrightSystem` runs them off), a missed shot scares nothing, aggressive species and out-of-radius
 * animals stand, a flight stays inside the animal's territory, and a lapsed scare hands the animal back to
 * its herd drives. Wildlife = a {@link StayPoint} carrier, so the plain combat fixtures (which stamp none)
 * stay scare-free.
 */

/** A wild animal: a fixture combatant plus the roaming StayPoint marker the scare targets. */
function wildAtNode(sim: Simulation, hx: number, hy: number, tribe: number): Entity {
  const e = fighterAtNode(sim, hx, hy, tribe, null);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('test map missing');
  sim.world.add(e, StayPoint, { cell: entityNode(sim.world, terrain, e) });
  return e;
}

/** The test content with the cow given a territory, the leash its grazing and its flight keep to. */
function territorialCowContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...economyContent,
    ...societyContent,
    ...combatContent,
    animals: societyContent.animals.map((a) =>
      a.tribeType === COW ? { ...a, maximumDistanceToStayPoint: 6 } : a,
    ),
  });
}

/** Loose one arrow from `shooter` at `target`, coming down at `aim`. */
function loose(sim: Simulation, shooter: Entity, target: Entity, aim: { x: Fixed; y: Fixed }): void {
  looseProjectile(sim.world, ctxOf(sim), {
    source: shooter,
    target,
    player: null,
    weapon: { munitionType: 1, speed: 8, damage: { '0': 70 }, hitSounds: {}, missSounds: {} },
    weaponMainType: null,
    cover: null,
    aim,
  });
}

function stepUntilLanded(sim: Simulation): void {
  let guard = 100;
  while ([...sim.world.query(Projectile)].length > 0 && guard-- > 0) sim.step();
}

describe('frightenKin - who the scare reaches', () => {
  it('stamps the struck animal and its kind in radius; other kinds and sides, the distant and the marker-less stand', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const struck = wildAtNode(sim, 40, 40, COW);
    const kin = wildAtNode(sim, 42, 40, COW); // same kind, 2 nodes off
    const deer = wildAtNode(sim, 40, 44, DEER); // passive, but another kind
    const far = wildAtNode(sim, 40 + FRIGHT_RADIUS_NODES + 2, 40, COW); // beyond the scare
    const plain = fighterAtNode(sim, 41, 40, COW, null); // no StayPoint - not a roaming animal
    const owned = wildAtNode(sim, 41, 41, COW); // same kind, another side
    sim.world.add(owned, Owner, { player: P0 });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');

    frightenKin(sim.world, ctxOf(sim), terrain, struck, terrain.nodeAt(30, 40));

    expect(sim.world.has(struck, Frightened)).toBe(true);
    expect(sim.world.has(kin, Frightened)).toBe(true);
    expect(sim.world.has(deer, Frightened)).toBe(false);
    expect(sim.world.has(far, Frightened)).toBe(false);
    expect(sim.world.has(plain, Frightened)).toBe(false);
    expect(sim.world.has(owned, Frightened)).toBe(false);
  });

  it('an aggressive kind answers threat with threat: nothing stampedes', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const bear = wildAtNode(sim, 40, 40, BEAR);
    const packmate = wildAtNode(sim, 41, 41, BEAR);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');

    frightenKin(sim.world, ctxOf(sim), terrain, bear, terrain.nodeAt(30, 40));

    expect(sim.world.has(bear, Frightened)).toBe(false);
    expect(sim.world.has(packmate, Frightened)).toBe(false);
  });

  it('leaves an animal inside a building alone - a blow outdoors must not walk it out', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const struck = wildAtNode(sim, 40, 40, COW);
    const indoors = wildAtNode(sim, 41, 40, COW); // one node off, but on a farm's feed batch
    sim.world.add(indoors, Resting, { at: sim.world.create() });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');

    frightenKin(sim.world, ctxOf(sim), terrain, struck, terrain.nodeAt(30, 40));

    expect(sim.world.has(indoors, Frightened)).toBe(false);
  });
});

describe('animalFrightSystem - the scatter and the calm-down', () => {
  it('runs a frightened animal away from the scare, then calms it once the fright lapses', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const cow = wildAtNode(sim, 41, 40, COW);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    const scare = terrain.nodeAt(40, 40);
    frightenKin(sim.world, ctxOf(sim), terrain, cow, scare);
    const before = manhattan(terrain, scare, entityNode(sim.world, terrain, cow));

    // Well inside the fright window: the cow has bolted away from the mark.
    for (let i = 0; i < FRIGHT_DURATION_TICKS; i++) sim.step();
    const fled = manhattan(terrain, scare, entityNode(sim.world, terrain, cow));
    expect(fled).toBeGreaterThan(before);

    // The scare lapses: the marker is shed and the animal is the herd drives' again.
    for (let i = 0; i < FRIGHT_DURATION_TICKS; i++) sim.step();
    expect(sim.world.has(cow, Frightened)).toBe(false);
  });

  it('the lapse tick hands the animal straight back to herding (fright runs before the recall)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    // A two-cow herd: the leader far outside the scare (and beyond the herd's leader distance from
    // wherever the scatter ends), the follower at the mark.
    const leader = wildAtNode(sim, 10, 40, COW);
    const follower = wildAtNode(sim, 40, 40, COW);
    sim.world.add(leader, HerdMember, { leader });
    sim.world.add(follower, HerdMember, { leader });
    frightenKin(sim.world, ctxOf(sim), terrain, follower, terrain.nodeAt(38, 40));
    expect(sim.world.has(follower, Frightened)).toBe(true);
    expect(sim.world.has(leader, Frightened)).toBe(false); // out of the scare radius

    // Step to the lapse: the schedule runs fright BEFORE herding, so the very tick the marker is shed
    // the recall route is already issued - the calmed follower never stands a tick unowned.
    let guard = FRIGHT_DURATION_TICKS * 3;
    while (sim.world.has(follower, Frightened) && guard-- > 0) sim.step();
    expect(sim.world.has(follower, Frightened)).toBe(false);
    expect(isTravelling(sim.world, follower)).toBe(true); // herding's pull, same tick as the calm-down
  });

  it('the scare stamps the struck animal itself and the herd standing beside it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    // The helper driven directly; the next cases drive it through real shots.
    const cow = wildAtNode(sim, 44, 40, COW);
    const bystander = wildAtNode(sim, 45, 41, COW);
    const shooterAt = terrain.nodeAt(36, 40);
    frightenKin(sim.world, ctxOf(sim), terrain, cow, shooterAt);

    expect(sim.world.get(cow, Frightened).from).toBe(shooterAt); // the struck animal runs from the shooter
    expect(sim.world.has(bystander, Frightened)).toBe(true); // and so does the herd beside it
  });

  it('a shot that lands on its quarry scatters the herd away from the shooter', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    const shooter = fighterAtNode(sim, 30, 40, VIKING, HUNTER);
    const cow = wildAtNode(sim, 40, 40, COW);
    const bystander = wildAtNode(sim, 42, 41, COW);
    loose(sim, shooter, cow, positionOfNode(40, 40));
    stepUntilLanded(sim);

    const shooterAt = entityNode(sim.world, terrain, shooter);
    expect(sim.world.get(cow, Health).hitpoints).toBeLessThan(1000); // the arrow struck
    expect(sim.world.get(cow, Frightened).from).toBe(shooterAt);
    expect(sim.world.get(bystander, Frightened).from).toBe(shooterAt);
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

  it('a flight runs from the attacker without leaving the territory', () => {
    const sim = new Simulation({ seed: 1, content: territorialCowContent(), map: grassCellMap(64, 64) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    const range = stayPointRangeOf(sim.content, COW);
    const home = terrain.nodeAt(40, 40);
    const threat = terrain.nodeAt(30, 40);
    const cow = wildAtNode(sim, 40, 40, COW);
    frightenKin(sim.world, ctxOf(sim), terrain, cow, threat);

    let farthest = 0;
    for (let i = 0; i < FRIGHT_DURATION_TICKS; i++) {
      sim.step();
      farthest = Math.max(farthest, manhattan(terrain, home, entityNode(sim.world, terrain, cow)));
    }
    const fled = manhattan(terrain, threat, entityNode(sim.world, terrain, cow));
    expect(fled).toBeGreaterThan(manhattan(terrain, threat, home)); // it ran from the attacker
    expect(farthest).toBeLessThanOrEqual(range); // and kept to its range
  });

  it('game at the edge of its territory stands rather than leave it', () => {
    const sim = new Simulation({ seed: 1, content: territorialCowContent(), map: grassCellMap(64, 64) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    const range = stayPointRangeOf(sim.content, COW);
    // At the east rim of its territory, scared from the west: every way out of the threat leaves it.
    const cow = wildAtNode(sim, 40 + range, 40, COW);
    sim.world.mut(cow, StayPoint).cell = terrain.nodeAt(40, 40);
    frightenKin(sim.world, ctxOf(sim), terrain, cow, terrain.nodeAt(30, 40));

    let farthest = 0;
    for (let i = 0; i < FRIGHT_DURATION_TICKS; i++) {
      sim.step();
      const home = manhattan(terrain, terrain.nodeAt(40, 40), entityNode(sim.world, terrain, cow));
      farthest = Math.max(farthest, home);
    }
    expect(farthest).toBeLessThanOrEqual(range);
  });

  it('game driven out of its territory may still flee homeward', () => {
    const sim = new Simulation({ seed: 1, content: territorialCowContent(), map: grassCellMap(64, 64) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    const range = stayPointRangeOf(sim.content, COW);
    const home = terrain.nodeAt(40, 40);
    const cow = wildAtNode(sim, 40 + range + 6, 40, COW); // outside its range, east of home
    sim.world.mut(cow, StayPoint).cell = home;
    const before = manhattan(terrain, home, entityNode(sim.world, terrain, cow));
    frightenKin(sim.world, ctxOf(sim), terrain, cow, terrain.nodeAt(60, 40)); // struck from the east

    for (let i = 0; i < FRIGHT_DURATION_TICKS; i++) sim.step();
    expect(manhattan(terrain, home, entityNode(sim.world, terrain, cow))).toBeLessThan(before);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const scatter = (): { hash: string; fled: boolean } => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
      const cow = wildAtNode(sim, 41, 40, COW);
      wildAtNode(sim, 40, 42, DEER);
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('test map missing');
      const scare = terrain.nodeAt(40, 40);
      const before = manhattan(terrain, scare, entityNode(sim.world, terrain, cow));
      frightenKin(sim.world, ctxOf(sim), terrain, cow, scare);
      for (let i = 0; i < FRIGHT_DURATION_TICKS; i++) sim.step();
      const after = manhattan(terrain, scare, entityNode(sim.world, terrain, cow));
      return { hash: sim.hashState(), fled: after > before };
    };
    const a = scatter();
    const b = scatter();
    expect(a.fled).toBe(true); // the scatter really ran (not a vacuous hash)
    expect(a.hash).toBe(b.hash);
  });
});
