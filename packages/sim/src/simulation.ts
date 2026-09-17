import type { ContentSet, EquipCategory } from '@open-northland/data';
import type { AiProgramScript } from './components/ai-program.js';
import {
  ASSISTANT_COUNTER_KINDS,
  AssistantCounters,
  type AssistantCounterValues,
  assistantCountersEntity,
  assistantGrantedGoods,
  type DiplomacyState,
  defaultAssistantCounters,
  diplomacyLocked,
  diplomacyStance,
  type FogMode,
  fogMode,
  type MatchOutcome,
  matchEnded,
  matchOutcome,
  missionBriefingHistory,
  missionBriefingPage,
  needsEnabled,
  type Paper,
  playerPaperSlots,
  professionProgressionEnabled,
  Settler,
} from './components/index.js';
import { type MatchRulesView, matchRulesView } from './components/match.js';
import { type MissionPresentationView, missionPresentation } from './components/mission-presentation.js';
import type { UnlockKind } from './components/unlocks.js';
import { CommandQueue } from './core/command-queue.js';
import { type Command, type CommandEnvelope, setupCommand } from './core/commands/index.js';
import { EventBuffer } from './core/events.js';
import { Rng } from './core/rng.js';
import { type Entity, World } from './ecs/world.js';
import { checkInvariants as _checkInvariants, type Invariant as _Invariant } from './harness/invariants.js';
import { mapFingerprint } from './inspect/map-fingerprint.js';
import {
  type HomeQualityView,
  type HouseholdGoodPolicyView,
  homeQualityView,
  householdGoodPolicyView,
  takeSnapshot,
  type WorldSnapshot,
} from './inspect/snapshot.js';
import { buildTerrainGraph, type TerrainGraph, type TerrainMap } from './nav/terrain/index.js';
import { hashSimState } from './simulation/hash.js';
import { type FogView, fogViewFor, placementProbeFor, signpostProbeFor } from './simulation/read-seams.js';
import { type SyncDigest, SyncDigestRecorder } from './simulation/sync-digest.js';
import { BattleFront, holdsGround } from './systems/conflict/battle-alert.js';
import type { PlayerPlacementProbe } from './systems/conflict/contested-ground.js';
import type { SystemContext } from './systems/context.js';
import type { PlacementProbe } from './systems/footprint/index.js';
import {
  type ConstructionPlot,
  constructionSitePlots,
  placementBlockerVersion,
  workFlagBlockerVersion,
} from './systems/footprint/index.js';
import { type LandscapeEditView, landscapeEdits } from './systems/landscape/view.js';
import {
  type InfoLineView,
  infoLines,
  type MissionScript,
  type MissionStatus,
  missionObjects,
  missionStatus,
  type OpenTribute,
  openTributes,
} from './systems/missions/index.js';
import {
  ownPalisadeNodes,
  type PalisadeGateProbeResult,
  palisadeGateProbe,
  palisadeGateSites,
  palisadeLayoutVersion,
  palisadePlacementProbe,
} from './systems/palisades/index.js';
import { canChooseJob, needSubjectOf, unlockStatus } from './systems/progression/index.js';
import { type EquipPickEntry, equipPickList } from './systems/readviews/index.js';
import { SYSTEM_ORDER } from './systems/schedule.js';
import { type SignpostProbe, signpostNetworkRevision } from './systems/signposts/index.js';
import { type TradeOffer, type TraderView, tradeOffersAt, traderView } from './systems/trade/index.js';
import { type VehicleView, vehiclesOf, vehicleView } from './systems/vehicles/index.js';
import { FogState, playerHasMet } from './systems/vision/index.js';

export type { FogView } from './simulation/read-seams.js';
export type { SyncDigest } from './simulation/sync-digest.js';

