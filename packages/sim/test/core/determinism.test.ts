import { describe, expect, it } from 'vitest';
import { Position, Velocity } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { CommandQueue, EventBuffer, fx, Rng } from '../../src/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { movementSystem } from '../../src/systems/index.js';

/**
 * Determinism golden tests. These are the safety net for the golden rule: same seed + same inputs
 * => identical state. When a mechanic changes intentionally, update the expected value. If it
 * changes accidentally, this fails — which is exactly the point.
 */

function ctx(seed: number, tick: number): SystemContext {
  // content is unused by movementSystem; cast a minimal stub for the slice test.
  return {
    content: {} as never,
    rng: new Rng(seed),
    tick,
    events: new EventBuffer(),
    commands: new CommandQueue(),
  };
}

function buildWorld(): World {
  const w = new World();
  for (let i = 0; i < 10; i++) {
    const e = w.create();
    w.add(e, Position, { x: fx.fromInt(i), y: fx.fromInt(0) });
    w.add(e, Velocity, { x: fx.fromInt(1), y: fx.fromInt(2) });
  }
  return w;
}

function hashPositions(w: World): string {
  let h = 2166136261 >>> 0;
  const mix = (n: number): void => {
    h ^= n | 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  for (const e of w.query(Position)) {
    const p = w.get(e, Position);
    mix(e);
    mix(p.x);
    mix(p.y);
  }
  return h.toString(16).padStart(8, '0');
}

describe('determinism', () => {
  it('movementSystem produces identical state from identical inputs', () => {
    const a = buildWorld();
    const b = buildWorld();
    for (let t = 1; t <= 100; t++) {
      movementSystem(a, ctx(1234, t));
      movementSystem(b, ctx(1234, t));
    }
    expect(hashPositions(a)).toBe(hashPositions(b));
  });

  it('positions advance by velocity deterministically', () => {
    const w = buildWorld();
    for (let t = 1; t <= 5; t++) movementSystem(w, ctx(1, t));
    // first entity started at (0,0) with velocity (1,2): after 5 ticks -> (5,10)
    const [first] = w.canonicalEntities();
    if (first === undefined) throw new Error('expected at least one entity');
    const p = w.get(first, Position);
    expect(fx.toInt(p.x)).toBe(5);
    expect(fx.toInt(p.y)).toBe(10);
  });

  it('seeded RNG is reproducible', () => {
    const r1 = new Rng(42);
    const r2 = new Rng(42);
    const seq1 = Array.from({ length: 8 }, () => r1.int(1000));
    const seq2 = Array.from({ length: 8 }, () => r2.int(1000));
    expect(seq1).toEqual(seq2);
  });
});
