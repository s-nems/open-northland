import { components, type DiplomacyState, type Simulation } from '@open-northland/sim';
import { samePlainData } from '../last-answer-cache.js';
import type { AssistantFacts, WorldFacts } from './protocol.js';

const PLAYERS = components.MAX_PLAYERS;
const SEATS = Array.from({ length: PLAYERS }, (_, player) => player);

function readStances(sim: Simulation): { stances: DiplomacyState[]; met: boolean[] } {
  const stances: DiplomacyState[] = [];
  const met: boolean[] = [];
  for (const from of SEATS) {
    for (const to of SEATS) {
      stances.push(sim.diplomacyStance(from, to));
      met.push(sim.hasMetPlayer(from, to));
    }
  }
  return { stances, met };
}

function readAssistants(sim: Simulation): readonly AssistantFacts[] {
  return SEATS.map(
    (player): AssistantFacts => ({
      counters: sim.assistantCounters(player),
      grants: sim.assistantGrants(player),
      weaponVetoes: sim.assistantWeaponVetoes(player),
      soldierOnlyGrants: sim.assistantSoldierOnlyGrants(player),
      civilianOnlyGrants: sim.assistantCivilianOnlyGrants(player),
      weaponOrders: {
        trainSword: sim.assistantWeaponOrder(player, 'trainSword'),
        trainSpear: sim.assistantWeaponOrder(player, 'trainSpear'),
        trainBow: sim.assistantWeaponOrder(player, 'trainBow'),
      },
      armorOrders: {
        trainSword: sim.assistantArmorOrder(player, 'trainSword'),
        trainSpear: sim.assistantArmorOrder(player, 'trainSpear'),
        trainBow: sim.assistantArmorOrder(player, 'trainBow'),
      },
      postsGraduates: sim.assistantPostsGraduates(player),
      movesFlags: sim.assistantMovesFlags(player),
      upgradesTools: sim.assistantUpgradesTools(player),
    }),
  );
}

/** The per-frame reads that are no snapshot component, read off one sim for every seat, once per posted
 *  batch. The seat tables are re-read only when the sim's version over them moves, and are otherwise
 *  handed out as the same arrays, which {@link changedFacts} then skips by identity. */
export class WorldFactsReader {
  private diplomacyVersion: string | null = null;
  private stances: { stances: DiplomacyState[]; met: boolean[] } = { stances: [], met: [] };
  private assistantVersion: number | null = null;
  private assistants: readonly AssistantFacts[] = [];

  constructor(private readonly sim: Simulation) {}

  read(): WorldFacts {
    const sim = this.sim;
    const diplomacyVersion = sim.diplomacyVersion();
    if (diplomacyVersion !== this.diplomacyVersion) {
      this.diplomacyVersion = diplomacyVersion;
      this.stances = readStances(sim);
    }
    const assistantVersion = sim.assistantVersion();
    if (assistantVersion !== this.assistantVersion) {
      this.assistantVersion = assistantVersion;
      this.assistants = readAssistants(sim);
    }
    return {
      constructionPlots: sim.constructionPlots(),
      placementBlockerVersion: sim.placementBlockerVersion(),
      shipWaterVersion: sim.shipWaterVersion(),
      signpostReachVersion: sim.signpostReachVersion(),
      signpostBlockerVersion: sim.signpostBlockerVersion(),
      palisadeLayoutVersion: sim.palisadeLayoutVersion(),
      roadSitePlacementVersion: sim.roadSitePlacementVersion(),
      stances: this.stances.stances,
      met: this.stances.met,
      assistants: this.assistants,
      needsEnabled: sim.needsEnabled(),
      fogMode: sim.fogMode(),
      matchOutcomes: SEATS.map((player) => sim.matchOutcome(player)),
      matchRanking: sim.matchRanking(),
      missionStatus: sim.missionStatus(),
      mapEscalation: sim.mapEscalationView(),
    };
  }
}

/** The facts of `next` that differ from `last`; the plots and the seat tables compare by identity first,
 *  since the sim and {@link WorldFactsReader} hand out the same arrays while nothing changes. */
export function changedFacts(last: WorldFacts, next: WorldFacts): Partial<WorldFacts> {
  const changed: { -readonly [K in keyof WorldFacts]?: WorldFacts[K] } = {};
  if (next.constructionPlots !== last.constructionPlots) changed.constructionPlots = next.constructionPlots;
  if (next.placementBlockerVersion !== last.placementBlockerVersion)
    changed.placementBlockerVersion = next.placementBlockerVersion;
  if (next.shipWaterVersion !== last.shipWaterVersion) changed.shipWaterVersion = next.shipWaterVersion;
  if (next.signpostReachVersion !== last.signpostReachVersion)
    changed.signpostReachVersion = next.signpostReachVersion;
  if (next.signpostBlockerVersion !== last.signpostBlockerVersion)
    changed.signpostBlockerVersion = next.signpostBlockerVersion;
  if (next.palisadeLayoutVersion !== last.palisadeLayoutVersion)
    changed.palisadeLayoutVersion = next.palisadeLayoutVersion;
  if (next.roadSitePlacementVersion !== last.roadSitePlacementVersion)
    changed.roadSitePlacementVersion = next.roadSitePlacementVersion;
  if (next.stances !== last.stances && !samePlainData(next.stances, last.stances))
    changed.stances = next.stances;
  if (next.met !== last.met && !samePlainData(next.met, last.met)) changed.met = next.met;
  if (next.assistants !== last.assistants && !samePlainData(next.assistants, last.assistants))
    changed.assistants = next.assistants;
  if (next.needsEnabled !== last.needsEnabled) changed.needsEnabled = next.needsEnabled;
  if (next.fogMode !== last.fogMode) changed.fogMode = next.fogMode;
  if (!samePlainData(next.matchOutcomes, last.matchOutcomes)) changed.matchOutcomes = next.matchOutcomes;
  if (!samePlainData(next.matchRanking, last.matchRanking)) changed.matchRanking = next.matchRanking;
  if (!samePlainData(next.missionStatus, last.missionStatus)) changed.missionStatus = next.missionStatus;
  if (!samePlainData(next.mapEscalation, last.mapEscalation)) changed.mapEscalation = next.mapEscalation;
  return changed;
}
