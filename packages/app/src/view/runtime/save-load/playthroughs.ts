import { TICKS_PER_SECOND } from '@open-northland/sim';
import type { SaveSlotInfo } from './store.js';

const MS_PER_SECOND = 1000;

/** The saves of one game: one map played from one seed, newest save first. */
export interface Playthrough {
  readonly key: string;
  readonly mapId: string | null;
  /** Its place among the same map's games, earliest started first from 1; null when the map has one. */
  readonly ordinal: number | null;
  readonly slots: readonly SaveSlotInfo[];
  /** The game running now; a save list outside a game has none. */
  readonly current: boolean;
}

export interface RunningWorld {
  readonly mapId: string | null;
  readonly seed: number | null;
}

/** The key a game's saves share, and the key the renames of its settlers are kept under. */
export const playthroughKey = (mapId: string | null, seed: number | null): string =>
  `${mapId ?? ''}|${seed ?? ''}`;

const newest = (playthrough: { readonly slots: readonly SaveSlotInfo[] }): number =>
  playthrough.slots[0]?.savedAt ?? 0;
/** When the game began, estimated as each save's time less its game time: an approximation, as time
 *  spent paused counts as played, but one every save of the game agrees on closely, so overwriting or
 *  deleting saves never renumbers the games. */
const started = (playthrough: { readonly slots: readonly SaveSlotInfo[] }): number =>
  Math.min(
    ...playthrough.slots.map(
      (slot) => (slot.savedAt ?? 0) - ((slot.tick ?? 0) / TICKS_PER_SECOND) * MS_PER_SECOND,
    ),
  );

/** Group newest-first slots by playthrough: the running game first, then by its newest save. */
export function playthroughsOf(slots: readonly SaveSlotInfo[], running: RunningWorld | null): Playthrough[] {
  const byKey = new Map<string, { mapId: string | null; slots: SaveSlotInfo[] }>();
  for (const slot of slots) {
    const key = playthroughKey(slot.mapId, slot.seed);
    const group = byKey.get(key);
    if (group === undefined) byKey.set(key, { mapId: slot.mapId, slots: [slot] });
    else group.slots.push(slot);
  }
  const perMap = new Map<string | null, { key: string; slots: SaveSlotInfo[] }[]>();
  for (const [key, group] of byKey) {
    const siblings = perMap.get(group.mapId) ?? [];
    siblings.push({ key, slots: group.slots });
    perMap.set(group.mapId, siblings);
  }
  const ordinals = new Map<string, number>();
  for (const siblings of perMap.values()) {
    if (siblings.length < 2) continue;
    const byAge = [...siblings].sort((a, b) => started(a) - started(b));
    for (const [i, group] of byAge.entries()) ordinals.set(group.key, i + 1);
  }
  const runningKey =
    running !== null && running.seed !== null ? playthroughKey(running.mapId, running.seed) : null;
  const playthroughs = [...byKey].map(
    ([key, group]): Playthrough => ({
      key,
      mapId: group.mapId,
      ordinal: ordinals.get(key) ?? null,
      slots: group.slots,
      current: key === runningKey,
    }),
  );
  return playthroughs.sort((a, b) => Number(b.current) - Number(a.current) || newest(b) - newest(a));
}
