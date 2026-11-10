import type { MapSeatStance } from '@open-northland/data';
import { playerSwatchHex } from '../../../catalog/roster.js';
import { GLYPH } from '../../../hud/dom/icons.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import {
  type LineupGroup,
  type LineupGroupKind,
  listsOwnRelations,
  type MapLineup,
  type StanceReader,
} from './model.js';

/** Two sides of one seat each read as a duel, `1 vs 1`, rather than a free-for-all. */
const DUEL_SIDES = 2;

/** The lineup in a few words: `3 vs 3`, `free for all`, `all allied`. */
export function lineupLabel(lineup: MapLineup): string {
  const copy = messages().mainMenu.lineup;
  switch (lineup.format) {
    case 'teams':
      return lineup.sides.join(copy.sideSeparator);
    case 'free-for-all':
      return lineup.sides.length === DUEL_SIDES ? lineup.sides.join(copy.sideSeparator) : copy.freeForAll;
    case 'allied':
      return copy.allied;
    case 'neutral':
      return copy.neutral;
    case 'mixed':
      return copy.mixed;
  }
}

/** One step of a roster laid out by lineup: a group's title, or a seat with whether its row lists
 *  its own relations. */
export type LineupRosterPart =
  | { readonly kind: 'title'; readonly group: LineupGroupKind; readonly text: string }
  | { readonly kind: 'seat'; readonly player: number; readonly ownRelations: boolean };

/** The roster's seats in lineup order. Groups are titled only when there are two or more; without a
 *  lineup the listed seats keep their order. */
export function lineupRoster(lineup: MapLineup | null, listed: readonly number[]): LineupRosterPart[] {
  if (lineup === null) return listed.map((player) => ({ kind: 'seat', player, ownRelations: false }));
  const titled = lineup.groups.length > 1;
  let team = 0;
  return lineup.groups.flatMap((group): LineupRosterPart[] => {
    const text = groupTitle(lineup, group, group.kind === 'team' ? team++ : 0);
    const ownRelations = listsOwnRelations(lineup, group);
    return [
      ...(titled ? [{ kind: 'title', group: group.kind, text } as const] : []),
      ...group.players.map((player) => ({ kind: 'seat', player, ownRelations }) as const),
    ];
  });
}

function groupTitle(lineup: MapLineup, group: LineupGroup, team: number): string {
  const copy = messages().mainMenu.lineup;
  switch (group.kind) {
    case 'team':
      return formatMessage(copy.team, { n: team + 1 });
    case 'sides':
      return lineupLabel(lineup);
    case 'neutral':
    case 'allies':
    case 'enemies':
    case 'others':
      return copy.groups[group.kind];
  }
}

/** The in-game diplomacy window's mark for each stance. */
const STANCE_GLYPH: Readonly<Record<MapSeatStance, string>> = {
  ally: GLYPH.shield,
  neutral: GLYPH.banner,
  enemy: GLYPH.swords,
};

/** A group the title alone describes by a stance carries that stance's mark. */
const GROUP_STANCE: Partial<Readonly<Record<LineupGroupKind, MapSeatStance>>> = {
  neutral: 'neutral',
  allies: 'ally',
  enemies: 'enemy',
};

/** `className` restyles the title for a roster with its own look. */
export function lineupTitle(part: Extract<LineupRosterPart, { kind: 'title' }>, className?: string) {
  const title = document.createElement('div');
  title.className = className === undefined ? 'lineup-title' : `lineup-title ${className}`;
  title.dataset.group = part.group;
  const stance = GROUP_STANCE[part.group];
  if (stance !== undefined) {
    title.dataset.stance = stance;
    title.insertAdjacentHTML('afterbegin', STANCE_GLYPH[stance]);
  }
  title.append(document.createTextNode(part.text));
  return title;
}

const RELATION_ORDER: readonly MapSeatStance[] = ['ally', 'enemy', 'neutral'];

/** A listed seat and the colour the roster shows it in. */
export interface RosterSeat {
  readonly player: number;
  readonly color: number;
}

/**
 * `player`'s stance toward each other listed seat, by stance: the seats as the numbered colour blocks
 * the roster shows. Empty stances are left out.
 */
export function relationLine(
  player: number,
  listed: readonly RosterSeat[],
  stance: StanceReader,
): HTMLElement {
  const copy = messages().mainMenu.lineup.relations;
  const line = document.createElement('span');
  line.className = 'lineup-relations';
  for (const kind of RELATION_ORDER) {
    const seats = listed.filter((other) => other.player !== player && stance(player, other.player) === kind);
    if (seats.length === 0) continue;
    const part = document.createElement('span');
    part.className = 'lineup-relations__part';
    part.dataset.stance = kind;
    const label = `${copy[kind]}: ${seats.map((seat) => seat.player + 1).join(', ')}`;
    part.title = label;
    part.setAttribute('aria-label', label);
    part.setAttribute('role', 'img');
    part.insertAdjacentHTML('afterbegin', STANCE_GLYPH[kind]);
    for (const seat of seats) {
      const chip = document.createElement('span');
      chip.className = 'lineup-relations__seat';
      chip.style.background = playerSwatchHex(seat.color);
      chip.textContent = String(seat.player + 1);
      part.append(chip);
    }
    line.append(part);
  }
  return line;
}
