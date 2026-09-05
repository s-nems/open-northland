import { type ContentSet, type EquipCategory, terrainGridFingerprint } from '@open-northland/data';
import {
  ASSISTANT_COUNTER_KINDS,
  AssistantCounters,
  type AssistantCounterValues,
  assistantCountersEntity,
  assistantGrantedGoods,
  type DiplomacyState,
  defaultAssistantCounters,
  diplomacyStance,
  type FogMode,
  fogMode,
  needsEnabled,
  professionProgressionEnabled,
} from './components/index.js';
import { CommandQueue } from './core/command-queue.js';
import { type Command, type CommandEnvelope, setupCommand } from './core/commands/index.js';
import { EventBuffer } from './core/events.js';
import { Rng } from './core/rng.js';
import { type Entity, World } from './ecs/world.js';
import { checkInvariants as _checkInvariants, type Invariant as _Invariant } from './harness/invariants.js';
import { takeSnapshot, type WorldSnapshot } from './inspect/snapshot.js';
import { buildTerrainGraph, type TerrainGraph, type TerrainMap } from './nav/terrain/index.js';
import { hashSimState } from './simulation/hash.js';
import { type FogView, fogViewFor, placementProbeFor, signpostProbeFor } from './simulation/read-seams.js';
import type { PlayerPlacementProbe } from './systems/conflict/contested-ground.js';
import type { SystemContext } from './systems/context.js';
import {
  type ConstructionPlot,
  constructionSitePlots,
  placementBlockerVersion,
  workFlagBlockerVersion,
} from './systems/footprint/index.js';
import { type EquipPickEntry, equipPickList } from './systems/readviews/index.js';
import { SYSTEM_ORDER } from './systems/schedule.js';
import type { SignpostProbe } from './systems/signposts/index.js';
import { FogState, playerHasMet } from './systems/vision/index.js';

export type { FogView } from './simulation/read-seams.js';

export interface SimOptions {
  seed: number;
  content: ContentSet;
  /** Dimensions plus a row-major landscape-typeId grid. Omitted for a mapless sim. */
  map?: TerrainMap;
}

/** Wraps one system invocation for timing; observational only. */
export type SystemInstrument = (name: string, run: () => void) => void;

/**
 * Owns the world, the RNG, and the system schedule. `step()` advances one deterministic tick. The read
 * seams are how the app and render observe state instead of live component stores; none of them mutate.
 */
export class Simulation {
  readonly world = new World();
  readonly rng: Rng;
  /** The RNG construction seed, kept as save-file provenance; the live stream position is `rng.getState()`. */
  readonly seed: number;
  readonly content: ContentSet;
  /**
   * The cell-adjacency graph for navigation and placement, built once at construction; undefined for a
   * mapless sim. An immutable input like content, so `hashState` does not mix it in.
   */
  readonly terrain?: TerrainGraph;
  /**
   * The per-player fog-of-war masks; undefined for a mapless sim. Mutable simulated state that combat
   * gates read, so `hashState` mixes its bytes in after the components. Empty while the fog mode is OFF.
   */
  readonly fog?: FogState;
  private readonly map?: TerrainMap;
  private mapFingerprintMemo?: string;
  /** One-shot events produced during the current tick (drained by render/audio). */
  readonly events = new EventBuffer();
  /** The serializable external-input queue, drained and logged each tick for replay. */
  readonly commands = new CommandQueue();
  private currentTick = 0;
  /** The per-system instrumentation hook, or `null` for the direct (zero-overhead) call. */
  private instrument: SystemInstrument | null = null;
  /** The last `snapshot()` result, reusable while the tick and the world's mutation version hold. */
  private snapshotMemo: {
    readonly tick: number;
    readonly version: number;
    readonly snap: WorldSnapshot;
  } | null = null;