export interface SimOptions {
  seed: number;
  content: ContentSet;
  /** Dimensions plus a row-major landscape-typeId grid. Omitted for a mapless sim. */
  map?: TerrainMap;
  /** The map's decoded mission script. Omitted for a world that runs no script. */
  missions?: MissionScript;
  /** The map's `[AIData]` rows. Omitted for a world whose map authored none. */
  aiScript?: AiProgramScript;
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
   * The per-vision-group fog-of-war masks; undefined for a mapless sim. Mutable simulated state that combat
   * gates read, so `hashState` mixes its bytes in after the components. Empty while the fog mode is OFF.
   */
  readonly fog?: FogState;
  /** The map's mission script, the MissionSystem's content input; undefined for a world that runs
   *  none. An immutable input like `content`, so `hashState` does not mix it in. */
  readonly missions?: MissionScript;
  /** The map's `[AIData]` rows, the AI program system's content input; an immutable input like
   *  `missions`. */
  readonly aiScript?: AiProgramScript;
  private readonly map?: TerrainMap;
  private mapFingerprintMemo?: string;
  /** Null until {@link setSyncDigest} turns the digest on; while set it is the world's mutation sink. */
  private digest: SyncDigestRecorder | null = null;
  private lastDigest: SyncDigest | null = null;
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
    if (opts.missions !== undefined) this.missions = opts.missions;
    if (opts.aiScript !== undefined) this.aiScript = opts.aiScript;
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
    this.mapFingerprintMemo ??= mapFingerprint(this.map);
    return this.mapFingerprintMemo;
  }

  matchRules(): MatchRulesView {
    return matchRulesView(this.world);
  }

  missionPresentation(): MissionPresentationView {
    return missionPresentation(this.world);
  }

  /** Detached household-quality pools for a home, or null before it has received a household good. */
  homeQuality(home: Entity): HomeQualityView | null {
    return homeQualityView(this.snapshot(), home);
  }

  householdGoodPolicy(player: number): HouseholdGoodPolicyView {
    return householdGoodPolicyView(this.snapshot(), player);
  }

  landscapeEdits(): LandscapeEditView {
    return landscapeEdits(this.world, this.terrain);
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

  /** {@link enqueue} for a named tick, ordered within it by `sequence`; see `CommandQueue.enqueueAt`. */
  enqueueAt(envelope: CommandEnvelope, applyTick: number, sequence: number): void {
    this.commands.enqueueAt(envelope, applyTick, sequence);
  }

  /** {@link enqueue} under the trusted `setup` origin: authored pre-run assembly. */
  enqueueSetup(command: Command): void {
    this.commands.enqueue(setupCommand(command));
  }

  /** The resources every system of this tick reads. Rebuilt per call rather than cached, so a read seam
   *  cannot hand a system a context from another tick. */
  private context(): SystemContext {
    return {
      content: this.content,
      rng: this.rng,
      tick: this.currentTick,
      events: this.events,
      commands: this.commands,
      // An absent optional resource must be omitted, not set to undefined.
      ...(this.terrain !== undefined ? { terrain: this.terrain } : {}),
      ...(this.fog !== undefined ? { fog: this.fog } : {}),
      ...(this.missions !== undefined ? { missions: this.missions } : {}),
      ...(this.aiScript !== undefined ? { aiScript: this.aiScript } : {}),
    };
  }

  /**
   * Whether the battle alert holds `entity` where it stands - no rest, no meal it would have to walk to,
   * no company - because fighting is going on around it (`systems/conflict/battle-alert.ts`). The drive
   * ladder's own rule, for a HUD that would otherwise caption such a unit as idle. Reads the world as it
   * stands; the index it builds lives for the call.
   */
  standsTo(entity: Entity): boolean {
    const ctx = this.context();
    return holdsGround(this.world, ctx, entity, new BattleFront(this.world, ctx));
  }

  /** Advance exactly one tick by running every system in order. */
  step(): void {
    this.currentTick++;
    this.events.clear(); // events for tick N are a pure function of this tick's systems
    this.digest?.beginTick();
    const ctx = this.context();
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
    if (this.digest !== null) {
      this.lastDigest = this.digest.seal(this.world, this.currentTick, this.rng.getState(), this.fog);
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

  unlockStatus(
    kind: UnlockKind,
    typeId: number,
    tribe: number,
    player?: number,
  ): ReturnType<typeof unlockStatus> {
    return unlockStatus(this.world, { content: this.content }, player, tribe, kind, typeId);
  }

  canChooseJob(entity: Entity, jobType: number): boolean {
    if (!this.world.has(entity, Settler)) return false;
    return canChooseJob(this.world, { content: this.content }, needSubjectOf(this.world, entity), jobType);
  }

  /**
   * A buildability test for one building type, reading the same rules the `placeBuilding` command gates on.
   * Blockers come from the incrementally maintained placement count grid, so probing a viewport costs
   * O(visible tiles); with a `player` the probe also refuses the ground a hostile army the seat can see
   * contests. A supplied tribe adds its player-scoped technology gate. Null for a mapless sim.
   */
  placementProbe(buildingType: number, player?: number, tribe?: number): PlayerPlacementProbe | null {
    return placementProbeFor(this.world, this.content, this.terrain, this.fog, buildingType, player, tribe);
  }

  /** Collision probe for one data-described palisade or gate graphic. Null for an unknown row or mapless sim. */
  palisadeProbe(gfxIndex: number): PlacementProbe | null {
    if (this.terrain === undefined) return null;
    return palisadePlacementProbe(this.world, this.content, this.terrain, gfxIndex);
  }

  /** Authoritative gate-conversion preview at one hovered half-cell node, over the authored closed-gate
   *  rows the caller offers. */
  palisadeGateProbe(
    hx: number,
    hy: number,
    closedGateGfxIndexes: readonly number[],
    player?: number,
  ): PalisadeGateProbeResult | null {
    if (this.terrain === undefined) return null;
    return palisadeGateProbe(this.world, this.terrain, hx, hy, closedGateGfxIndexes, player);
  }

  /** Changes whenever {@link palisadeGateSites} could answer differently, movers aside. */
  palisadeLayoutVersion(): string {
    return palisadeLayoutVersion(this.world);
  }

  /** Every own wall a gate can go into, as its convertible probe, ignoring a mover in the opening;
   *  empty for a mapless sim. */
  palisadeGateSites(closedGateGfxIndexes: readonly number[], player: number): PalisadeGateProbeResult[] {
    if (this.terrain === undefined) return [];
    return palisadeGateSites(this.world, this.terrain, closedGateGfxIndexes, player);
  }

  /** A node test for `player`'s standing walls, gates and wall sites, indexed once per call. */
  ownPalisadeNodes(player: number): (hx: number, hy: number) => boolean {
    return ownPalisadeNodes(this.world, player);
  }

  /**
   * An opaque token over the placement-blocker inputs, changing when one of them does rather than per
   * tick. Overlay memos key on it. The signpost network revision is one, since a building probe lets its
   * player cover the posts that player holds now.
   */
  placementBlockerVersion(): string {
    return `${placementBlockerVersion(this.world)}.${signpostNetworkRevision(this.world)}`;
  }

  /**
   * An erectability test for one player's signposts, reading the same rule the erect command gates on:
   * open work-flag ground past the player's signpost spacing. Null for a mapless sim.
   */
  signpostProbe(player: number): SignpostProbe | null {
    return signpostProbeFor(this.world, this.content, this.terrain, player);
  }

  /**
   * {@link placementBlockerVersion} plus the work-flag generation, since flags block signpost cells but
   * not buildings, and the signpost network revision, since the spacing rule reads the player's posts.
   */
  signpostBlockerVersion(): string {
    return `${workFlagBlockerVersion(this.world)}.${signpostNetworkRevision(this.world)}`;
  }

  /** The footprint body cells of every under-construction building; the same array while no site changes. */
  constructionPlots(): readonly ConstructionPlot[] {
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

  /** `player`'s papers list as a detached copy, in slot order with spent slots dropped. */
  papers(player: number): Paper[] {
    const out: Paper[] = [];
    for (const slot of playerPaperSlots(this.world, player)) if (slot !== null) out.push({ ...slot });
    return out;
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

  /** Whether the pair's stances are locked, so neither seat's `declareDiplomacy` changes them. */
  diplomacyLocked(a: number, b: number): boolean {
    return diplomacyLocked(this.world, a, b);
  }

  matchEnded(): boolean {
    return matchEnded(this.world);
  }

  /** `player`'s standing in the match the MatchSystem drives; `undecided` for a non-participant too. */
  matchOutcome(player: number): MatchOutcome {
    return matchOutcome(this.world, player);
  }

  /** The open, unpaid tributes the map's script has `payer` owing, ascending by slot, each with what
   *  the payer's stores hold toward it and whether the `payTribute` command would take it now. */
  openTributes(payer: number): readonly OpenTribute[] {
    return openTributes(this.world, { content: this.content }, payer);
  }

  /** A trader's route, cart and agreement choice as a detached copy; undefined for any other unit. */
  traderView(trader: Entity): TraderView | undefined {
    return traderView(this.world, { content: this.content }, trader);
  }

  /** The map agreements a house offers a visiting trader, as detached copies. */
  tradeOffersAt(house: Entity): readonly TradeOffer[] {
    return tradeOffersAt(this.world, house);
  }

  /** A vehicle's type, crew, hold and standing as a detached copy; undefined for anything else. */
  vehicleView(vehicle: Entity): VehicleView | undefined {
    return vehicleView(this.world, { content: this.content }, vehicle);
  }

  /** Every vehicle `player` owns, ascending by entity id, as detached copies. */
  vehiclesOf(player: number): readonly VehicleView[] {
    return vehiclesOf(this.world, { content: this.content }, player);
  }

  /** Every mission of the map's script with its live flags, for the mission window's goal list;
   *  empty for a world that runs none. */
  missionStatus(): readonly MissionStatus[] {
    return missionStatus(this.world, this.missions);
  }

  /** Delivered briefing pages in first-shown order, detached from saved state. */
  missionBriefingHistory(): readonly number[] {
    return missionBriefingHistory(this.world);
  }

  /** The briefing page a `PlayCutscene` with the replay flag left as the map's current one, or null. */
  missionBriefingPage(): number | null {
    return missionBriefingPage(this.world);
  }

  /** The lowest-id human stamped with mission object `id`, or null when no human carries it: the one
   *  a briefing picture of that id shows. */
  missionHuman(id: number): Entity | null {
    return missionObjects(this.world, id).find((e) => this.world.has(e, Settler)) ?? null;
  }

  /** The player's set on-screen info lines with their live tallies, ascending by line. */
  infoLines(player: number): readonly InfoLineView[] {
    return infoLines(this.world, { content: this.content }, player);
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

  /**
   * Turn the per-tick {@link SyncDigest} on or off. Off by default, so a run that never asks does no
   * digest work at all. Turning it on mid-run costs one walk of the fog masks, and the first digest it
   * seals covers the tick it was turned on for.
   */
  setSyncDigest(enabled: boolean): void {
    if (enabled === (this.digest !== null)) return;
    this.lastDigest = null;
    if (!enabled) {
      this.digest = null;
      this.world.setMutationSink(null);
      this.fog?.stopFolding();
      return;
    }
    this.digest = new SyncDigestRecorder();
    this.world.setMutationSink(this.digest);
    this.fog?.startFolding();
  }

  /**
   * What the last {@link step} changed, folded per domain - the cheap per-tick check two clients of one
   * session compare. Null while the digest is off, and until the first step after turning it on.
   */
  syncDigest(): SyncDigest | null {
    return this.lastDigest;
  }
}

/** The inputs a fresh run starts from. */
export interface SimInputs {
  readonly content: ContentSet;
  readonly seed: number;
  readonly map?: TerrainMap | undefined;
  readonly missions?: MissionScript | undefined;
  readonly aiScript?: AiProgramScript | undefined;
}

/**
 * Build the fresh {@link Simulation} a run starts from. Callers may pass `map: undefined`; under
 * `exactOptionalPropertyTypes` the key must be omitted, since Simulation builds its terrain graph iff the
 * key is present.
 */
export function simFor({ content, seed, map, missions, aiScript }: SimInputs): Simulation {
  return new Simulation({
    seed,
    content,
    ...(map !== undefined ? { map } : {}),
    ...(missions !== undefined ? { missions } : {}),
    ...(aiScript !== undefined ? { aiScript } : {}),
  });
}
