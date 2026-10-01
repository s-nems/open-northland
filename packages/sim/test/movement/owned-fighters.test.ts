import { describe, expect, it } from 'vitest';
import {
  Building,
  Owner,
  PathRequest,
  Position,
  Settler,
  setSettlerJob,
} from '../../src/components/index.js';
import { ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, type Simulation } from '../../src/index.js';
import { ownedFighters, standingFighterPosts, unitWalkBlocks } from '../../src/systems/index.js';
import {
  ANY_BUILDING_TYPE,
  P0,
  P1,
  SOLDIER,
  settlerAt,
  sim,
  WOODCUTTER,
  walkStraightTo,
} from './separation/support.js';

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

  it('keeps posts, their players and the town garrison in step with stands, moves and zones', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('fixture map missing');
    const at = (hx: number, hy: number) => terrain.nodeAt(hx, hy);
    const guard = settlerAt(s, 2, 2, SOLDIER, P0);
    const walker = settlerAt(s, 6, 2, SOLDIER, P1);
    const cutter = settlerAt(s, 8, 2, WOODCUTTER, P0);
    let units = unitWalkBlocks(s.world, s.content, terrain);
    expect([units.postTotal, units.posts[at(2, 2)], units.posts[at(6, 2)]]).toEqual([2, 1, 1]);
    expect(units.townByPlayer.size).toBe(0);

    walkStraightTo(s, walker, 10, 2);
    s.world.mut(guard, Position).x = positionOfNode(4, 2).x;
    s.world.add(cutter, PathRequest, { start: at(8, 2), goal: at(10, 2), failed: false });
    setSettlerJob(s.world, cutter, SOLDIER);
    units = unitWalkBlocks(s.world, s.content, terrain);
    expect([units.postTotal, units.posts[at(2, 2)], units.posts[at(4, 2)], units.posts[at(6, 2)]]).toEqual([
      1, 0, 1, 0,
    ]);

    s.world.mut(cutter, PathRequest).failed = true; // a failed request stands again
    s.world.mut(guard, Owner).player = P1;
    expect(standingFighterPosts(s.world, s.content, terrain).get(at(4, 2))).toBe(P1);
    expect(standingFighterPosts(s.world, s.content, terrain).get(at(8, 2))).toBe(P0);

    const hall = s.world.create();
    s.world.add(hall, Building, { buildingType: ANY_BUILDING_TYPE, tribe: 1, built: ONE, level: 0 });
    s.world.add(hall, Position, positionOfNode(4, 2));
    s.world.add(hall, Owner, { player: P1 });
    units = unitWalkBlocks(s.world, s.content, terrain);
    expect(units.townByPlayer.get(P1)?.get(at(4, 2))).toBe(1);
    expect(units.townTotalByPlayer.get(P1)).toBe(1);
    expect(s.world.verifyCaches()).toEqual([]);

    s.world.destroy(guard);
    expect(s.world.verifyCaches()).toEqual([]);
    units = unitWalkBlocks(s.world, s.content, terrain);
    expect([units.postTotal, units.townByPlayer.size]).toEqual([1, 0]);
  });
});