  constructor(opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    this.seed = opts.seed;
    this.content = opts.content;
    if (opts.map !== undefined) {
      this.map = opts.map;
      this.terrain = buildTerrainGraph(opts.content, opts.map);
      this.fog = new FogState(this.terrain, this.world);
    }
  }

  /**
   * Identity of the navigated half-cell grid, for a save file's map check; undefined for a mapless
   * sim. An immutable input digest like `terrain`, so `hashState` does not mix it in. Digested on
   * first read: a whole-grid walk that only a save, a load, or a diagnostic ever needs.
   */
  get mapFingerprint(): string | undefined {
    if (this.map === undefined) return undefined;
    this.mapFingerprintMemo ??= terrainGridFingerprint(this.map);
    return this.mapFingerprintMemo;
  }

  get tick(): number {
    return this.currentTick;
  }

  /** Restore seam: adopt a saved run position; only valid before the first {@link step}. */
  restoreTick(tick: number): void {
    if (this.currentTick !== 0) throw new Error('restoreTick: the sim has already ticked');
    this.currentTick = tick;
  }

  /**
   * Install (or clear) the per-system instrumentation hook. The hook must call `run` exactly once; the
   * timer stays in the caller, keeping wall-clock reads out of sim source. Purely observational, so an
   * instrumented run hashes byte-identically to a bare one.
   */
  setInstrument(instrument: SystemInstrument | null): void {
    this.instrument = instrument;
  }

  /**
   * Queue an authorized command envelope, the only way to mutate sim state from outside once the sim is
   * ticking. CommandSystem applies and logs it on the next `step()`, admitting it only if the envelope's
   * origin is entitled to it. Only authored pre-tick-0 setup writes to `world` directly.
   */
  enqueue(envelope: CommandEnvelope): void {
    this.commands.enqueue(envelope);
  }

