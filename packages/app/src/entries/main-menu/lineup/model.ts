import {
  isMultiplayerMapType,
  type MapSeatRelation,
  type MapSeatStance,
  type MapsIndexPlayerSlot,
} from '@open-northland/data';
import type { MapSelectItem } from '../map-select/model.js';

/**
 * How a map lines its seats up at the start, read off its relations for the lobby. The seats a person
 * may take decide the format; the map's own seats then join the side they stand with, or a group named
 * by how they stand toward every such seat.
 */

/** How the seats a person may take stand toward each other at the start. */
export type LineupFormat = 'teams' | 'free-for-all' | 'allied' | 'neutral' | 'mixed';

/** `team` is one of several teams; `sides` holds a format's seats when it has no teams. The rest hold
 *  seats outside them by their stance toward every seat of the format. */
export type LineupGroupKind = 'team' | 'sides' | 'neutral' | 'allies' | 'enemies' | 'others';

export interface LineupGroup {
  readonly kind: LineupGroupKind;
  /** In roster order. */
  readonly players: readonly number[];
}

export interface MapLineup {
  readonly format: LineupFormat;
  /** How many seats a person may take on each side: per team, one per seat in a free-for-all, else
   *  all of them as one. */
  readonly sides: readonly number[];
  /** Every listed seat once, in the order the roster shows them. */
  readonly groups: readonly LineupGroup[];
}

/** Fewer seats a person may take leave nobody to line up against. */
const MIN_CONTENDERS = 2;

const REST_ORDER: readonly LineupGroupKind[] = ['neutral', 'allies', 'enemies', 'others'];
const UNIFORM_REST: Readonly<Record<MapSeatStance, LineupGroupKind>> = {
  neutral: 'neutral',
  ally: 'allies',
  enemy: 'enemies',
};

export type StanceReader = (a: number, b: number) => MapSeatStance;

