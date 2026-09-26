import {
  type EntitySnapshot,
  type ExportSaveOptions,
  exportSaveGame,
  type ScriptLandscapeType,
  type Simulation,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import type { SessionHost } from './host.js';

const NO_LANDSCAPE_TYPES: readonly ScriptLandscapeType[] = [];
const NO_ENTITIES: readonly EntitySnapshot[] = [];

export interface InlineSessionHostOptions {
  /**
   * `mirror` (the default) reads snapshots off a `SnapshotMirror` fed by the sim's delta stream, the
   * path a host off the main thread serves, so the game exercises it before any worker exists. `live`
   * reads `Simulation.snapshot()` itself, for a test that stubs it, and names no departed entities.
   */
  readonly snapshots?: 'mirror' | 'live';
}

/** The host over a live simulation on the same thread: every read is the sim's own, at call time, so
 *  a test may still stub the sim's methods. */
export function inlineSessionHost(sim: Simulation, options: InlineSessionHostOptions = {}): SessionHost {
  const { snapshot, departed } =
    options.snapshots === 'live'
      ? { snapshot: () => sim.snapshot(), departed: () => NO_ENTITIES }
      : mirroredSnapshots(sim);
  return {
    content: sim.content,
    get mapFingerprint() {
      return sim.mapFingerprint;
    },
    landscapeTypes: sim.terrain?.landscapes?.types ?? NO_LANDSCAPE_TYPES,
    missions: sim.missions,

    get tick() {
      return sim.tick;
    },
    snapshot,
    departed,
    fogView: (player) => sim.fogView(player),
    constructionPlots: () => sim.constructionPlots(),
    placementProbe: (buildingType, player, tribe) => sim.placementProbe(buildingType, player, tribe),
    placementBlockerVersion: () => sim.placementBlockerVersion(),
    signpostProbe: (player) => sim.signpostProbe(player),
    signpostBlockerVersion: () => sim.signpostBlockerVersion(),
    palisadeProbe: (gfxIndex) => sim.palisadeProbe(gfxIndex),
    palisadeGateProbe: (hx, hy, closedGates, player) => sim.palisadeGateProbe(hx, hy, closedGates, player),
    palisadeLayoutVersion: () => sim.palisadeLayoutVersion(),
    palisadeGateSites: (closedGates, player) => sim.palisadeGateSites(closedGates, player),
    ownPalisadeNodes: (player) => sim.ownPalisadeNodes(player),
    mooringProbe: (vehicle) => sim.mooringProbe(vehicle),
    diplomacyStance: (from, to) => sim.diplomacyStance(from, to),
    hasMetPlayer: (viewer, other) => sim.hasMetPlayer(viewer, other),
    assistantCounters: (player) => sim.assistantCounters(player),
    assistantGrants: (player) => sim.assistantGrants(player),
    assistantWeaponVetoes: (player) => sim.assistantWeaponVetoes(player),
    needsEnabled: () => sim.needsEnabled(),
    fogMode: () => sim.fogMode(),

    tickEvents: () => sim.events.current(),
    hashState: () => sim.hashState(),

    unlockStatus: (kind, typeId, tribe, player) => sim.unlockStatus(kind, typeId, tribe, player),
    canChooseJob: (entity, jobType) => sim.canChooseJob(entity, jobType),
    equipPickList: (entity, group) => sim.equipPickList(entity, group),
    standsTo: (entity) => sim.standsTo(entity),
    papers: (player) => sim.papers(player),
    diplomacyLocked: (a, b) => sim.diplomacyLocked(a, b),
    goodsTradedWith: (player, partner) => sim.goodsTradedWith(player, partner),
    openTributes: (payer) => sim.openTributes(payer),
    tradeOffersOf: (partner) => sim.tradeOffersOf(partner),
    tradeOffersAt: (house) => sim.tradeOffersAt(house),
    traderView: (trader) => sim.traderView(trader),
    canAttachTradeHouse: (trader, house) => sim.canAttachTradeHouse(trader, house),
    canAttachToVehicle: (settler, vehicle) => sim.canAttachToVehicle(settler, vehicle),
    missionStatus: () => sim.missionStatus(),
    missionBriefingHistory: () => sim.missionBriefingHistory(),
    missionBriefingPage: () => sim.missionBriefingPage(),
    missionHuman: (id) => sim.missionHuman(id),
    missionPresentation: () => sim.missionPresentation(),
    infoLines: (player) => sim.infoLines(player),
    landscapeEdits: () => sim.landscapeEdits(),
    matchOutcome: (player) => sim.matchOutcome(player),
    exportSave: (options?: ExportSaveOptions) => exportSaveGame(sim, options),

    get commandLog() {
      return sim.commands.log;
    },
    setInstrument: (instrument) => sim.setInstrument(instrument),
    run: (ticks) => sim.run(ticks),
  };
}

/** Pull the sim's pending changes into the mirror on every read, so a frame between ticks reads the
 *  same snapshot object and a stepped tick reads a new one; either read pulls, so their order within a
 *  frame does not matter. */
function mirroredSnapshots(sim: Simulation): Pick<SessionHost, 'snapshot' | 'departed'> {
  const deltas = sim.snapshotDeltas();
  const mirror = new SnapshotMirror();
  const pull = (): SnapshotMirror => {
    const delta = deltas.next();
    if (delta !== null) mirror.apply(delta);
    return mirror;
  };
  return {
    snapshot: (): WorldSnapshot => pull().snapshot(),
    departed: (): readonly EntitySnapshot[] => pull().departed,
  };
}
