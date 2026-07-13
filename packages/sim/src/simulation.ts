import type { ContentSet } from '@open-northland/data';
import { FOG_MODE, fogMode, needsEnabled, Position } from './components/index.js';
import { CommandQueue } from './core/command-queue.js';
import type { Command } from './core/commands/index.js';
import { EventBuffer } from './core/events.js';
import { fx } from './core/fixed.js';
import { Rng } from './core/rng.js';
import { type Entity, World } from './ecs/world.js';
import { checkInvariants as _checkInvariants, type Invariant as _Invariant } from './harness/invariants.js';
import { takeSnapshot, type WorldSnapshot } from './inspect/snapshot.js';
import { buildTerrainGraph, type TerrainGraph, type TerrainMap } from './nav/terrain/index.js';
import type { SystemContext } from './systems/context.js';
import {
  type ConstructionPlot,
  constructionSitePlots,
  type PlacementProbe,
  placementBlockerVersion,
  placementProbe,
} from './systems/footprint/index.js';
import { SYSTEM_ORDER } from './systems/schedule.js';
import { effectiveFogState, FogState } from './systems/vision/index.js';

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
 * The fog-of-war read view for one viewer player (see {@link Simulation.fogView}) — plain data + one
 * pure accessor, so render/minimap layers consume fog without touching the live {@link FogState}.
 */
export interface FogView {
  /** The active {@link import('./components/rules.js').FOG_MODE} (never OFF — OFF yields null). */
  readonly mode: number;
  readonly cellsWide: number;
  readonly cellsHigh: number;
  /** Bumps only when the masks rebuilt — the render layers' re-composite key. */
  readonly generation: number;
  /** The viewer's EFFECTIVE `FOG_STATE` at a cell (RECON's known-terrain mapping applied). */
  readonly stateAt: (cellX: number, cellY: number) => number;
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
  /**
   * The per-player fog-of-war masks (see systems/vision.ts), or undefined for a mapless sim. A
   * MUTABLE world resource like the RNG (the VisionSystem rebuilds it on its cadence) — unlike the
   * immutable terrain it IS simulated state (combat gates read it), so {@link hashState} mixes its
   * raw bytes in after the components. Inert (empty, zero cost) while the fog mode is OFF.
   */
  readonly fog?: FogState;
  /** One-shot events produced during the current tick (drained by render/audio). */
  readonly events = new EventBuffer();
  /**
   * The serializable command queue — the ONLY way state mutates. Enqueue via {@link enqueue}; the
   * CommandSystem drains and applies it each tick (and logs it). A save is the command log.
   */
  readonly commands = new CommandQueue();
  private currentTick = 0;
  /** The last {@link snapshot} result, reusable while the tick and the World's mutation version are
   *  unchanged (see snapshot). */
  private snapshotMemo: {
    readonly tick: number;
    readonly version: number;
    readonly snap: WorldSnapshot;
  } | null = null;

