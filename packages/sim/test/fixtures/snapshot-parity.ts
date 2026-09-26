import { expect } from 'vitest';
import { diffSnapshots, type WorldSnapshot } from '../../src/index.js';

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