  /** {@link enqueue} under the trusted `setup` origin: authored pre-run assembly. */
  enqueueSetup(command: Command): void {
    this.commands.enqueue(setupCommand(command));
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
      // An absent optional resource must be omitted, not set to undefined.
      ...(this.terrain !== undefined ? { terrain: this.terrain } : {}),
      ...(this.fog !== undefined ? { fog: this.fog } : {}),
    };
    const instrument = this.instrument;
    for (const { name, system } of SYSTEM_ORDER) {
      if (instrument === null) {
        system(this.world, ctx);
      } else {
        // A skipping or double-running hook would diverge the live session from its own replay.
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
   * A detached plain-data read view at the current tick boundary, so render and audio never observe a
   * half-applied tick. Never read back into sim logic.
   *
   * Memoized while the tick and {@link World.mutationVersion} hold, since the frame loop snapshots every
   * RAF while the fixed timestep may not have stepped. Keyed on that monotonic counter rather than the
   * touched log, which an external `takeSnapshot` drains. A write that defeats the read-only view to
   * bypass `World.mut` between two same-tick snapshots is the one blind spot.
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
   * A buildability test for one building type, reading the same rules the `placeBuilding` command gates on.
   * Obstacle sets are memoized per {@link placementBlockerVersion}, so probing a viewport costs O(visible
   * tiles); with a `player` the probe also refuses the ground a hostile army the seat can see contests.
   * Null for a mapless sim.
   */
  placementProbe(buildingType: number, player?: number): PlayerPlacementProbe | null {
    return placementProbeFor(this.world, this.content, this.terrain, this.fog, buildingType, player);
  }

  /**
   * An opaque token over the placement-blocker inputs, changing when one of them does rather than per
   * tick. Overlay memos key on it.
   */
  placementBlockerVersion(): string {
    return placementBlockerVersion(this.world);
  }

  /**
   * An erectability test for one player's signposts, reading the same rule the erect command gates on:
   * open work-flag ground outside the player's spacing circles. Null for a mapless sim.
   */
  signpostProbe(player: number): SignpostProbe | null {
    return signpostProbeFor(this.world, this.content, this.terrain, player);
  }

  /**
   * {@link placementBlockerVersion} plus the work-flag generation, since flags block signpost cells but
   * not buildings.
   */
  signpostBlockerVersion(): string {
    return workFlagBlockerVersion(this.world);
  }

  /** The footprint body cells of every under-construction building. */
  constructionPlots(): ConstructionPlot[] {
    return constructionSitePlots(this.world, this.content);
  }

  /**
   * Every good wearable in `group` that `entity` could reach and fetch right now, with its reachable unit
   * count. The `equipGood` command re-validates, so a row that staled since the menu opened just returns
   * the settler empty-handed.
   */
  equipPickList(entity: Entity, group: EquipCategory): EquipPickEntry[] {
    return equipPickList(this.world, this.content, this.terrain, entity, group);
  }

  /** The `WorldRules` rule the `setNeedsEnabled` command sets; absent = enabled. */
  needsEnabled(): boolean {
    return needsEnabled(this.world);
  }

  /**
   * Whether profession progression gates job and good access: the `ProgressionRules` rule the
   * `setProfessionProgression` command sets; absent = enabled.
   */
  professionProgressionEnabled(): boolean {
    return professionProgressionEnabled(this.world);
  }

  /** The good types `player`'s assistant may hand out, as a detached copy of the command's state. */
  assistantGrants(player: number): readonly number[] {
    return [...assistantGrantedGoods(this.world, player)];
  }

  /** `player`'s assistant production counters as a detached copy; all-default when the carrier is absent. */
  assistantCounters(player: number): Readonly<AssistantCounterValues> {
    const carrier = assistantCountersEntity(this.world, player);
    if (carrier === null) return defaultAssistantCounters();
    const live = this.world.get(carrier, AssistantCounters).counters;
    const copy = defaultAssistantCounters();
    for (const kind of ASSISTANT_COUNTER_KINDS) copy[kind] = { ...live[kind] };
    return copy;
  }

  /** The `FogRules` rule the `setFogMode` command sets; absent = `FOG_MODE.OFF`. */
  fogMode(): FogMode {
    return fogMode(this.world);
  }

  /** The directed stance `from` holds toward `to` in the `DiplomacyRules` table the `setDiplomacy`
   *  command sets; a pair never set reads `enemy`. */
  diplomacyStance(from: number, to: number): DiplomacyState {
    return diplomacyStance(this.world, from, to);
  }

  /** Whether `viewer` has discovered `other`: true with fog off or absent (everything is in plain
   *  sight), else the vision system's recorded first contacts decide. */
  hasMetPlayer(viewer: number, other: number): boolean {
    return playerHasMet(this.world, this.fog, viewer, other);
  }

  /**
   * The fog-of-war read view for one viewer player. Null when fog is OFF or the sim is mapless, where the
   * caller draws no fog.
   */
  fogView(player: number): FogView | null {
    return fogViewFor(this.world, this.fog, player);
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /** Run the core (or given) invariants against the current world; returns violation strings. */
  checkInvariants(invariants?: readonly _Invariant[]): string[] {
    return _checkInvariants(this.world, this.content, invariants);
  }

  /** A canonical hash of all simulation state, for determinism golden tests. */
  hashState(): string {
    return hashSimState(this.world, this.currentTick, this.rng.getState(), this.fog);
  }
}

/** The inputs a fresh run starts from. */
export interface SimInputs {
  readonly content: ContentSet;
  readonly seed: number;
  readonly map?: TerrainMap | undefined;
}

/**
 * Build the fresh {@link Simulation} a run starts from. Callers may pass `map: undefined`; under
 * `exactOptionalPropertyTypes` the key must be omitted, since Simulation builds its terrain graph iff the
 * key is present.
 */
export function simFor({ content, seed, map }: SimInputs): Simulation {
  return new Simulation({ seed, content, ...(map !== undefined ? { map } : {}) });
}
