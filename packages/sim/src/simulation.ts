import type { ContentSet } from '@open-northland/data';
import { type FogMode, fogMode, needsEnabled } from './components/index.js';
import { CommandQueue } from './core/command-queue.js';
import type { Command } from './core/commands/index.js';
import { EventBuffer } from './core/events.js';
import { Rng } from './core/rng.js';
import { World } from './ecs/world.js';
import { checkInvariants as _checkInvariants, type Invariant as _Invariant } from './harness/invariants.js';
import { takeSnapshot, type WorldSnapshot } from './inspect/snapshot.js';
import { buildTerrainGraph, type TerrainGraph, type TerrainMap } from './nav/terrain/index.js';
import { hashSimState } from './simulation/hash.js';
import { type FogView, fogViewFor, placementProbeFor, signpostProbeFor } from './simulation/read-seams.js';
import type { SystemContext } from './systems/context.js';
import {
  type ConstructionPlot,
  constructionSitePlots,
  type PlacementProbe,
  placementBlockerVersion,
  workFlagBlockerVersion,
} from './systems/footprint/index.js';
import { SYSTEM_ORDER } from './systems/schedule.js';
import type { SignpostProbe } from './systems/signposts/index.js';
import { FogState } from './systems/vision/index.js';

export type { FogView } from './simulation/read-seams.js';

export interface SimOptions {
  seed: number;
  content: ContentSet;
  /**
   * The terrain map (dimensions + row-major landscape-typeId grid). Optional: trivial fixtures and the
   * determinism golden run mapless. When given, the sim builds the cell-adjacency graph once and exposes it
   * as the `terrain` resource on every system's context.
   */
  map?: TerrainMap;
}

/** Wraps one system invocation for timing (see {@link Simulation.setInstrument}) — observational only. */
export type SystemInstrument = (name: string, run: () => void) => void;

