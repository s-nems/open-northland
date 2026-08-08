import { describe, expect, it } from 'vitest';
import { Frightened, HerdMember, Resting, StayPoint } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import {
  FRIGHT_DURATION_TICKS,
  FRIGHT_RADIUS_NODES,
  frightenWildlifeNear,
} from '../../src/systems/conflict/fright.js';
import { isTravelling } from '../../src/systems/movement/nav-state.js';
import { manhattan } from '../../src/systems/spatial/metric.js';
import { entityNode } from '../../src/systems/spatial/nodes.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { BEAR, COW, DEER, fighterAtNode } from './combat-system/support.js';

/**
 * The wildlife FRIGHT reaction: a loosed shot scares the passive animals around its mark into
 * scattering (`frightenWildlifeNear` stamps {@link Frightened}, the `animalFrightSystem` runs them away
 * from it), aggressive species and out-of-radius animals stand, and a lapsed scare hands the animal
 * back to its herd drives. Wildlife = a {@link StayPoint} carrier, so the plain combat fixtures (which
 * stamp none) stay scare-free.
 */

/** A wild animal: a fixture combatant plus the roaming StayPoint marker the scare targets. */
function wildAtNode(sim: Simulation, hx: number, hy: number, tribe: number): Entity {
  const e = fighterAtNode(sim, hx, hy, tribe, null);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('test map missing');
  sim.world.add(e, StayPoint, { cell: entityNode(sim.world, terrain, e) });
  return e;
}

describe('frightenWildlifeNear - who the scare reaches', () => {
  it('stamps passive wildlife in radius; aggressive, distant, and marker-less animals stand', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const cow = wildAtNode(sim, 42, 40, COW); // passive, 2 nodes off the mark
    const deer = wildAtNode(sim, 40, 44, DEER); // passive (getAngry ≠ aggressive), 4 nodes off
    const bear = wildAtNode(sim, 40, 41, BEAR); // AGGRESSIVE - answers threat with threat
    const far = wildAtNode(sim, 40 + FRIGHT_RADIUS_NODES + 2, 40, COW); // beyond the scare
    const plain = fighterAtNode(sim, 41, 40, COW, null); // no StayPoint - not roaming wildlife
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');

    frightenWildlifeNear(sim.world, ctxOf(sim), terrain, terrain.nodeAt(40, 40));

    expect(sim.world.has(cow, Frightened)).toBe(true);
    expect(sim.world.has(deer, Frightened)).toBe(true);
    expect(sim.world.has(bear, Frightened)).toBe(false);
    expect(sim.world.has(far, Frightened)).toBe(false);
    expect(sim.world.has(plain, Frightened)).toBe(false);
  });

  it('leaves an animal inside a building alone - a shot outdoors must not walk it out', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const indoors = wildAtNode(sim, 41, 40, COW); // one node off the mark, but on a farm's feed batch
    sim.world.add(indoors, Resting, { at: sim.world.create() });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');

    frightenWildlifeNear(sim.world, ctxOf(sim), terrain, terrain.nodeAt(40, 40));

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
    frightenWildlifeNear(sim.world, ctxOf(sim), terrain, scare);
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
    frightenWildlifeNear(sim.world, ctxOf(sim), terrain, terrain.nodeAt(40, 40));
    expect(sim.world.has(follower, Frightened)).toBe(true);
    expect(sim.world.has(leader, Frightened)).toBe(false); // out of the scare radius

    // Step to the lapse: the schedule runs fright BEFORE herding, so the very tick the marker is shed
    // the recall route is already issued - the calmed follower never stands a tick unowned.
    let guard = FRIGHT_DURATION_TICKS * 3;
    while (sim.world.has(follower, Frightened) && guard-- > 0) sim.step();
    expect(sim.world.has(follower, Frightened)).toBe(false);
    expect(isTravelling(sim.world, follower)).toBe(true); // herding's pull, same tick as the calm-down
  });

  it('the scare stamps the shot-at animal itself and the herd standing beside it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    // The helper driven directly (the launch-seam integration lives in hunter-aim.test.ts).
    const cow = wildAtNode(sim, 44, 40, COW);
    const bystander = wildAtNode(sim, 45, 41, COW);
    frightenWildlifeNear(sim.world, ctxOf(sim), terrain, entityNode(sim.world, terrain, cow));

    expect(sim.world.has(cow, Frightened)).toBe(true); // the shot-at animal itself bolts
    expect(sim.world.has(bystander, Frightened)).toBe(true); // and so does the herd beside it
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
      frightenWildlifeNear(sim.world, ctxOf(sim), terrain, scare);
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