export function seatStanceReader(relations: readonly MapSeatRelation[]): StanceReader {
  const byPair = new Map(relations.map((row) => [pairKey(row.a, row.b), row.stance]));
  return (a, b) => byPair.get(pairKey(a, b)) ?? 'neutral';
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** The lineup of the listed seats; null when fewer than two of them are open to a person. */
export function mapLineup(
  slots: readonly MapsIndexPlayerSlot[],
  relations: readonly MapSeatRelation[],
): MapLineup | null {
  const listed = slots.filter((slot) => !slot.hidden);
  const contenders = listed.filter((slot) => slot.claimable).map((slot) => slot.player);
  if (contenders.length < MIN_CONTENDERS) return null;
  const stance = seatStanceReader(relations);
  const side = sidesOf(contenders, stance);
  const groups = side.groups.map((players) => [...players]);
  // A bystander stands outside the format, so a map seat is read against the seats that make it.
  const fighting = side.groups.flat();
  const rest = new Map<LineupGroupKind, number[]>([['neutral', [...side.bystanders]]]);
  for (const slot of listed) {
    if (slot.claimable) continue;
    const toward = fighting.map((other) => stance(slot.player, other));
    const joined = groups.find((group) => joinsSide(side.format, groups, group, slot.player, stance));
    if (joined !== undefined) {
      joined.push(slot.player);
      continue;
    }
    const first = toward[0] ?? 'neutral';
    const kind = toward.every((each) => each === first) ? UNIFORM_REST[first] : 'others';
    rest.set(kind, [...(rest.get(kind) ?? []), slot.player]);
  }
  const order = new Map(listed.map((slot, index) => [slot.player, index]));
  const inRosterOrder = (players: readonly number[]): number[] =>
    [...players].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const groupKind: LineupGroupKind = side.format === 'teams' ? 'team' : 'sides';
  return {
    format: side.format,
    sides: side.sides,
    groups: [
      ...groups.map((players) => ({ kind: groupKind, players: inRosterOrder(players) })),
      ...REST_ORDER.flatMap((kind) => {
        const players = rest.get(kind) ?? [];
        return players.length === 0 ? [] : [{ kind, players: inRosterOrder(players) }];
      }),
    ],
  };
}

interface Sides {
  readonly format: LineupFormat;
  readonly sides: readonly number[];
  readonly groups: readonly (readonly number[])[];
  /** Seats a person may take that stand neutral toward every other such seat, outside the format. */
  readonly bystanders: readonly number[];
}

function sidesOf(contenders: readonly number[], stance: StanceReader): Sides {
  const neutralToAll = (seat: number): boolean =>
    contenders.every((other) => other === seat || stance(seat, other) === 'neutral');
  if (contenders.every(neutralToAll))
    return { format: 'neutral', sides: [contenders.length], groups: [contenders], bystanders: [] };
  const bystanders = contenders.filter(neutralToAll);
  const fighting = contenders.filter((seat) => !neutralToAll(seat));
  const teams = alliances(fighting, stance);
  const mixed = { format: 'mixed', sides: [fighting.length], groups: [fighting], bystanders } as const;
  if (teams === null) return mixed;
  if (teams.length === 1) return { format: 'allied', sides: [fighting.length], groups: teams, bystanders };
  const atWar = teams.every((team, index) =>
    teams.slice(index + 1).every((other) => team.every((a) => other.every((b) => stance(a, b) === 'enemy'))),
  );
  if (!atWar) return mixed;
  const sides = teams.map((team) => team.length);
  // Seats that each stand alone make one free-for-all, shown together.
  if (teams.every((team) => team.length === 1))
    return { format: 'free-for-all', sides, groups: [fighting], bystanders };
  return { format: 'teams', sides, groups: teams, bystanders };
}

/** The seats split by alliance; null when an alliance is not whole, one seat allied to two that are not. */
function alliances(seats: readonly number[], stance: StanceReader): number[][] | null {
  const teams: number[][] = [];
  for (const seat of seats) {
    const team = teams.find((members) => members.some((member) => stance(seat, member) === 'ally'));
    if (team === undefined) teams.push([seat]);
    else if (team.every((member) => stance(seat, member) === 'ally')) team.push(seat);
    else return null;
  }
  const crossAlly = teams.some((team, index) =>
    teams.slice(index + 1).some((other) => team.some((a) => other.some((b) => stance(a, b) === 'ally'))),
  );
  return crossAlly ? null : teams;
}

/** How the seats of one group stand toward each other in each format a map seat can join. */
const WITHIN_GROUP: Readonly<Record<Exclude<LineupFormat, 'mixed'>, MapSeatStance>> = {
  teams: 'ally',
  allied: 'ally',
  'free-for-all': 'enemy',
  neutral: 'neutral',
};

/** A map seat that stands toward every seat already grouped, map seats that joined before it included,
 *  as a member of `group` does: the format's own stance within it, enemy across teams. */
function joinsSide(
  format: LineupFormat,
  groups: readonly (readonly number[])[],
  group: readonly number[],
  seat: number,
  stance: StanceReader,
): boolean {
  if (format === 'mixed') return false;
  const within = WITHIN_GROUP[format];
  return groups.every((other) =>
    other.every((member) => stance(seat, member) === (other === group ? within : 'enemy')),
  );
}

/** A multiplayer map's lineup over `players`, its roster as the chosen variant offers it. A
 *  single-player map is played by one person against its script, so it has none. */
export function mapItemLineup(
  item: MapSelectItem,
  players: readonly MapsIndexPlayerSlot[] = item.players,
): MapLineup | null {
  return isMultiplayerMapType(item.types) ? mapLineup(players, item.relations) : null;
}

/** Whether a group's title leaves its seats' relations unsaid, so each row lists its own. */
export function listsOwnRelations(lineup: MapLineup, group: LineupGroup): boolean {
  return group.kind === 'others' || (lineup.format === 'mixed' && group.kind === 'sides');
}
