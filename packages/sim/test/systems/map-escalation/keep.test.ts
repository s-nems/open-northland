import { MapSiege } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Owner, Person } from '../../../src/components/index.js';
import { siegeJobs, spawnPostedAtKeep } from '../../../src/systems/map-escalation/keep.js';
import { ctxOf } from '../../fixtures/context.js';
import {
  BOWMAN,
  keepWorld,
  PLAYER,
  SIEGE,
  SPEARMAN,
  SPEARMAN_SLUG,
  TARGET,
} from '../../fixtures/map-escalation/keep.js';

describe('map escalation - posting a man made at the keep', () => {
  it('takes back a man the workplace refuses, so a refused post leaves nobody behind', () => {
    const { sim } = keepWorld();
    // Another seat's house offers the fortress's man no post.
    const foreign = [...sim.world.query(Building, Owner)].find(
      (e) => sim.world.get(e, Owner).player === PLAYER,
    );
    if (foreign === undefined) throw new Error('no house');
    const people = () => [...sim.world.query(Person)].length;
    const before = people();
    const siege = MapSiege.parse(SIEGE);
    const anchor = { hx: TARGET.x, hy: TARGET.y };
    expect(spawnPostedAtKeep(sim.world, ctxOf(sim), siege, BOWMAN, foreign, anchor)).toBeNull();
    expect(people()).toBe(before);
  });

  it('sends only fighters of the mix, the men the guard cap counts', () => {
    const { sim } = keepWorld();
    const mix = [
      { job: 'woman', weight: 1 },
      { job: SPEARMAN_SLUG, weight: 1 },
    ];
    const siege = MapSiege.parse({ ...SIEGE, jobMix: mix });
    const MEN = 4;
    expect(siegeJobs(ctxOf(sim), siege, MEN)).toEqual([SPEARMAN, SPEARMAN]);
  });
});
