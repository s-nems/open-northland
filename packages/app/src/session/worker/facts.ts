import { components, type DiplomacyState, type Simulation } from '@open-northland/sim';
import { samePlainData } from '../last-answer-cache.js';
import type { AssistantFacts, WorldFacts } from './protocol.js';

const PLAYERS = components.MAX_PLAYERS;
const SEATS = Array.from({ length: PLAYERS }, (_, player) => player);

/** The per-frame reads that are no snapshot component, read off the sim for every seat. The tables
 *  cost a few hundred small lookups, taken once per posted batch rather than per tick. */
export function readWorldFacts(sim: Simulation): WorldFacts {
  const stances: DiplomacyState[] = [];
  const met: boolean[] = [];
  for (const from of SEATS) {
    for (const to of SEATS) {
      stances.push(sim.diplomacyStance(from, to));
      met.push(sim.hasMetPlayer(from, to));
    }
  }
  return {
    constructionPlots: sim.constructionPlots(),
    placementBlockerVersion: sim.placementBlockerVersion(),
    signpostReachVersion: sim.signpostReachVersion(),
    signpostBlockerVersion: sim.signpostBlockerVersion(),
    palisadeLayoutVersion: sim.palisadeLayoutVersion(),
    roadSitePlacementVersion: sim.roadSitePlacementVersion(),
    stances,
    met,
    assistants: SEATS.map(
      (player): AssistantFacts => ({
        counters: sim.assistantCounters(player),
        grants: sim.assistantGrants(player),
        weaponVetoes: sim.assistantWeaponVetoes(player),
        postsGraduates: sim.assistantPostsGraduates(player),
        movesFlags: sim.assistantMovesFlags(player),
      }),
    ),
    needsEnabled: sim.needsEnabled(),
    fogMode: sim.fogMode(),
    matchOutcomes: SEATS.map((player) => sim.matchOutcome(player)),
    missionStatus: sim.missionStatus(),
  };
}

/** The facts of `next` that differ from `last`; the plots compare by identity, since the sim hands out
 *  the same array while no site changes. */
export function changedFacts(last: WorldFacts, next: WorldFacts): Partial<WorldFacts> {
  const changed: { -readonly [K in keyof WorldFacts]?: WorldFacts[K] } = {};
  if (next.constructionPlots !== last.constructionPlots) changed.constructionPlots = next.constructionPlots;
  if (next.placementBlockerVersion !== last.placementBlockerVersion)
    changed.placementBlockerVersion = next.placementBlockerVersion;
  if (next.signpostReachVersion !== last.signpostReachVersion)
    changed.signpostReachVersion = next.signpostReachVersion;
  if (next.signpostBlockerVersion !== last.signpostBlockerVersion)
    changed.signpostBlockerVersion = next.signpostBlockerVersion;
  if (next.palisadeLayoutVersion !== last.palisadeLayoutVersion)
    changed.palisadeLayoutVersion = next.palisadeLayoutVersion;
  if (next.roadSitePlacementVersion !== last.roadSitePlacementVersion)
    changed.roadSitePlacementVersion = next.roadSitePlacementVersion;
  if (!samePlainData(next.stances, last.stances)) changed.stances = next.stances;
  if (!samePlainData(next.met, last.met)) changed.met = next.met;
  if (!samePlainData(next.assistants, last.assistants)) changed.assistants = next.assistants;
  if (next.needsEnabled !== last.needsEnabled) changed.needsEnabled = next.needsEnabled;
  if (next.fogMode !== last.fogMode) changed.fogMode = next.fogMode;
  if (!samePlainData(next.matchOutcomes, last.matchOutcomes)) changed.matchOutcomes = next.matchOutcomes;
  if (!samePlainData(next.missionStatus, last.missionStatus)) changed.missionStatus = next.missionStatus;
  return changed;
}
