import type { DeepReadonly, World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import type { HalfCellNode } from '../nav/halfcell.js';
import { isValidPlayer, MAX_PLAYERS } from './ownership.js';

/** Lines per player on the on-screen info display (reading). */
export const INFO_LINES_PER_PLAYER = 5;
/** The player argument that writes every player's line at once; the corpus writes both spellings. */
const BROADCAST_PLAYERS = [20, -1];

/** How a line's `%d` is filled: a plain string prints a zero, the counting kinds a live tally within
 *  `range` of `point`, and every kind prints the line's `extra` into a second `%d`. */
export type InfoLineKind = 'text' | 'goods' | 'houses' | 'humans' | 'soldiers' | 'animals';

export interface InfoLine {
  kind: InfoLineKind;
  /** The text's id in the map's own string table. */
  stringId: number;
  /** The good, house type or animal tribe the counting kinds tally; 0 for the rest. */
  target: number;
  point: HalfCellNode;
  range: number;
  extra: number;
}

const infoLines = defineWorldSingleton<{ lines: Map<number, InfoLine> }>('InfoLines', () => ({
  lines: new Map(),
}));

/** Keyed by {@link infoLineKey}; only a line some `Info*` result set is present. */
export const InfoLines = infoLines.component;

export function isInfoLineIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < INFO_LINES_PER_PLAYER;
}

export function infoLineKey(player: number, index: number): number {
  return player * INFO_LINES_PER_PLAYER + index;
}

/** The players a script's `player` argument addresses: one, or all of them for a broadcast. */
export function infoLinePlayers(player: number): number[] {
  if (BROADCAST_PLAYERS.includes(player)) return Array.from({ length: MAX_PLAYERS }, (_, p) => p);
  return isValidPlayer(player) ? [player] : [];
}

export function setInfoLine(world: World, player: number, index: number, line: InfoLine): void {
  infoLines.write(world, (table) => {
    table.lines.set(infoLineKey(player, index), { ...line, point: { ...line.point } });
  });
}

export function clearInfoLine(world: World, player: number, index: number): void {
  const key = infoLineKey(player, index);
  if (!infoLines.read(world).lines.has(key)) return;
  infoLines.write(world, (table) => {
    table.lines.delete(key);
  });
}

/** The lines set for `player`, ascending by line index. */
export function infoLinesOf(world: World, player: number): { index: number; line: DeepReadonly<InfoLine> }[] {
  const out: { index: number; line: DeepReadonly<InfoLine> }[] = [];
  const table = infoLines.read(world).lines;
  for (let index = 0; index < INFO_LINES_PER_PLAYER; index++) {
    const line = table.get(infoLineKey(player, index));
    if (line !== undefined) out.push({ index, line });
  }
  return out;
}
