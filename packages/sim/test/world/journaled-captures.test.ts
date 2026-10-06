import { describe, expect, it } from 'vitest';
import { GENERATION_JOURNAL_LIMIT } from '../../src/ecs/generation-journal.js';
import { JournaledCaptures } from '../../src/ecs/journaled-captures.js';
import { defineComponent, type Entity, World } from '../../src/ecs/world.js';

const Held = defineComponent<{ n: number }>('JournaledHeld', 'economy');
const Weight = defineComponent<{ kg: number }>('JournaledWeight', 'economy');

/** A view summing each holder's weight, logging the order its captures are refreshed in. */
function weighed(world: World) {
  const refreshed: Entity[] = [];
  let total = 0;
  let rebuilds = 0;
  const view = new JournaledCaptures<{ kg: number }>(
    world,
    { membership: [Held], values: [Weight] },
    () => world.query(Held),
    {
      capture: (e) => {
        refreshed.push(e);
        const w = world.has(e, Held) ? world.tryGet(e, Weight) : undefined;
        return w === undefined ? null : { kg: w.kg };
      },
      apply: (_e, c) => {
        total += c.kg;
      },
      withdraw: (_e, c) => {
        total -= c.kg;
      },
      clear: () => {
        total = 0;
        rebuilds++;
      },
    },
  );
  return { view, refreshed, total: () => total, rebuilds: () => rebuilds };
}

describe('journaled captures', () => {
  it('refreshes each changed entity once, in the order the journals first name it', () => {
    const world = new World();
    const [a, b, c] = [world.create(), world.create(), world.create()];
    for (const e of [a, b, c]) {
      world.add(e, Held, { n: 0 });
      world.add(e, Weight, { kg: 1 });
    }
    const v = weighed(world);
    expect(v.total()).toBe(3);
    v.refreshed.length = 0;
    world.mut(c, Weight).kg = 5;
    world.remove(b, Held);
    world.mut(c, Weight).kg = 7;
    world.mut(a, Weight).kg = 2;
    v.view.catchUp();
    // Membership first, then value writes; c is named twice and refreshed once.
    expect(v.refreshed).toEqual([b, c, a]);
    expect(v.total()).toBe(9);
    v.refreshed.length = 0;
    v.view.catchUp();
    expect(v.refreshed).toEqual([]);
  });

  it('rebuilds when the journal no longer covers the span', () => {
    const world = new World();
    const e = world.create();
    world.add(e, Held, { n: 0 });
    world.add(e, Weight, { kg: 1 });
    const v = weighed(world);
    const before = v.rebuilds();
    for (let i = 0; i <= GENERATION_JOURNAL_LIMIT; i++) world.mut(e, Weight).kg = i;
    v.view.catchUp();
    expect(v.rebuilds()).toBe(before + 1);
    expect(v.total()).toBe(GENERATION_JOURNAL_LIMIT);
  });
});
