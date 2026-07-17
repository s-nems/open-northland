import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Node-side builder for the `/maps-index` payload — the decoded-maps list the app menu renders. */

/** One map player slot as the menu needs it, lifted from the `<id>.script.json` sidecar's roster. */
export interface MapsIndexPlayerSlot {
  /** 0-based player slot id. */
  readonly player: number;
  /** Whether a person may take this slot (`human`) or it is script-driven (`ai`). */
  readonly type: 'human' | 'ai';
  /** `TRIBE_TYPE_HUMAN_*` code (1 viking … 7 egypt). */
  readonly tribeId: number;
  /** `PLAYER_COLOR_ID_*` code (0 blue … 9 black) — the slot's authored team colour. */
  readonly colorId: number;
  /** The slot's authored display name, when the map ships one. */
  readonly name?: string;
}

/** One `/maps-index` entry: a decoded map's stem id + the pipeline's optional menu sidecars. */
export interface MapsIndexEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  /** Whether `/maps/<id>.png` (the decoded minimap thumbnail) exists. */
  readonly minimap: boolean;
  /** The map's player roster (absent when the map ships no decodable `playerdata`). */
  readonly players?: readonly MapsIndexPlayerSlot[];
}

/** Structurally validates one roster row off a parsed script sidecar (no schema dep here — the
 *  sidecar was zod-validated at pipeline emit; this guards the menu against a hand-edited file). */
function playerSlotOf(raw: unknown): MapsIndexPlayerSlot | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { player, type, tribeId, colorId, name } = raw as Record<string, unknown>;
  if (typeof player !== 'number' || !Number.isInteger(player) || player < 0) return undefined;
  if (type !== 'human' && type !== 'ai') return undefined;
  if (typeof tribeId !== 'number' || typeof colorId !== 'number') return undefined;
  return { player, type, tribeId, colorId, ...(typeof name === 'string' ? { name } : {}) };
}

/** Reads `<id>.script.json`'s roster, or undefined when absent/malformed (warned, never thrown). */
function playersOf(mapsRoot: string, id: string): readonly MapsIndexPlayerSlot[] | undefined {
  const scriptPath = join(mapsRoot, `${id}.script.json`);
  if (!existsSync(scriptPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(scriptPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { players } = parsed as Record<string, unknown>;
    if (!Array.isArray(players)) return undefined;
    const slots = players.map(playerSlotOf).filter((s) => s !== undefined);
    return slots.length > 0 ? slots : undefined;
  } catch (err) {
    console.warn(`[content-routes] maps-index: ${id}.script.json unreadable: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Builds one entry per `content/maps/<id>.json` grid (sorted; the `.meta.json`/`.script.json`
 * sidecars are NOT maps and are filtered out), each joined with its `<id>.meta.json` display
 * strings, an `<id>.png` existence flag, and its `<id>.script.json` player roster. Per-entry
 * tolerant: a missing sidecar is normal; a malformed one (unreadable, non-object like `null`,
 * wrong-typed fields) degrades that entry with a warning — one bad sidecar must never 500 the
 * whole list. `mapsRoot` must exist (the caller guards).
 */
export function buildMapsIndexEntries(mapsRoot: string): MapsIndexEntry[] {
  return readdirSync(mapsRoot)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json') && !f.endsWith('.script.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort()
    .map((id) => {
      let name: string | undefined;
      let description: string | undefined;
      const metaPath = join(mapsRoot, `${id}.meta.json`);
      if (existsSync(metaPath)) {
        try {
          const parsed: unknown = JSON.parse(readFileSync(metaPath, 'utf8'));
          if (typeof parsed === 'object' && parsed !== null) {
            const meta = parsed as Record<string, unknown>;
            if (typeof meta.name === 'string') name = meta.name;
            if (typeof meta.description === 'string') description = meta.description;
          } else {
            console.warn(
              `[content-routes] maps-index: ${id}.meta.json is not an object; serving the bare id`,
            );
          }
        } catch (err) {
          console.warn(`[content-routes] maps-index: ${id}.meta.json unreadable: ${(err as Error).message}`);
        }
      }
      const players = playersOf(mapsRoot, id);
      return {
        id,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        minimap: existsSync(join(mapsRoot, `${id}.png`)),
        ...(players !== undefined ? { players } : {}),
      };
    });
}
