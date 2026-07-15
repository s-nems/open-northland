import { describe, expect, it } from 'vitest';
import { PathFollow } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { orderTo, P0, P1, SOLDIER, settlerAt, sim } from './support.js';

describe('unit body collision — crowded determinism', () => {
  it('a crowd mass-ordered onto one node never crashes mid-tick and every walker stands down', () => {
    // The reported crash: "everyone move to one spot". In the packed crowd an early-processed
    // walker drops its OWN PathFollow inside the separation loop (the grind re-route/stand-down of
    // a contested destination) while a later-processed neighbour still overlaps it — the convoy
    // rule must read the tick SNAPSHOT, not the live component, or this run throws
    // "entity N has no component PathFollow".
    const s = sim();
    const crowd: Entity[] = [];
    for (let i = 0; i < 12; i++) {
      crowd.push(settlerAt(s, 4 + (i % 4) * 2, 2 + Math.floor(i / 4) * 3, SOLDIER, P0));
    }
    for (const e of crowd) orderTo(s, e, 12, 6);
    s.run(600); // long enough for every walker to arrive, or stand down via the re-route backstop

    for (const e of crowd) {
      expect(s.world.has(e, PathFollow)).toBe(false); // settled — arrived or stood down, no orbiting
    }
  });

  it('is deterministic: the same collision scenario replayed from scratch hashes identically', () => {
    const play = (): string => {
      const s = sim();
      const east = settlerAt(s, 4, 6, SOLDIER, P0);
      const west = settlerAt(s, 16, 6, SOLDIER, P0);
      settlerAt(s, 10, 6, SOLDIER, P1); // an enemy post right on the crossing line
      orderTo(s, east, 16, 6);
      orderTo(s, west, 4, 6);
      s.run(200);
      return s.hashState();
    };
    const first = play();
    expect(play()).toBe(first);
  });
});
