import { describe, expect, it } from 'vitest';
import { World } from '../../src/ecs/world.js';
import { defineWorldSingleton } from '../../src/ecs/world-singleton.js';

/**
 * The shape every rule singleton in `components/rules.ts` shares. Two contracts carry hashes: a world that
 * never writes must hold no carrier at all, and a world that somehow holds two must read the lower id, so
 * the hashed value never depends on which carrier was added first.
 */

const Toggle = defineWorldSingleton<{ on: boolean; seen: Map<number, number> }>('Toggle', () => ({
  on: true,
  seen: new Map(),
}));

describe('defineWorldSingleton', () => {
  it('reads the defaults while no entity carries the component', () => {
    const w = new World();
    expect(Toggle.read(w).on).toBe(true);
    expect(Toggle.read(w).seen.size).toBe(0);
    expect(w.lowestEntityWith(Toggle.component)).toBeNull();
  });

  it('creates exactly one carrier on the first write and mutates it thereafter', () => {
    const w = new World();
    Toggle.write(w, (v) => {
      v.on = false;
    });
    const carrier = w.lowestEntityWith(Toggle.component);
    Toggle.write(w, (v) => {
      v.seen.set(3, 7);
    });
    expect(w.lowestEntityWith(Toggle.component)).toBe(carrier);
    expect([...w.query(Toggle.component)]).toHaveLength(1);
    expect(Toggle.read(w).on).toBe(false);
    expect(Toggle.read(w).seen.get(3)).toBe(7);
  });

  it('reads and writes the lowest-id carrier, not the first one added', () => {
    const w = new World();
    const low = w.create();
    const high = w.create();
    w.add(high, Toggle.component, { on: false, seen: new Map([[9, 9]]) }); // added first, higher id
    w.add(low, Toggle.component, { on: true, seen: new Map() });

    expect(Toggle.read(w).on).toBe(true);
    expect(Toggle.read(w).seen.size).toBe(0);

    Toggle.write(w, (v) => {
      v.on = false;
      v.seen.set(1, 1);
    });
    expect(w.get(low, Toggle.component).seen.get(1)).toBe(1);
    expect([...w.get(high, Toggle.component).seen]).toEqual([[9, 9]]);
  });

  it('keeps one world default-reading after another world has written', () => {
    const written = new World();
    Toggle.write(written, (v) => {
      v.on = false;
      v.seen.set(2, 2);
    });
    const fresh = new World();
    expect(Toggle.read(fresh).on).toBe(true);
    expect(Toggle.read(fresh).seen.size).toBe(0);
  });
});
