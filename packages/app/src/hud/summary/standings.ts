import { hudPeopleOf } from '@open-northland/render';
import { countedBy, indexesOf, type MatchOutcome, type WorldSnapshot } from '@open-northland/sim';
import { isFinishedBuilding, ownerPlayerOf } from '../../game/snapshot/index.js';
import { type SummaryPopulation, summaryPopulation } from './model.js';

/** How a seat stands: decided by the match rules, out of people and buildings, or still playing. */
export type SeatStatus = 'playing' | 'won' | 'defeated' | 'empty';

/** One seat's figures on the spectator's standings strip. */
export interface SeatStanding {
  readonly player: number;
  readonly people: SummaryPopulation;
  /** Finished buildings; sites and houses under an upgrade are left out. */
  readonly buildings: number;
  readonly status: SeatStatus;
}

const FINISHED_BUILDINGS_BY_OWNER = countedBy(
  (e) => (isFinishedBuilding(e) ? ownerPlayerOf(e) : undefined),
  'finished buildings by owner',
  { values: ['Building', 'Owner'], presence: ['UnderConstruction'] },
);

function statusOf(outcome: MatchOutcome, people: SummaryPopulation, buildings: number): SeatStatus {
  if (outcome === 'victory') return 'won';
  if (outcome === 'defeat') return 'defeated';
  return people.total === 0 && buildings === 0 ? 'empty' : 'playing';
}

/** Each of `seats`' standing, in the given order, off the indexes the mirror keeps per change: the
 *  HUD's people tallies and the finished buildings by owner. Costs the seats and their job kinds,
 *  never the entity list. */
export function seatStandings(
  snapshot: WorldSnapshot,
  seats: readonly number[],
  outcomeOf: (player: number) => MatchOutcome,
): SeatStanding[] {
  const buildingsByOwner = indexesOf(snapshot).get(FINISHED_BUILDINGS_BY_OWNER);
  return seats.map((player) => {
    const people = summaryPopulation(hudPeopleOf(snapshot, player));
    const buildings = buildingsByOwner.get(player) ?? 0;
    return { player, people, buildings, status: statusOf(outcomeOf(player), people, buildings) };
  });
}
