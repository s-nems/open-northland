import { describe, expect, it } from 'vitest';
import { Position, Velocity } from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import { World } from '../../src/ecs/world.js';
import { EventBuffer, fx, Rng } from '../../src/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { movementSystem } from '../../src/systems/index.js';

/**
 * The movement step's arithmetic contract: a fixed-point position advances by exactly its velocity
 * every tick. Run-to-run equality is the fuzz suite's claim, not this file's.
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

describe('determinism', () => {
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
});