  constructor(opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    this.content = opts.content;
    if (opts.map !== undefined) {
      this.terrain = buildTerrainGraph(opts.content, opts.map);
      const fog = new FogState(this.terrain);
      this.fog = fog;
      // The may-hold-VISIBLE boxes are an incrementally-maintained cache (sim contract: register a
      // verifier so the fuzz harness's `cachesCoherent` invariant tripwires a silent divergence).
      this.world.registerCacheVerifier('fogVisibleBounds', () => fog.verifyVisibleBounds());
    }
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
      // Only attach `terrain`/`fog` when present: under exactOptionalPropertyTypes an optional
      // property must be omitted rather than set to undefined.
      ...(this.terrain !== undefined ? { terrain: this.terrain } : {}),
      ...(this.fog !== undefined ? { fog: this.fog } : {}),
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
   *
   * Memoized per tick: the app's frame loop (and its pointer handlers) snapshot every RAF while the
   * fixed timestep may not have stepped — re-cloning an unchanged world each frame was a large share of
   * a real map's frame cost. The memo is reused while the tick AND the World's {@link
   * World.mutationVersion} are unchanged (any `add`/`remove`/`destroy`/`touch` — e.g. a pre-tick-0
   * fixture spawn — bumps the version). A monotonic COUNTER, not the touched log's emptiness, so a
   * direct external `takeSnapshot` call draining the log between two same-tick snapshots cannot make
   * this serve a stale view. A DIRECT in-place store write without `World.touch` between same-tick
   * snapshots is the one blind spot; sim systems only mutate inside `step()`, which advances the tick.
   */
  snapshot(): WorldSnapshot {
    const memo = this.snapshotMemo;
    const version = this.world.mutationVersion;
    if (memo !== null && memo.tick === this.currentTick && memo.version === version) {
      return memo.snap;
    }
    const snap = takeSnapshot(this.world, this.currentTick, this.events.current());
    this.snapshotMemo = { tick: this.currentTick, version: this.world.mutationVersion, snap };
    return snap;
  }

  /**
   * A buildability test for one building type — the read seam the app's build-mode overlay probes per
   * visible tile to grey out where a click would be rejected. Reads the same rule the `placeBuilding`
   * command gates on ({@link canPlaceBuilding}). The world's obstacle sets are memoized per
   * {@link placementBlockerVersion}, so the once-per-frame probe build re-scans the world only when a
   * building/resource actually appears or disappears (not every tick), and probing a viewport is then
   * O(visible tiles). Read-only, like {@link snapshot}; never mutates and so is determinism-irrelevant.
   * Returns null for a mapless sim (no terrain graph → no placement rule), where the caller shows no
   * overlay.
   */
  placementProbe(buildingType: number): PlacementProbe | null {
    if (this.terrain === undefined) return null;
    return placementProbe(this.world, this.content, this.terrain, buildingType);
  }

  /**
   * The version of the placement-blocker inputs — an opaque token that changes only when a building or
   * resource (or its footprint) is added or removed (see {@link placementBlockerVersion}). The
   * build-mode overlay keys its memoized band probe on this instead of the tick, so a still camera over
   * a running sim reuses last frame's blocked set instead of re-probing the whole visible node band
   * every RAF.
   */
  placementBlockerVersion(): string {
    return placementBlockerVersion(this.world);
  }

  /**
   * The ground plots of every under-construction building — its footprint body cells, for the render's
   * grey "construction site" decal (see {@link constructionSitePlots}). Read-only render support like
   * {@link placementProbe}: never mutates, determinism-irrelevant. Empty when nothing is under construction.
   */
  constructionPlots(): ConstructionPlot[] {
    return constructionSitePlots(this.world, this.content);
  }

  /**
   * Whether the needs mechanic is currently on (the `WorldRules` rule the `setNeedsEnabled` command
   * sets; absent = enabled). A sanctioned read seam like {@link placementProbe} — the app's admin
   * toggle labels itself from this instead of reaching into live component stores. Read-only,
   * determinism-irrelevant.
   */
  needsEnabled(): boolean {
    return needsEnabled(this.world);
  }

  /**
   * The active fog-of-war mode (the `FogRules` rule the `setFogMode` command sets; absent =
   * `FOG_MODE.OFF`). The same sanctioned read seam as {@link needsEnabled} — the app's admin fog
   * switcher labels itself from this. Read-only, determinism-irrelevant.
   */
  fogMode(): number {
    return fogMode(this.world);
  }

  /**
   * The fog-of-war read view for ONE viewer player — the seam the render (terrain wash, sprite cull,
   * minimap) consumes, like {@link placementProbe}: read-only, never mutates, determinism-irrelevant.
   * `stateAt` answers the EFFECTIVE `FOG_STATE` of a cell (RECON's known-terrain view rule applied);
   * `generation` bumps only when the masks actually rebuilt, so a render layer re-composites on it
   * instead of per tick. Returns null when fog is OFF (the default) or the sim is mapless — the
   * caller then draws no fog at all.
   */
  fogView(player: number): FogView | null {
    const fog = this.fog;
    if (fog === undefined) return null;
    const mode = fogMode(this.world);
    if (mode === FOG_MODE.OFF) return null;
    return {
      mode,
      cellsWide: fog.cellsWide,
      cellsHigh: fog.cellsHigh,
      generation: fog.generation,
      stateAt: (cellX: number, cellY: number) => effectiveFogState(fog, mode, player, cellX, cellY),
    };
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
    // The fog masks are simulated state living OUTSIDE the components (see systems/vision.ts) — mix
    // their raw bytes in per player, ascending (the canonical mask order). A world that never enabled
    // fog holds no masks, so every pre-fog hash is byte-identical.
    if (this.fog !== undefined) {
      for (const player of this.fog.playersWithMasks()) {
        mix(player);
        const mask = this.fog.tryMaskFor(player); // read-only: never allocate a mask while hashing
        if (mask === undefined) continue; // unreachable — playersWithMasks lists only allocated masks
        for (let i = 0; i < mask.length; i++) mix(mask[i] ?? 0);
      }
    }
    return h.toString(16).padStart(8, '0');
  }
}

/** Minimal positioned-entity fixture helper (the determinism golden builds worlds with it). */
export function spawnAt(world: World, x: number, y: number): Entity {
  const e = world.create();
  world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  return e;
}
