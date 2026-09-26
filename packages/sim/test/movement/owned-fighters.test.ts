import { describe, expect, it } from 'vitest';
import { Owner, Settler, setSettlerJob } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { ownedFighters, standingFighterPosts } from '../../src/systems/index.js';
import { P0, P1, SOLDIER, settlerAt, sim, WOODCUTTER } from './separation/support.js';

const fightersOf = (s: Simulation): readonly Entity[] => [...ownedFighters(s.world, s.content)];

describe('ownedFighters index', () => {
  it('follows trade, owner, death and spawn changes between reads, in ascending id', () => {
    const s = sim();
    const soldier = settlerAt(s, 2, 2, SOLDIER, P0);
    const cutter = settlerAt(s, 4, 2, WOODCUTTER, P0);
    const unowned = settlerAt(s, 6, 2, SOLDIER, null);
    const rival = settlerAt(s, 8, 2, SOLDIER, P1);
    expect(fightersOf(s)).toEqual([soldier, rival]);

    setSettlerJob(s.world, cutter, SOLDIER);
    expect(fightersOf(s)).toEqual([soldier, cutter, rival]);
    setSettlerJob(s.world, soldier, WOODCUTTER);
    expect(fightersOf(s)).toEqual([cutter, rival]);

    s.world.add(unowned, Owner, { player: P1 });
    s.world.remove(rival, Owner);
    expect(fightersOf(s)).toEqual([cutter, unowned]);

    s.world.destroy(cutter);
    const recruit = settlerAt(s, 10, 2, SOLDIER, P0);
    expect(fightersOf(s)).toEqual([unowned, recruit]);
    expect(s.world.verifyCaches()).toEqual([]);
  });

  it('verifies a trade change written after the last read', () => {
    const s = sim();
    const cutter = settlerAt(s, 4, 2, WOODCUTTER, P0);
    ownedFighters(s.world, s.content);
    setSettlerJob(s.world, cutter, SOLDIER);
    expect(s.world.verifyCaches()).toEqual([]);
    expect(fightersOf(s)).toEqual([cutter]);
  });

  it('gives a node two standing fighters share to the higher id', () => {
    const s = sim();
    const lower = settlerAt(s, 4, 2, SOLDIER, P1);
    settlerAt(s, 4, 2, SOLDIER, P0);
    // Re-added last, so a scan in store order would visit the lower id after the higher one.
    const settler = { ...s.world.get(lower, Settler) };
    s.world.remove(lower, Settler);
    s.world.add(lower, Settler, settler);
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('fixture map missing');
    expect(standingFighterPosts(s.world, s.content, terrain).get(terrain.nodeAt(4, 2))).toBe(P0);
  });
});
