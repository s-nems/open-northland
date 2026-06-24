import type { ContentSet } from '@vinland/data';
import { World, type Entity } from './ecs/world.js';
import { Rng } from './rng.js';
import { Position } from './components/index.js';
import { SYSTEM_ORDER, type SystemContext } from './systems/index.js';
import { fx } from './fixed.js';

export { World, defineComponent } from './ecs/world.js';
export type { Entity, Component } from './ecs/world.js';
export { Rng } from './rng.js';
export { fx, ONE, type Fixed } from './fixed.js';
export { FixedTimestep, TICKS_PER_SECOND, MS_PER_TICK } from './loop.js';
export * as components from './components/index.js';
export * as systems from './systems/index.js';

export interface SimOptions {
  seed: number;
  content: ContentSet;
  // map: MapData;  // added in Phase 2 when the map decoder exists
}

/**
 * The simulation: owns the world, the RNG, and the system schedule. Advance one deterministic
 * tick with `step()`. No rendering, no I/O — see docs/ECS.md.
 */
export class Simulation {
  readonly world = new World();
  readonly rng: Rng;
  readonly content: ContentSet;
  private currentTick = 0;

  constructor(opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    this.content = opts.content;
  }

  get tick(): number {
    return this.currentTick;
  }

  /** Advance exactly one tick by running every system in order. */
  step(): void {
    this.currentTick++;
    const ctx: SystemContext = { content: this.content, rng: this.rng, tick: this.currentTick };
    for (const system of SYSTEM_ORDER) {
      system(this.world, ctx);
    }
  }

  /** Run N ticks. */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /**
   * A stable, order-independent hash of state that matters for determinism golden tests.
   * Currently hashes tick, RNG state, and all entity positions. Extend as state grows.
   */
  hashState(): string {
    let h = 2166136261 >>> 0; // FNV-1a
    const mix = (n: number): void => {
      h ^= n | 0;
      h = Math.imul(h, 16777619) >>> 0;
    };
    mix(this.currentTick);
    mix(this.rng.getState());
    const ids: Entity[] = [...this.world.query(Position)];
    mix(ids.length);
    for (const e of ids) {
      const p = this.world.get(e, Position);
      mix(e);
      mix(p.x);
      mix(p.y);
    }
    return h.toString(16).padStart(8, '0');
  }
}

/** Re-export so the golden test can build a trivially-correct fixture without content. */
export function spawnAt(world: World, x: number, y: number): Entity {
  const e = world.create();
  world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  return e;
}