/**
 * The simulation: owns the world, the RNG, and the system schedule. Advance one deterministic
 * tick with `step()`. No rendering, no I/O — see docs/ECS.md.
 *
 * The read seams ({@link snapshot}, {@link placementProbe}, {@link constructionPlots},
 * {@link needsEnabled}, {@link fogMode}, {@link fogView}) are the sanctioned way the app and render
 * observe state instead of reaching into live component stores. None of them mutate, so none affect
 * determinism; their resolution logic lives in `simulation/read-seams.ts`.
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
   * The per-player fog-of-war masks (see systems/vision), or undefined for a mapless sim. A MUTABLE
   * world resource like the RNG (the VisionSystem rebuilds it on its cadence) — unlike the immutable
   * terrain it IS simulated state (combat gates read it), so {@link hashState} mixes its bytes in after
   * the components. Inert (empty, zero cost) while the fog mode is OFF.
   */
  readonly fog?: FogState;
  /** One-shot events produced during the current tick (drained by render/audio). */
  readonly events = new EventBuffer();
  /**
   * The serializable external-input queue. {@link CommandSystem} drains and logs it each tick for replay and
   * diagnostics. Scenes and fixtures may assemble pre-tick-0 state through {@link world} directly.
   */
  readonly commands = new CommandQueue();
  private currentTick = 0;
  /** The per-system instrumentation hook, or `null` for the direct (zero-overhead) call. */
  private instrument: SystemInstrument | null = null;
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
      this.fog = new FogState(this.terrain, this.world);
    }
  }

  get tick(): number {
    return this.currentTick;
  }

  /**
   * Install (or clear) the per-system instrumentation hook — the timing seam for the app's perf
   * marks and the bench harness. The hook wraps each system invocation and MUST call `run` exactly
   * once and stay hands-off otherwise (it gets no world/ctx access); the timer itself lives in the
   * caller, keeping `performance.now` out of sim src (the hygiene scan). Purely observational, so
   * an instrumented run hashes byte-identically to a bare one (pinned in test/core/instrument.test.ts).
   */
  setInstrument(instrument: SystemInstrument | null): void {
    this.instrument = instrument;
  }

  /**
   * Queue a serializable command — the only way to mutate sim state from outside once the sim is
   * ticking. It is applied (and appended to the command log) by CommandSystem on the next `step()`.
   * The UI, strategic AI, and replay tools go through here; only authored pre-tick-0 setup writes to
   * {@link world} directly (see {@link commands}).
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
    const instrument = this.instrument;
    for (const { name, system } of SYSTEM_ORDER) {
      if (instrument === null) {
        system(this.world, ctx);
      } else {
        // Enforce the hook contract (`run` exactly once): a skipping/double-running hook would
        // silently diverge the live session from its own command-log replay.
        let runs = 0;
        instrument(name, () => {
          runs++;
          system(this.world, ctx);
        });
        if (runs !== 1) throw new Error(`instrument ran system '${name}' ${runs} times (must be exactly 1)`);
      }
    }
  }

  /**
   * A detached read-view of the world at the current tick boundary, consumed by `render`/audio
   * instead of the live component stores, so they never observe a half-applied tick. Plain data (no
   * class instances / live Maps), so it is also transferable to a render Web Worker for free. Pure:
   * a snapshot is a function of state and is never read back into sim logic.
   *
   * Memoized per tick: the app's frame loop (and its pointer handlers) snapshot every RAF while the fixed
   * timestep may not have stepped, and re-cloning an unchanged world each frame was a large share of a real
   * map's frame cost. The memo is reused while the tick and the World's {@link World.mutationVersion} are
   * unchanged (any `create`/`add`/`remove`/`destroy`/`touch` — e.g. a pre-tick-0 fixture spawn — bumps it).
   * A monotonic counter, not the touched log's emptiness, so a direct external `takeSnapshot` draining the
   * log between two same-tick snapshots cannot make this serve a stale view. A direct in-place store write
   * without `World.touch` between same-tick snapshots is the one blind spot; sim systems only mutate inside
   * `step()`, which advances the tick.
   */
  snapshot(): WorldSnapshot {
    const memo = this.snapshotMemo;
    const version = this.world.mutationVersion;
    if (memo !== null && memo.tick === this.currentTick && memo.version === version) {
      return memo.snap;
    }
    const snap = takeSnapshot(this.world, this.currentTick, this.events.current());
    // Stamp the version the snapshot was built from, not a re-read one: a later bump must invalidate it.
    this.snapshotMemo = { tick: this.currentTick, version, snap };
    return snap;
  }

  /**
   * A buildability test for one building type — the read seam the app's build-mode overlay probes per
   * visible tile to grey out where a click would be rejected. Reads the same rule the `placeBuilding`
   * command gates on ({@link canPlaceBuilding}). The world's obstacle sets are memoized per
   * {@link placementBlockerVersion}, so the once-per-frame probe build re-scans the world only when a
   * building/resource actually appears or disappears (not every tick), and probing a viewport is then
   * O(visible tiles). Returns null for a mapless sim (no terrain graph → no placement rule), where the
   * caller shows no overlay.
   */
  placementProbe(buildingType: number): PlacementProbe | null {
    return placementProbeFor(this.world, this.content, this.terrain, buildingType);
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
   * An erectability test for one player's signposts — the read seam the signpost placement overlay
   * probes per visible node, mirroring {@link placementProbe}. Reads the same rule the erect command
   * gates on ({@link canPlaceSignpost}): open work-flag ground outside the player's spacing circles.
   * Memoized on {@link signpostBlockerVersion} like its building twin, since the app asks per RAF frame
   * while the erect cursor is armed. Returns null for a mapless sim.
   */
  signpostProbe(player: number): SignpostProbe | null {
    return signpostProbeFor(this.world, this.content, this.terrain, player);
  }

  /**
   * The version of the signpost-probe inputs — {@link placementBlockerVersion} plus the work-flag
   * generation (flags block signpost cells but not buildings). The signpost overlay's memo key.
   */
  signpostBlockerVersion(): string {
    return workFlagBlockerVersion(this.world);
  }

  /**
   * The ground plots of every under-construction building — its footprint body cells, for the render's
   * grey "construction site" decal (see {@link constructionSitePlots}). Empty when nothing is under
   * construction.
   */
  constructionPlots(): ConstructionPlot[] {
    return constructionSitePlots(this.world, this.content);
  }

  /**
   * Whether the needs mechanic is currently on (the `WorldRules` rule the `setNeedsEnabled` command sets;
   * absent = enabled). The app's admin toggle labels itself from this.
   */
  needsEnabled(): boolean {
    return needsEnabled(this.world);
  }

  /**
   * The active fog-of-war mode (the `FogRules` rule the `setFogMode` command sets; absent =
   * `FOG_MODE.OFF`). The app's admin fog switcher labels itself from this.
   */
  fogMode(): FogMode {
    return fogMode(this.world);
  }

  /**
   * The fog-of-war read view for one viewer player — the seam the render (terrain wash, sprite cull,
   * minimap) consumes. `stateAt` answers the effective `FOG_STATE` of a cell (RECON's known-terrain view
   * rule applied); `generation` bumps only when the masks actually rebuilt, so a render layer re-composites
   * on it instead of per tick. Returns null when fog is OFF (the default) or the sim is mapless — the
   * caller then draws no fog at all.
   */
  fogView(player: number): FogView | null {
    return fogViewFor(this.world, this.fog, player);
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
   * every registered component on every alive entity, in canonical (ascending) order, then the fog
   * masks. If two runs from the same seed + inputs diverge in ANY hashed field, this changes — which
   * is the point.
   */
  hashState(): string {
    return hashSimState(this.world, this.currentTick, this.rng.getState(), this.fog);
  }
}

/** The inputs a fresh run starts from — what {@link simFor} needs to build a {@link Simulation}. */
export interface SimInputs {
  readonly content: ContentSet;
  readonly seed: number;
  readonly map?: TerrainMap | undefined;
}

/**
 * Build the fresh {@link Simulation} a run starts from — the one place that knows `map` must be OMITTED
 * rather than set to `undefined` under `exactOptionalPropertyTypes` (tsconfig.base.json), since the
 * Simulation builds its terrain graph iff the key is present. Callers may pass `map: undefined`.
 */
export function simFor({ content, seed, map }: SimInputs): Simulation {
  return new Simulation({ seed, content, ...(map !== undefined ? { map } : {}) });
}
