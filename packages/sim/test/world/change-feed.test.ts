import { describe, expect, it } from 'vitest';
import { CHANGE_FEED_LIMIT } from '../../src/ecs/change-feed.js';
import { defineComponent, type Entity, World } from '../../src/ecs/world.js';

/** `World.watchChanges`: one entity log across several stores' membership and value writes. */

interface Tag {
  n: number;
}

const Watched = defineComponent<Tag>('FeedWatched', 'economy');
const Valued = defineComponent<Tag>('FeedValued', 'economy');
const Ignored = defineComponent<Tag>('FeedIgnored', 'economy');

function drained(feed: { drain(consume: (e: Entity) => void): boolean }): Entity[] | 'rebuild' {
  const out: Entity[] = [];
  return feed.drain((e) => out.push(e)) ? 'rebuild' : out;
}

describe('World change feeds', () => {
  it('logs watched membership changes and value writes across stores, in order', () => {
    const w = new World();
    const feed = w.watchChanges([Watched], [Valued]);
    const a = w.create();
    const b = w.create();
    w.add(a, Watched, { n: 1 });
    w.add(b, Valued, { n: 1 }); // membership of a values-only store is not watched
    w.add(b, Ignored, { n: 1 });
    w.mut(b, Valued).n = 2;
    w.mut(b, Valued).n = 3; // an immediate repeat is dropped
    w.destroy(a);
    expect(feed.pending).toBe(true);
    expect(drained(feed)).toEqual([a, b, a]);
    expect(feed.pending).toBe(false);
  });

  it('asks its reader to rebuild after an overflow or a restored store', () => {
    const w = new World();
    const feed = w.watchChanges([Watched], []);
    for (let i = 0; i <= CHANGE_FEED_LIMIT; i++) w.add(w.create(), Watched, { n: i });
    expect(drained(feed)).toBe('rebuild');
    expect(drained(feed)).toEqual([]);

    const restored = new World();
    const restoredFeed = restored.watchChanges([Watched], []);
    restored.restoreStore(Watched, [[restored.create(), { n: 1 }]]);
    expect(drained(restoredFeed)).toBe('rebuild');
  });
});
