import {
  alliedPlayers,
  Building,
  diplomacyStance,
  isForeignHouse,
  isMachinePlayer,
  isMatchParticipant,
  MissionObjectId,
  matchParticipantBits,
  ownerOf,
  type TradeAgreement,
  type TradeRouteView,
  tradeAgreements,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';

/** One agreement a house offers, with its index in the map's table. */
export interface HouseAgreement {
  readonly index: number;
  readonly agreement: DeepReadonly<TradeAgreement>;
}

/**
 * Whether `house` is one a map's agreements can apply to: a standing house whose owner is no human
 * player. Reading: the original registers an agreement for every house but one of a player of the
 * `human player` type (its player-type names are `none`, `human player`, `ai player`), and the corpus
 * bears it out: most trade houses belong to ordinary computer seats. A seat outside the match is no
 * human player either, and a world with no match set up gates nothing. Approximation: an idle seat the
 * lobby left on the map is a participant without the marker, so it reads as human; no corpus trade
 * house stands on one.
 */
export function isTradingHouse(world: World, house: Entity): boolean {
  const building = world.tryGet(house, Building);
  if (building === undefined || building.built !== ONE) return false;
  const owner = ownerOf(world, house);
  if (matchParticipantBits(world) === 0 || owner === undefined) return true;
  return !isMatchParticipant(world, owner) || isMachinePlayer(world, owner);
}

/** The agreements `house` offers, in table order; empty for a house that trades on none. */
export function agreementsAt(world: World, house: Entity): HouseAgreement[] {
  const id = world.tryGet(house, MissionObjectId)?.id;
  if (id === undefined || !isTradingHouse(world, house)) return [];
  const offered: HouseAgreement[] = [];
  tradeAgreements(world).forEach((agreement, index) => {
    if (agreement.missionId === id) offered.push({ index, agreement });
  });
  return offered;
}

/** Whether the trader's player and `house`'s owner each hold `friend` toward the other. */
export function mutualFriends(world: World, trader: Entity, house: Entity): boolean {
  const player = ownerOf(world, trader);
  const partner = ownerOf(world, house);
  return player !== undefined && partner !== undefined && alliedPlayers(world, player, partner);
}

/**
 * The agreement the trader's route trades on, or undefined when its choice does not hold: no foreign
 * stop, an index off the table, an agreement of another house, or a partner the trader's player is
 * not on friendly terms with (original behavior: each trip needs only the trader's player to hold
 * `friend` toward the house owner). A route whose stops a map script's owner change left both foreign
 * has no house of the trader's own to trade from, and holds none.
 */
export function activeAgreement(
  world: World,
  trader: Entity,
  route: TradeRouteView,
): DeepReadonly<TradeAgreement> | undefined {
  const [stop, second] = route.stops.filter((s) => isForeignHouse(world, trader, s.house));
  if (stop === undefined || second !== undefined || route.agreement < 0) return undefined;
  const chosen = agreementsAt(world, stop.house).find((offer) => offer.index === route.agreement);
  if (chosen === undefined) return undefined;
  const player = ownerOf(world, trader);
  const partner = ownerOf(world, stop.house);
  if (player === undefined || partner === undefined) return undefined;
  return diplomacyStance(world, player, partner) === 'friend' ? chosen.agreement : undefined;
}
