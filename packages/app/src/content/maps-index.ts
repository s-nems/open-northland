import type { MapsIndexEntry, MapsIndexPlayerSlot } from '@open-northland/content-resolver/wire';
import { fetchJsonOrNull } from './net.js';

/** The `/maps-index` fetch + narrowing both menus share: the served payload is untrusted at the
 *  route boundary, so every row is structurally re-validated before a menu renders it. */

/** Narrows one `/maps-index` roster row, mirroring the emit-side shape (wrong-typed rows drop).
 *  The lobby fields default to the no-`[multiplayer]`-table reading (claimable follows the
 *  authored type, nothing hidden, AI allowed) for a sidecar predating them. */
function parsePlayerSlot(raw: unknown): MapsIndexPlayerSlot | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { player, type, tribeId, colorId, name, claimable, hidden, aiAllowed } = raw as Record<
    string,
    unknown
  >;
  if (typeof player !== 'number' || !Number.isInteger(player) || player < 0) return undefined;
  if (type !== 'human' && type !== 'ai') return undefined;
  if (typeof tribeId !== 'number' || typeof colorId !== 'number') return undefined;
  return {
    player,
    type,
    tribeId,
    colorId,
    ...(typeof name === 'string' ? { name } : {}),
    claimable: typeof claimable === 'boolean' ? claimable : type === 'human',
    hidden: hidden === true,
    aiAllowed: aiAllowed !== false,
  };
}

export function parseMapsIndex(data: unknown): readonly MapsIndexEntry[] {
  if (!Array.isArray(data)) return [];
  const entries: MapsIndexEntry[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, name, description, minimap, players, fixedColors, multiplayer } = item as Record<
      string,
      unknown
    >;
    if (typeof id !== 'string' || id === '') continue;
    const slots = Array.isArray(players) ? players.map(parsePlayerSlot).filter((s) => s !== undefined) : [];
    entries.push({
      id,
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof description === 'string' ? { description } : {}),
      minimap: minimap === true,
      ...(slots.length > 0 ? { players: slots } : {}),
      ...(fixedColors === true ? { fixedColors: true } : {}),
      ...(multiplayer === true ? { multiplayer: true } : {}),
    });
  }
  return entries;
}

export async function loadMapList(): Promise<readonly MapsIndexEntry[]> {
  return parseMapsIndex(await fetchJsonOrNull<unknown>('/maps-index'));
}
