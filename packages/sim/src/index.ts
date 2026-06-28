import type { ContentSet } from '@vinland/data';
import { type Command, CommandQueue } from './commands.js';
import { Position } from './components/index.js';
import { type Entity, World } from './ecs/world.js';
import { EventBuffer } from './events.js';
import { fx } from './fixed.js';
import { Rng } from './rng.js';
import { type WorldSnapshot, takeSnapshot } from './snapshot.js';
import { SYSTEM_ORDER, type SystemContext } from './systems/index.js';
import { type TerrainGraph, type TerrainMap, buildTerrainGraph } from './terrain.js';

export { World, defineComponent } from './ecs/world.js';
export type { Entity, Component } from './ecs/world.js';
export { Rng } from './rng.js';
export { fx, ONE, type Fixed } from './fixed.js';
export { FixedTimestep, TICKS_PER_SECOND, MS_PER_TICK } from './loop.js';
export * as components from './components/index.js';
export * as systems from './systems/index.js';
export {
  scenario,
  Scenario,
  type ScenarioOptions,
  type ScenarioResult,
  type RunOptions,
} from './scenario.js';
export type { Brand } from './brand.js';
export { assertNever } from './brand.js';
export {
  type Command,
  type CommandKind,
  type AtomicEffect,
  type AtomicEffectKind,
  type LoggedCommand,
  CommandQueue,
} from './commands.js';
export { EventBuffer, type SimEvent, type SimEventKind } from './events.js';
export { takeSnapshot, type WorldSnapshot, type EntitySnapshot } from './snapshot.js';
export {
  diffSnapshots,
  type SnapshotDiff,
  type ChangedEntity,
  type ComponentChange,
} from './snapshot-diff.js';
export {
  TerrainGraph,
  buildTerrainGraph,
  cellManhattanDistance,
  type CellId,
  type TerrainMap,
} from './terrain.js';
export { findPath } from './pathfinding.js';
export { replay, type ReplayOptions } from './replay.js';
export {
  HashTrace,
  type HashTraceEntry,
  type HashTraceOptions,
  type Divergence,
} from './hashtrace.js';
export { seedAnimalHerds, type SeedAnimalsOptions } from './populate.js';
export {
  checkInvariants,
  CORE_INVARIANTS,
  type Invariant,
  stockNonNegative,
  hungerInRange,
  fatigueInRange,
  pietyInRange,
  enjoymentInRange,
  buildingSane,
  populationWithinHousing,
} from './invariants.js';

/** Run the core invariants against the current world (dev/test convenience). */
import { type Invariant as _Invariant, checkInvariants as _checkInvariants } from './invariants.js';

export interface SimOptions {
  seed: number;
  content: ContentSet;
  /**
   * The terrain map (dimensions + row-major landscape-typeId grid). Optional: trivial fixtures and
   * the determinism golden run mapless. When given, the sim builds the cell-adjacency graph once and
   * exposes it as the `terrain` resource on every system's context. The full `map.cif` tile-grid
   * decoder will feed this in Phase 2 — for now a scenario/test supplies a small synthetic grid.
   */
  map?: TerrainMap;
}

/**
 * The simulation: owns the world, the RNG, and the system schedule. Advance one deterministic
 * tick with `step()`. No rendering, no I/O — see docs/ECS.md.
 */
export class Simulation {
  readonly world = new World();
  readonly rng: Rng;
  readonly content: ContentSet;
  /**
   * The terrain cell-adjacency graph (navigation/placement), or undefined for a mapless sim. Built
   * once at construction from `opts.map` so per-tick lookups are pure array reads. A world resource,
   * not entities — it isn't hashed (immutable input, like content), so it never affects determinism.
   */
  readonly terrain?: TerrainGraph;
  /** One-shot events produced during the current tick (drained by render/audio). */
  readonly events = new EventBuffer();
  /**
   * The serializable command queue — the ONLY way state mutates. Enqueue via {@link enqueue}; the
   * CommandSystem drains and applies it each tick (and logs it). A save is the command log.
   */
  readonly commands = new CommandQueue();
  private currentTick = 0;

  constructor(opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    this.content = opts.content;
    if (opts.map !== undefined) this.terrain = buildTerrainGraph(opts.content, opts.map);
  }

  get tick(): number {
    return this.currentTick;
  }

  /**
   * Queue a serializable command — the only way to mutate sim state from outside. It is applied (and
   * appended to the command log) by CommandSystem on the next `step()`. The UI, the AI, and a save
   * loader all go through here; nothing else pokes the world directly.
   */
  enqueue(command: Command): void {
    this.commands.enqueue(command);
  }

  /** Advance exactly one tick by running every system in order. */
  step(): void {
    this.currentTick++;
    this.events.clear(); // events for tick N are a pure function of this tick's systems
    const ctx: SystemContext = {
      content: this.content,
      rng: this.rng,
      tick: this.currentTick,
      events: this.events,
      commands: this.commands,
      // Only attach `terrain` when present: under exactOptionalPropertyTypes an optional property
      // must be omitted rather than set to undefined.
      ...(this.terrain !== undefined ? { terrain: this.terrain } : {}),
    };
    for (const system of SYSTEM_ORDER) {
      system(this.world, ctx);
    }
  }

  /**
   * An immutable read-view of the world at the current tick boundary — what `render`/audio consume
   * instead of the live component stores, so they never observe a half-applied tick. Plain data (no
   * class instances / live Maps), so it is also transferable to a render Web Worker for free. Pure:
   * a snapshot is a function of state and is never read back into sim logic.
   */
  snapshot(): WorldSnapshot {
    return takeSnapshot(this.world, this.currentTick, this.events.current());
  }

  /** Run N ticks. */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /** Run the core (or given) invariants against the current world; returns violation strings. */
  checkInvariants(invariants?: readonly _Invariant[]): string[] {
    return _checkInvariants(this.world, invariants);
  }

  /**
   * A canonical hash of ALL simulation state for determinism golden tests: tick, RNG state, and
   * every registered component on every alive entity, in canonical (ascending) order. If two runs
   * from the same seed + inputs diverge in ANY hashed field, this changes — which is the point.
   */
  hashState(): string {
    let h = 2166136261 >>> 0; // FNV-1a
    const mix = (n: number): void => {
      h ^= n | 0;
      h = Math.imul(h, 16777619) >>> 0;
    };
    const hashValue = (v: unknown): void => {
      if (typeof v === 'number') {
        // hash both halves so large fixed-point doubles are fully covered.
        mix(v | 0);
        mix(Math.trunc(v / 0x100000000));
      } else if (typeof v === 'boolean') {
        mix(v ? 1 : 0);
      } else if (v === null || v === undefined) {
        mix(0x9e3779b9);
      } else if (Array.isArray(v)) {
        mix(v.length);
        for (const item of v) hashValue(item);
      } else if (v instanceof Map) {
        for (const [k, val] of [...v.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
          hashValue(k);
          hashValue(val);
        }
      } else if (typeof v === 'object') {
        for (const k of Object.keys(v as object).sort()) {
          for (const ch of k) mix(ch.charCodeAt(0));
          hashValue((v as Record<string, unknown>)[k]);
        }
      }
    };

    mix(this.currentTick);
    mix(this.rng.getState());
    const ids = this.world.canonicalEntities();
    mix(ids.length);
    for (const e of ids) {
      mix(e);
      for (const [name, val] of this.world.componentEntries(e)) {
        for (const ch of name) mix(ch.charCodeAt(0));
        hashValue(val);
      }
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
