import { expect } from 'vitest';
import {
  MoveGoal,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
  Settler,
} from '../../src/components/index.js';
import { diffSnapshots, nodeOfPosition, type Simulation, type WorldSnapshot } from '../../src/index.js';

/** A mirror reads the same world as the live snapshot: the tick, every entity's components by name
 *  (a mirror may list a component added to a held entity in another key order) and the events. */
export function expectSameWorld(mirrored: WorldSnapshot, live: WorldSnapshot): void {
  expect(mirrored.tick).toBe(live.tick);
  expect(diffSnapshots(mirrored, live)).toEqual({
    fromTick: live.tick,
    toTick: live.tick,
    added: [],
    removed: [],
    changed: [],
  });
  expect(JSON.stringify(mirrored.events)).toBe(JSON.stringify(live.events));
}

/** Walk every settler standing still to the other end of the top node row, from `0` to `eastHx`, so a
 *  parity run writes components every tick: an idle settler's need bars are derived, not rewritten. */
export function keepSettlersWalking(sim: Simulation, eastHx: number): void {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('a walking settlement needs a map');
  for (const e of sim.world.canonicalQuery(Settler)) {
    const pos = sim.world.tryGet(e, Position);
    if (pos === undefined) continue;
    const w = sim.world;
    if (w.has(e, MoveGoal) || w.has(e, PathRequest) || w.has(e, PathRoute) || w.has(e, PathFollow)) continue;
    const hx = nodeOfPosition(pos.x, pos.y).hx;
    sim.world.add(e, MoveGoal, { cell: terrain.nodeAt(hx * 2 < eastHx ? eastHx : 0, 0) });
  }
}
