import type { ContentSet, EquipCategory, MapEscalation } from '@open-northland/data';
import type { MapAiScript } from './components/ai/map-ai.js';
import {
  ASSISTANT_COUNTER_KINDS,
  type AssistantArmingIntent,
  type AssistantArmorOrder,
  AssistantCounters,
  type AssistantCounterValues,
  AssistantWeaponVetoes,
  assistantArmorOrder,
  assistantCivilianOnlyGoods,
  assistantCountersEntity,
  assistantGrantedGoods,
  assistantMovesFlags,
  assistantPostsGraduatesEntity,
  assistantSoldierOnlyGoods,
  assistantUpgradesTools,
  assistantWeaponOrder,
  atPeace,
  Building,
  buildTribes,
  type DiplomacyState,
  defaultAssistantCounters,
  diplomacyLocked,
  diplomacyStance,
  type FogMode,
  fogMode,
  goodsTradedWith,
  type MatchOutcome,
  type MatchRank,
  matchEnded,
  matchOutcome,
  matchRanking,
  missionBriefingHistory,
  missionBriefingPage,
  needsEnabled,
  type Paper,
  Position,
  peaceHoldsUntilTick,
  playerGoodList,
  playerPaperSlots,
  professionProgressionEnabled,
  Settler,
  Vehicle,
} from './components/index.js';
import { type MatchRulesView, matchRulesView } from './components/match.js';
import { type MissionPresentationView, missionPresentation } from './components/missions/presentation.js';
import type { UnlockKind } from './components/players/unlocks.js';
import { CommandQueue } from './core/command-queue.js';
import { type Command, type CommandEnvelope, setupCommand } from './core/commands/index.js';
import { EventBuffer } from './core/events.js';
import { PersonalNames } from './core/personal-names.js';
import { Rng } from './core/rng.js';
import { bindWorldContent } from './core/world-content.js';
import { type Entity, World } from './ecs/world.js';
import { checkInvariants as _checkInvariants, type Invariant as _Invariant } from './harness/invariants.js';
import { type HouseholdGoodPolicyView, householdGoodPolicyView } from './inspect/household-policy.js';
import { type MapFingerprintInput, mapFingerprint, mapFingerprintInput } from './inspect/map-fingerprint.js';
import {
  type HomeQualityView,
  homeQualityView,
  takeSnapshot,
  type WorldSnapshot,
} from './inspect/snapshot.js';
import { SnapshotDeltaStream, type SnapshotDeltaStreamOptions } from './inspect/snapshot-clones.js';
import type { HalfCellNode, NodeArea } from './nav/halfcell.js';
import { buildTerrainGraph, type TerrainGraph, type TerrainMap } from './nav/terrain/index.js';
import { hashSimState } from './simulation/hash.js';
import {
  type MooringAnswer,
  mooringAnswerFor,
  type NodeGridAnswer,
  type NodeSetAnswer,
  ownPalisadeNodeSet,
  palisadeAnswerFor,
  placementAnswerFor,
  roadSiteAnswerFor,
  type ShipWaterAnswer,
  shipWaterAnswerFor,
  shipWaterVersionOf,
  signpostAnswerFor,
  signpostBlockerVersionOf,
} from './simulation/probe-answers.js';
import {
  type FogMaskAnswer,
  type FogView,
  fogMaskAnswerFor,
  fogViewFor,
  placementProbeFor,
  signpostProbeFor,
} from './simulation/read-seams.js';
import {
  type SyncDigest,
  type SyncDigestInputs,
  SyncDigestRecorder,
  type SyncDigestRecorderOptions,
} from './simulation/sync-digest.js';
import {
  type ApprenticeView,
  seatApprenticeViews,
} from './systems/computer-player/technology/apprentices.js';
import { BattleFront, holdsGround } from './systems/conflict/battle-alert.js';
import type { MapContext, SystemContext } from './systems/context.js';
import type { PlacementProbe } from './systems/footprint/index.js';
import {
  type ConstructionPlot,
  constructionSitePlots,
  placementBlockerVersion,
} from './systems/footprint/index.js';
import { type LandscapeEditView, landscapeEdits } from './systems/landscape/view.js';
import { type MapEscalationView, mapEscalationView } from './systems/map-escalation/index.js';
import { type MatchGoalProgress, matchGoalProgress } from './systems/match/index.js';
import { peaceGroundFor } from './systems/match/peace.js';
import {
  type InfoLineView,
  infoLines,
  type MissionGroupKind,
  type MissionScript,
  type MissionStatus,
  missionCentre,
  missionObjects,
  missionStatus,
  type OpenTribute,
  openTributes,
} from './systems/missions/index.js';
import {
  type FormationOrder,
  type FormationSlotGroup,
  formationSlotsFor,
} from './systems/orders/formation-slots.js';
import {
  ownPalisadeNodes,
  type PalisadeGateProbeResult,
  palisadeGateProbe,
  palisadeGateSites,
  palisadeLayoutVersion,
  palisadePlacementProbe,
} from './systems/palisades/index.js';
import {
  canChooseJob,
  needSubjectOf,
  settlerMeetsNeed,
  type UnlockStatus,
  unlockStatus,
} from './systems/progression/index.js';
import { armorGoodsByProtection, weaponGoodsByStrength } from './systems/readviews/combat.js';
import { type ConstructionSupply, constructionSupply } from './systems/readviews/construction-supply.js';
import {
  type EquipPickEntry,
  type EquipSelectionPick,
  equipPickList,
  equipPicksForSelection,
} from './systems/readviews/index.js';
import { type WorkStatus, workStatus } from './systems/readviews/work-status.js';
import { syncRoadLane } from './systems/roads/index.js';
import { roadSitePlacementVersion } from './systems/roads/sites.js';
import { SYSTEM_ORDER } from './systems/schedule.js';
import { INTENT_WEAPON_CLASS } from './systems/settlers/atomics/effects/goods/weapon-class.js';
import type { SignpostProbe } from './systems/signposts/index.js';
import { type SignpostReachView, signpostReachKey, signpostReachView } from './systems/signposts/reach.js';
import {
  canAttachTradeHouse,
  canPinTradeShip,
  type TradeOffer,
  type TraderView,
  tradeOffersAt,
  tradeOffersOf,
  traderView,
} from './systems/trade/index.js';
import {
  canAttachToVehicle,
  canTakeHaulingCart,
  landingOf,
  type MooringProbe,
  mooringProbe,
  type VehicleView,
  vehiclesOf,
  vehicleView,
} from './systems/vehicles/index.js';
import { FogState, playerHasMet } from './systems/vision/index.js';

