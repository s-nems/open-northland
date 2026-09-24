import { describe, expect, it } from 'vitest';
import { HuntFocus, Owner } from '../../src/components/index.js';
import { ownerOf, ownersCompatible } from '../../src/components/ownership.js';
import { type Entity, World } from '../../src/ecs/world.js';
import { preyHeldByOthers } from '../../src/systems/conflict/hunting/prey-holds.js';

const P0 = 0;
const P1 = 1;

/** The definition the memo must answer: every same-side hold but `self`'s own, rebuilt from scratch. */
function freshHolds(world: World, self: Entity): ReadonlySet<Entity> {
  const held = new Set<Entity>();
  for (const other of world.query(HuntFocus)) {
    if (other === self || !ownersCompatible(ownerOf(world, self), ownerOf(world, other))) continue;
    held.add(world.get(other, HuntFocus).target);
  }
  return held;
}

describe('preyHeldByOthers - the per-world prey-hold memo', () => {
  it('matches a fresh set after every hold stamped, moved, dropped or re-owned within one tick', () => {
    const world = new World();
    const owned = (player: number | undefined): Entity => {
      const e = world.create();
      if (player !== undefined) world.add(e, Owner, { player });
      return e;
    };
    const a = owned(P0);
    const b = owned(P0);
    const idle = owned(P0);
    const rival = owned(P1);
    const neutral = owned(undefined);
    const hunters = [a, b, idle, rival, neutral];
    const deer = world.create();
    const hare = world.create();
    const boar = world.create();
    const prey = [deer, hare, boar];

    const steps: ReadonlyArray<() => void> = [
      () => world.add(a, HuntFocus, { target: deer }),
      () => world.add(b, HuntFocus, { target: deer }),
      () => world.add(rival, HuntFocus, { target: hare }),
      () => world.add(neutral, HuntFocus, { target: boar }),
      () => world.add(a, HuntFocus, { target: hare }),
      () => world.remove(b, HuntFocus),
      () => world.add(rival, Owner, { player: P0 }),
      () => world.remove(neutral, Owner),
      () => world.destroy(a),
    ];
    const agree = (): void => {
      for (const self of hunters) {
        if (!world.isAlive(self)) continue;
        const memo = preyHeldByOthers(world, self);
        const fresh = freshHolds(world, self);
        for (const t of prey) expect(memo(t)).toBe(fresh.has(t));
      }
    };
    agree();
    for (const step of steps) {
      step();
      agree();
    }
  });
});
