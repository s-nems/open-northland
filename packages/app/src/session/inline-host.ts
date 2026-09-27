import {
  type EntitySnapshot,
  type ExportSaveOptions,
  exportSaveGame,
  type ScriptLandscapeType,
  type Simulation,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import { diagCadenceAt } from '../diag/session.js';
import { profiledInstrument, SystemProfile } from '../diag/system-profile.js';
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

/** The host over a live simulation on the same thread: every read is the sim's own, taken at call time
 *  and resolved as it stands, so a test may still stub the sim's methods. */
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
    placementBlockerVersion: () => sim.placementBlockerVersion(),
    signpostBlockerVersion: () => sim.signpostBlockerVersion(),
    palisadeLayoutVersion: () => sim.palisadeLayoutVersion(),
    diplomacyStance: (from, to) => sim.diplomacyStance(from, to),
    hasMetPlayer: (viewer, other) => sim.hasMetPlayer(viewer, other),
    assistantCounters: (player) => sim.assistantCounters(player),
    assistantGrants: (player) => sim.assistantGrants(player),
    assistantWeaponVetoes: (player) => sim.assistantWeaponVetoes(player),
    needsEnabled: () => sim.needsEnabled(),
    fogMode: () => sim.fogMode(),
    matchOutcome: (player) => sim.matchOutcome(player),
    missionStatus: () => sim.missionStatus(),

    tickEvents: () => sim.events.current(),
    tickDiagnostics: () => {
      const cadence = diagCadenceAt(sim.tick);
      if (cadence === null) {
        return Promise.reject(new Error(`the session took no diagnostics at tick ${sim.tick}`));
      }
      return Promise.resolve({
        hash: sim.hashState(),
        violations: cadence.invariants ? sim.checkInvariants() : null,
      });
    },
    hashState: () => Promise.resolve({ tick: sim.tick, hash: sim.hashState() }),

    placementProbe: (buildingType, area, player, tribe) =>
      Promise.resolve(sim.placementAnswer(buildingType, area, player, tribe)),
    signpostProbe: (player, area) => Promise.resolve(sim.signpostAnswer(player, area)),
    palisadeProbe: (gfxIndex, area) => Promise.resolve(sim.palisadeAnswer(gfxIndex, area)),
    palisadeGateProbe: (hx, hy, closedGates, player) =>
      Promise.resolve(sim.palisadeGateProbe(hx, hy, closedGates, player)),
    palisadeGateSites: (closedGates, player) => Promise.resolve(sim.palisadeGateSites(closedGates, player)),
    ownPalisadeNodes: (player) => Promise.resolve(sim.ownPalisadeNodeSet(player)),
    mooringProbe: (vehicle) => Promise.resolve(sim.mooringAnswer(vehicle)),

    unlockStatus: (kind, typeId, tribe, player) =>
      Promise.resolve(sim.unlockStatus(kind, typeId, tribe, player)),
    canChooseJob: (entity, jobType) => Promise.resolve(sim.canChooseJob(entity, jobType)),
    equipPickList: (entity, group) => Promise.resolve(sim.equipPickList(entity, group)),
    standsTo: (entity) => Promise.resolve(sim.standsTo(entity)),
    workStatus: (entity) => Promise.resolve(sim.workStatus(entity)),
    papers: (player) => Promise.resolve(sim.papers(player)),
    diplomacyLocked: (a, b) => Promise.resolve(sim.diplomacyLocked(a, b)),
    goodsTradedWith: (player, partner) => Promise.resolve(sim.goodsTradedWith(player, partner)),
    openTributes: (payer) => Promise.resolve(sim.openTributes(payer)),
    tradeOffersOf: (partner) => Promise.resolve(sim.tradeOffersOf(partner)),
    tradeOffersAt: (house) => Promise.resolve(sim.tradeOffersAt(house)),
    traderView: (trader) => Promise.resolve(sim.traderView(trader)),
    tradeHousesAttachableBy: (trader) => Promise.resolve(sim.tradeHousesAttachableBy(trader)),
    vehiclesAttachableBy: (settler) => Promise.resolve(sim.vehiclesAttachableBy(settler)),
    missionBriefingHistory: () => Promise.resolve(sim.missionBriefingHistory()),
    missionBriefingPage: () => Promise.resolve(sim.missionBriefingPage()),
    missionHuman: (id) => Promise.resolve(sim.missionHuman(id)),
    missionPresentation: () => Promise.resolve(sim.missionPresentation()),
    infoLines: (player) => Promise.resolve(sim.infoLines(player)),
    landscapeEdits: () => Promise.resolve(sim.landscapeEdits()),
    exportSave: (options?: ExportSaveOptions) => Promise.resolve(exportSaveGame(sim, options)),

    commandLog: () => Promise.resolve(sim.commands.log),
    installInstruments: ({ profile, spans }) => {
      const kept = profile ? new SystemProfile() : null;
      sim.setInstrument(profiledInstrument(kept, spans));
      return kept === null ? null : { rows: () => Promise.resolve(kept.rows()), reset: () => kept.reset() };
    },
    run: (ticks) => Promise.resolve(sim.run(ticks)),
    settled: () => Promise.resolve(),
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