export type { FogMaskAnswer, FogView } from './simulation/read-seams.js';
export type { DigestComponentInputs, SyncDigest, SyncDigestInputs } from './simulation/sync-digest.js';

export interface SimOptions {
  seed: number;
  content: ContentSet;
  /** Dimensions plus a row-major landscape-typeId grid. Omitted for a mapless sim. */
  map?: TerrainMap;
  /** The map's decoded mission script. Omitted for a world that runs no script. */
  missions?: MissionScript;
  /** The map's `[AIData]` rows. Omitted for a world whose map authored none. */
  mapAiScript?: MapAiScript;
  /** The map variant's escalating siege. Omitted for a world that runs none. */
  mapEscalation?: MapEscalation;
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
  readonly names: PersonalNames;
  /** World seed, also used to reconstruct personal-name decks after restoring a save. */
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
  readonly mapAiScript?: MapAiScript;
  /** The map variant's escalating siege, the escalation system's input; immutable like `mapAiScript`. */
  readonly mapEscalation?: MapEscalation;
  /** The map's identity inputs, over the terrain's own lanes where they match, so the map's arrays are
   *  not held for a digest only a save or a load reads. */
  private readonly mapIdentity?: MapFingerprintInput;
  private mapFingerprintMemo?: string;
  /** Null until {@link setSyncDigest} turns the digest on; while set it is the world's mutation sink. */
  private digest: SyncDigestRecorder | null = null;
  private lastDigest: SyncDigest | null = null;
  private lastDigestInputs: SyncDigestInputs | null = null;
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
    this.names = new PersonalNames(opts.seed, opts.content.personalNames);
    this.seed = opts.seed;
    this.content = opts.content;
    bindWorldContent(this.world, opts.content);
    if (opts.missions !== undefined) this.missions = opts.missions;
    if (opts.mapAiScript !== undefined) this.mapAiScript = opts.mapAiScript;
    if (opts.mapEscalation !== undefined) this.mapEscalation = opts.mapEscalation;
    if (opts.map !== undefined) {
      const typeIds = Int32Array.from(opts.map.typeIds);
      this.terrain = buildTerrainGraph(opts.content, opts.map, typeIds);
      this.mapIdentity = mapFingerprintInput(opts.map, this.terrain, typeIds);
      this.fog = new FogState(this.terrain, this.world);
    }
  }

  /**
   * Identity of the navigated half-cell grid, for a save file's map check; undefined for a mapless
   * sim. An immutable input digest like `terrain`, so `hashState` does not mix it in. Digested on
   * first read: a whole-grid walk that only a save, a load, or a diagnostic ever needs.
   */
  get mapFingerprint(): string | undefined {
    if (this.mapIdentity === undefined) return undefined;
    this.mapFingerprintMemo ??= mapFingerprint(this.mapIdentity);
    return this.mapFingerprintMemo;
  }

  matchRules(): MatchRulesView {
    return matchRulesView(this.world);
  }

  /** The escalation's progress for the HUD and render; null for a world that runs none. */
  mapEscalationView(): MapEscalationView | null {
    return this.mapEscalation === undefined ? null : mapEscalationView(this.world, this.mapEscalation);
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
      names: this.names,
      tick: this.currentTick,
      events: this.events,
      commands: this.commands,
      // An absent optional resource must be omitted, not set to undefined.
      ...(this.terrain !== undefined ? { terrain: this.terrain } : {}),
      ...(this.fog !== undefined ? { fog: this.fog } : {}),
      ...(this.missions !== undefined ? { missions: this.missions } : {}),
      ...(this.mapAiScript !== undefined ? { mapAiScript: this.mapAiScript } : {}),
      ...(this.mapEscalation !== undefined ? { mapEscalation: this.mapEscalation } : {}),
    };
  }

  /**
   * Whether the battle alert holds `entity` where it stands - no rest, no meal it would have to walk to,
   * no company - because fighting is going on around it (`systems/conflict/battle-alert.ts`). The drive
   * ladder's own rule, for a HUD that would otherwise caption such a unit as idle. Reads the world as it
   * stands; the index it builds lives for the call. A rider aboard a vehicle stands nowhere.
   */
  standsTo(entity: Entity): boolean {
    if (!this.world.has(entity, Position)) return false;
    const ctx = this.context();
    return holdsGround(this.world, ctx, entity, new BattleFront(this.world, ctx));
  }

  /** Advance exactly one tick by running every system in order. */
  step(): void {
    this.currentTick++;
    this.events.clear(); // events for tick N are a pure function of this tick's systems
    this.digest?.beginTick();
    if (this.terrain !== undefined) syncRoadLane(this.world, this.terrain);
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
      const sealed = this.digest.seal(
        this.world,
        this.currentTick,
        this.rng.getState(),
        this.fog,
        this.names.digest(),
      );
      this.lastDigest = sealed.digest;
      this.lastDigestInputs = sealed.inputs;
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

  /** Open the change feed a `SnapshotMirror` rebuilds the snapshot from, one stream per mirror. Its
   *  first delta rebuilds; taken after every `step()`, each later one is that tick's changes. */
  snapshotDeltas(options?: SnapshotDeltaStreamOptions): SnapshotDeltaStream {
    return new SnapshotDeltaStream(this, options);
  }

  unlockStatus(kind: UnlockKind, typeId: number, tribe: number, player?: number): UnlockStatus {
    return unlockStatus(this.world, { content: this.content }, player, tribe, kind, typeId);
  }

  /** The tribes whose houses `player` may place, home tribes first; see `buildTribes`. */
  buildTribes(player: number): readonly number[] {
    return buildTribes(this.world, player);
  }

  canChooseJob(entity: Entity, jobType: number): boolean {
    if (!this.world.has(entity, Settler)) return false;
    return canChooseJob(this.world, { content: this.content }, needSubjectOf(this.world, entity), jobType);
  }

  /** Whether the settler has earned `goodType` under its tribe's `needforgood` table, the gate on
   *  gathering or making it. */
  hasEarnedGood(entity: Entity, goodType: number): boolean {
    if (!this.world.has(entity, Settler)) return false;
    const subject = needSubjectOf(this.world, entity);
    return settlerMeetsNeed(this.world, { content: this.content }, subject, 'good', goodType);
  }

  /**
   * A buildability test for one building type, reading the same rules the `placeBuilding` command gates on.
   * Blockers come from the incrementally maintained placement count grid, so probing a viewport costs
   * O(visible tiles); with a `player` the probe also refuses the ground a hostile army the seat can see
   * contests and the ground a lobby peace keeps the seat off. A supplied tribe picks the footprint and,
   * while `gated`, adds its player-scoped technology gate, which a placing paper waives. Null for a
   * mapless sim.
   */
  placementProbe(buildingType: number, player?: number, tribe?: number, gated = true): PlacementProbe | null {
    return placementProbeFor(
      this.world,
      this.content,
      this.terrain,
      this.fog,
      buildingType,
      player,
      tribe,
      gated,
    );
  }

  /** Fresh formation groups on land, with vehicle commanders retaining the clicked target. */
  formationSlots(
    target: HalfCellNode,
    members: readonly Entity[],
    rowSpacing: 1 | 2 = 1,
    order: FormationOrder = 'move',
  ): readonly FormationSlotGroup[] | null {
    return formationSlotsFor(this.world, this.content, this.terrain, target, members, rowSpacing, order);
  }

  /** {@link placementProbe}'s verdict over every node of `area`, as plain data; `withinReach` off drops
   *  the seat's site reach, for a placement that enters through the admin channel. */
  placementAnswer(
    buildingType: number,
    area: NodeArea,
    player?: number,
    tribe?: number,
    gated = true,
    withinReach = true,
  ): NodeGridAnswer | null {
    return placementAnswerFor(
      this.world,
      this.content,
      this.terrain,
      this.fog,
      buildingType,
      area,
      player,
      tribe,
      gated,
      withinReach,
    );
  }

  /** Changes whenever {@link shipWaterAnswer} may over the same anchor, movers aside. */
  shipWaterVersion(): string {
    return shipWaterVersionOf(this.world);
  }

  /** Whether a workshop of `buildingType` (of `tribe`, whose footprint the door reads) placed at the
   *  anchor `(x, y)` would find ship water in its crew's yard search, as plain data; null for a type
   *  whose chain builds no ships or a mapless sim. With a `player`, the seat's unfinished ship yards in
   *  reach count as ship water too. */
  shipWaterAnswer(
    buildingType: number,
    tribe: number | undefined,
    x: number,
    y: number,
    player?: number,
  ): ShipWaterAnswer | null {
    return shipWaterAnswerFor(this.world, this.content, this.terrain, buildingType, tribe, x, y, player);
  }

  /** Collision probe for one data-described palisade or gate graphic and, with a `player`, the ground a
   *  peace keeps the seat off, as the `placePalisade` command reads them. Null for an unknown row or
   *  mapless sim. */
  palisadeProbe(gfxIndex: number, player?: number): PlacementProbe | null {
    if (this.terrain === undefined) return null;
    const probe = palisadePlacementProbe(this.world, this.content, this.terrain, gfxIndex);
    const peace = peaceGroundFor(this.world, player);
    if (probe === null || peace === null) return probe;
    return { canPlace: (x, y) => probe.canPlace(x, y) && !peace.bars(x, y) };
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

  /** {@link palisadeProbe}'s verdict over every node of `area`, as plain data. */
  palisadeAnswer(gfxIndex: number, area: NodeArea, player?: number): NodeGridAnswer | null {
    return palisadeAnswerFor(this.world, this.content, this.terrain, gfxIndex, area, player);
  }

  /** Where a road may be ordered over every node of `area`, as plain data; null for a mapless sim. */
  roadSiteAnswer(area: NodeArea): NodeGridAnswer | null {
    return roadSiteAnswerFor(this.world, this.content, this.terrain, area);
  }

  /** Changes whenever {@link roadSiteAnswer} may answer differently. */
  roadSitePlacementVersion(): string {
    return roadSitePlacementVersion(this.world);
  }

  /** The nodes {@link ownPalisadeNodes} accepts, as plain data. */
  ownPalisadeNodeSet(player: number): NodeSetAnswer {
    return ownPalisadeNodeSet(this.world, player);
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
   * open work-flag ground past the player's signpost spacing. Null for a mapless sim.
   */
  signpostProbe(player: number): SignpostProbe | null {
    return signpostProbeFor(this.world, this.content, this.terrain, player);
  }

  /** The discoveries computer seat `player` earns ahead of time and the man pinned on each, for a
   *  debug view. Reads the world as it stands and issues no command. */
  computerApprentices(player: number): readonly ApprenticeView[] {
    return seatApprenticeViews(this.world, this.context(), player);
  }

  /** {@link signpostProbe}'s verdict over every node of `area`, as plain data. */
  signpostAnswer(player: number, area: NodeArea): NodeGridAnswer | null {
    return signpostAnswerFor(this.world, this.content, this.terrain, player, area);
  }

  signpostReachVersion(): string {
    return this.terrain === undefined ? '' : signpostReachKey(this.world, this.content, this.terrain);
  }

  signpostReach(player: number): SignpostReachView | null {
    return this.terrain === undefined
      ? null
      : signpostReachView(this.world, this.content, this.terrain, player);
  }

  /**
   * {@link placementBlockerVersion} plus the work-flag generation, since flags block signpost cells but
   * not buildings, and the posts and planned posts the spacing rule reads.
   */
  signpostBlockerVersion(): string {
    return signpostBlockerVersionOf(this.world);
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

  /** The selection's equip menu: every good some of `entities` can wear and reach, with the settlers a
   *  pick would send. Read-only, click-time: a pass over every store, then the selection times the stores
   *  holding equippable goods, no per-member terrain flood; the read's doc carries the measurement. */
  equipPicksForSelection(entities: readonly Entity[]): EquipSelectionPick[] {
    return equipPicksForSelection(this.world, this.content, this.terrain, entities);
  }

  /**
   * Why a craft worker, gatherer or store carrier works or stands idle, for the settler panel and the idle
   * and stall notes; undefined when no status applies. Read-only. A gatherer's harvest scan is capped and a
   * hunter's prey scan covers its hunting ground. Per missing input and per full product, the signpost-reach
   * check weighs at most a capped number of its own side's stores and sources, but walks past rival stores
   * and the sources that bring the good elsewhere without counting them.
   */
  workStatus(entity: Entity): WorkStatus | undefined {
    return workStatus(this.world, this.context(), entity);
  }

  /** What a building site's bill still lacks and whether its side holds each missing good, for the note
   *  about a site short of a material; undefined for anything but a building site. Read-only. */
  constructionSupply(site: Entity): ConstructionSupply | undefined {
    return constructionSupply(this.world, this.context(), site);
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

  /** The good types `player`'s assistant hands to fighters alone, as a detached copy. */
  assistantSoldierOnlyGrants(player: number): readonly number[] {
    return [...assistantSoldierOnlyGoods(this.world, player)];
  }

  /** The good types `player`'s assistant hands to civilians alone, as a detached copy. */
  assistantCivilianOnlyGrants(player: number): readonly number[] {
    return [...assistantCivilianOnlyGoods(this.world, player)];
  }

  /** The weapon goods `player`'s assistant never arms a recruit with, as a detached copy. */
  assistantWeaponVetoes(player: number): readonly number[] {
    return [...playerGoodList(this.world, AssistantWeaponVetoes, player)];
  }

  /** The armor choice of `player`'s `intent` class as a detached copy: the default order, strongest
   *  protection first with nothing off, while the seat has not set one. */
  assistantArmorOrder(player: number, intent: AssistantArmingIntent): AssistantArmorOrder {
    const choice = assistantArmorOrder(this.world, player, intent);
    return {
      order: [...(choice?.order ?? armorGoodsByProtection(this.content))],
      off: [...(choice?.off ?? [])],
    };
  }

  /** The weapon order of `player`'s `intent` class as a detached copy: every weapon good of the class,
   *  strongest first while the seat has not set one. */
  assistantWeaponOrder(player: number, intent: AssistantArmingIntent): readonly number[] {
    const order = assistantWeaponOrder(this.world, player, intent);
    return [...(order ?? weaponGoodsByStrength(this.content, INTENT_WEAPON_CLASS[intent]))];
  }

  /** Whether `player`'s assistant sends graduates straight to a free workplace. */
  assistantPostsGraduates(player: number): boolean {
    return assistantPostsGraduatesEntity(this.world, player) !== null;
  }

  /** Whether `player`'s gatherers move their own flags after the resources. */
  assistantMovesFlags(player: number): boolean {
    return assistantMovesFlags(this.world, player);
  }

  /** Whether `player`'s workers swap their tools for better granted ones. */
  assistantUpgradesTools(player: number): boolean {
    return assistantUpgradesTools(this.world, player);
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

  /** Whether the lobby peace the `setPeaceTime` command opened still binds `a` and `b`. */
  atPeace(a: number, b: number): boolean {
    return atPeace(this.world, a, b);
  }

  /** The match tick the holding lobby peace ends at; null with no peace or once it ended. */
  peaceHoldsUntilTick(): number | null {
    return peaceHoldsUntilTick(this.world);
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

  /** A goal table's verdicts in the order they landed; empty under any other rule. */
  matchRanking(): readonly MatchRank[] {
    return matchRanking(this.world);
  }

  /** `player`'s standing on the goal table's goods and inhabitants rows as of the latest check. */
  matchGoalProgress(player: number): readonly MatchGoalProgress[] {
    return matchGoalProgress(this.world, { content: this.content }, player);
  }

  /** The open, unpaid tributes the map's script has `payer` owing, ascending by slot, each with what
   *  the payer's stores hold toward it and whether the `payTribute` command would act on it now:
   *  each demand covered on its own, so a payment can still fall short. */
  openTributes(payer: number): readonly OpenTribute[] {
    return openTributes(this.world, { content: this.content }, payer);
  }

  /** The units `player`'s traders have loaded out of `partner`'s houses under a trade agreement. */
  goodsTradedWith(player: number, partner: number): number {
    return goodsTradedWith(this.world, player, partner);
  }

  /** A trader's route, cart and agreement choice as a detached copy; undefined for any other unit. */
  traderView(trader: Entity): TraderView | undefined {
    return traderView(this.world, this.mapContext(), trader);
  }

  /** The map agreements a house offers a visiting trader, as detached copies. */
  tradeOffersAt(house: Entity): readonly TradeOffer[] {
    return tradeOffersAt(this.world, house);
  }

  /** Every map agreement `partner`'s houses offer, each once, as detached copies. */
  tradeOffersOf(partner: number): readonly TradeOffer[] {
    return tradeOffersOf(this.world, partner);
  }

  /** A vehicle's type, crew, hold and standing as a detached copy; undefined for anything else. */
  vehicleView(vehicle: Entity): VehicleView | undefined {
    return vehicleView(this.world, this.mapContext(), vehicle);
  }

  /** Every vehicle `player` owns, ascending by entity id, as detached copies. */
  vehiclesOf(player: number): readonly VehicleView[] {
    return vehiclesOf(this.world, this.mapContext(), player);
  }

  /** The content with the terrain when the run has one; an absent optional resource is omitted, not undefined. */
  private mapContext(): MapContext {
    return { content: this.content, ...(this.terrain !== undefined ? { terrain: this.terrain } : {}) };
  }

  /** Whether the `attachTradeHouse` command would put `house` on the trader's route right now. */
  canAttachTradeHouse(trader: Entity, house: Entity): boolean {
    return canAttachTradeHouse(this.world, this.mapContext(), trader, house);
  }

  /** Whether the `setTradeShip` command would pin `ship` to `trader` right now. */
  canPinTradeShip(trader: Entity, ship: Entity): boolean {
    return canPinTradeShip(this.world, this.mapContext(), trader, ship);
  }

  /** Every ship {@link canPinTradeShip} admits for `trader`, ascending by id. */
  tradeShipsPinnableBy(trader: Entity): Entity[] {
    const ctx = this.mapContext();
    return this.world
      .canonicalQuery(Vehicle)
      .filter((ship) => canPinTradeShip(this.world, ctx, trader, ship));
  }

  /** Whether the `attachToVehicle` command would seat `settler` on `vehicle` right now, or hand it the
   *  vehicle as its hauling cart. */
  canAttachToVehicle(settler: Entity, vehicle: Entity): boolean {
    const ctx = this.mapContext();
    return (
      canAttachToVehicle(this.world, ctx, settler, vehicle) ||
      canTakeHaulingCart(this.world, ctx, settler, vehicle)
    );
  }

  /** Every house {@link canAttachTradeHouse} admits for `trader`, ascending by id: one answer for the
   *  trade-house pick instead of one per building. */
  tradeHousesAttachableBy(trader: Entity): Entity[] {
    const ctx = this.mapContext();
    return this.world
      .canonicalQuery(Building)
      .filter((house) => canAttachTradeHouse(this.world, ctx, trader, house));
  }

  /** Every vehicle {@link canAttachToVehicle} admits for `settler`, ascending by id. */
  vehiclesAttachableBy(settler: Entity): Entity[] {
    const ctx = this.mapContext();
    return this.world
      .canonicalQuery(Vehicle)
      .filter(
        (vehicle) =>
          canAttachToVehicle(this.world, ctx, settler, vehicle) ||
          canTakeHaulingCart(this.world, ctx, settler, vehicle),
      );
  }

  /**
   * Where a ship's dock order would find a mooring, reading the rule the `dockVehicle` command applies;
   * memoized per blocker version and ship position. Null for a mapless sim or a vehicle that takes no
   * dock order.
   */
  mooringProbe(vehicle: Entity): MooringProbe | null {
    if (this.terrain === undefined) return null;
    return mooringProbe(this.world, { content: this.content }, this.terrain, vehicle);
  }

  /** {@link mooringProbe}'s spots, as plain data. */
  mooringAnswer(vehicle: Entity): MooringAnswer | null {
    return mooringAnswerFor(this.world, this.content, this.terrain, vehicle);
  }

  /** Whether the unload-people order would set `vehicle`'s riders down: the landing that order uses. */
  canUnloadPeople(vehicle: Entity): boolean {
    const ctx =
      this.terrain === undefined
        ? { content: this.content }
        : { content: this.content, terrain: this.terrain };
    return landingOf(this.world, ctx, vehicle) !== null;
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

  /** The mean map point of the `kind` entities stamped with mission object `id`, or null when none
   *  stands on the map: where a briefing's on-screen callback centres the view. */
  missionCentre(kind: MissionGroupKind, id: number): HalfCellNode | null {
    return missionCentre(this.world, kind, id) ?? null;
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

  /** {@link fogView}'s masks as plain data, for a reader on another thread. */
  fogMaskAnswer(player: number): FogMaskAnswer | null {
    return fogMaskAnswerFor(this.world, this.fog, player);
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
    return hashSimState(this.world, this.currentTick, this.rng.getState(), this.fog, this.names.digest());
  }

  /**
   * Turn the per-tick {@link SyncDigest} on or off. Off by default, so a run that never asks does no
   * digest work at all. Turning it on mid-run costs one walk of the fog masks, and the first digest it
   * seals covers the tick it was turned on for. `captureInputs` also keeps each seal's
   * {@link SyncDigestInputs}; changing it while on replaces the recorder and forgets the last digest.
   */
  setSyncDigest(enabled: boolean, options: SyncDigestRecorderOptions = {}): void {
    const captureInputs = enabled && (options.captureInputs ?? false);
    if (enabled === (this.digest !== null) && captureInputs === (this.digest?.captureInputs ?? false)) return;
    this.lastDigest = null;
    this.lastDigestInputs = null;
    if (!enabled) {
      this.digest = null;
      this.world.setMutationSink(null);
      this.fog?.stopFolding();
      return;
    }
    this.digest = new SyncDigestRecorder({ captureInputs });
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

  /** What the last {@link syncDigest} was folded from; null while the digest or its input capture is off. */
  syncDigestInputs(): SyncDigestInputs | null {
    return this.lastDigestInputs;
  }
}

/** The inputs a fresh run starts from. */
export interface SimInputs {
  readonly content: ContentSet;
  readonly seed: number;
  readonly map?: TerrainMap | undefined;
  readonly missions?: MissionScript | undefined;
  readonly mapAiScript?: MapAiScript | undefined;
  readonly mapEscalation?: MapEscalation | undefined;
}

/**
 * Build the fresh {@link Simulation} a run starts from. Callers may pass `map: undefined`; under
 * `exactOptionalPropertyTypes` the key must be omitted, since Simulation builds its terrain graph iff the
 * key is present.
 */
export function simFor({ content, seed, map, missions, mapAiScript, mapEscalation }: SimInputs): Simulation {
  return new Simulation({
    seed,
    content,
    ...(map !== undefined ? { map } : {}),
    ...(missions !== undefined ? { missions } : {}),
    ...(mapAiScript !== undefined ? { mapAiScript } : {}),
    ...(mapEscalation !== undefined ? { mapEscalation } : {}),
  });
}
