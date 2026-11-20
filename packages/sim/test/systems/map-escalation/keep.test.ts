import { MapSiege } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Owner, Person } from '../../../src/components/index.js';
import { spawnPostedAtKeep } from '../../../src/systems/map-escalation/keep.js';
import { ctxOf } from '../../fixtures/context.js';
import { BOWMAN, keepWorld, PLAYER, SIEGE, TARGET } from '../../fixtures/map-escalation/keep.js';

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
});
