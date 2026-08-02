import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MapsIndexEntry, MapsIndexPlayerSlot } from './wire.js';

/** Node-side builder for the `/maps-index` payload - the decoded-maps list the app menu renders. */

/** The sidecar's `[multiplayer]` lobby table, read tolerantly off the parsed JSON. */
interface ScriptMultiplayer {
  /** Slots whose `playeroption` row offers `human`. */
  readonly humanOptionSlots: ReadonlySet<number>;
  /** Slots whose `playeroption` row does NOT offer `ai` (Human/Closed-only seats). */
  readonly aiDeniedSlots: ReadonlySet<number>;
  readonly hiddenSlots: ReadonlySet<number>;
  readonly fixedColors: boolean;
}

const NO_MULTIPLAYER: ScriptMultiplayer = {
  humanOptionSlots: new Set(),
  aiDeniedSlots: new Set(),
  hiddenSlots: new Set(),
  fixedColors: false,
};

function multiplayerOf(raw: unknown): ScriptMultiplayer {
  if (typeof raw !== 'object' || raw === null) return NO_MULTIPLAYER;
  const { slotOptions, hiddenSlots, fixedColors } = raw as Record<string, unknown>;
  const humanOptionSlots = new Set<number>();
  const aiDeniedSlots = new Set<number>();
  if (Array.isArray(slotOptions)) {
    for (const opt of slotOptions) {
      if (typeof opt !== 'object' || opt === null) continue;
      const { player, allowed } = opt as Record<string, unknown>;
      if (typeof player !== 'number' || !Array.isArray(allowed)) continue;
      if (allowed.includes('human')) humanOptionSlots.add(player);
      if (!allowed.includes('ai')) aiDeniedSlots.add(player);
    }
  }
  const hidden = new Set<number>(
    Array.isArray(hiddenSlots) ? hiddenSlots.filter((s): s is number => typeof s === 'number') : [],
  );
  return { humanOptionSlots, aiDeniedSlots, hiddenSlots: hidden, fixedColors: fixedColors === true };
}

/** Structurally validates one roster row off a parsed script sidecar. No schema dep: the sidecar was
 *  zod-validated at pipeline emit, so this only guards the menu against a hand-edited file. */
function playerSlotOf(raw: unknown, multiplayer: ScriptMultiplayer): MapsIndexPlayerSlot | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { player, type, tribeId, colorId, name } = raw as Record<string, unknown>;
  if (typeof player !== 'number' || !Number.isInteger(player) || player < 0) return undefined;
  if (type !== 'human' && type !== 'ai') return undefined;
  if (typeof tribeId !== 'number' || typeof colorId !== 'number') return undefined;
  return {
    player,
    type,
    tribeId,
    colorId,
    ...(typeof name === 'string' ? { name } : {}),
    claimable: type === 'human' || multiplayer.humanOptionSlots.has(player),
    hidden: multiplayer.hiddenSlots.has(player),
    aiAllowed: !multiplayer.aiDeniedSlots.has(player),
  };
}

/** Parses `<id><suffix>`, or undefined when absent or unreadable (warned, never thrown). */
function readSidecar(mapsRoot: string, id: string, suffix: string): unknown {
  const file = join(mapsRoot, `${id}${suffix}`);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[content-resolver] maps-index: ${id}${suffix} unreadable: ${(err as Error).message}`);
    return undefined;
  }
}

/** Reads `<id>.meta.json`'s display strings; a wrong-typed field is dropped silently. */
function metaOf(mapsRoot: string, id: string): { readonly name?: string; readonly description?: string } {
  const parsed = readSidecar(mapsRoot, id, '.meta.json');
  if (parsed === undefined) return {};
  if (typeof parsed !== 'object' || parsed === null) {
    console.warn(`[content-resolver] maps-index: ${id}.meta.json is not an object; serving the bare id`);
    return {};
  }
  const meta = parsed as Record<string, unknown>;
  return {
    ...(typeof meta.name === 'string' ? { name: meta.name } : {}),
    ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
  };
}

/** Reads `<id>.script.json`'s roster (+ colour locking), or undefined when absent/malformed. */
function playersOf(
  mapsRoot: string,
  id: string,
): { readonly slots: readonly MapsIndexPlayerSlot[]; readonly fixedColors: boolean } | undefined {
  const parsed = readSidecar(mapsRoot, id, '.script.json');
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { players, multiplayer } = parsed as Record<string, unknown>;
  if (!Array.isArray(players)) return undefined;
  const mp = multiplayerOf(multiplayer);
  const slots = players.map((p) => playerSlotOf(p, mp)).filter((s) => s !== undefined);
  return slots.length > 0 ? { slots, fixedColors: mp.fixedColors } : undefined;
}

/**
 * Builds one entry per `content/maps/<id>.json` grid, sorted, joined with its optional sidecars -
 * the `.meta.json`/`.script.json` ones are not maps of their own and are filtered out. Tolerance is
 * per entry: one malformed sidecar degrades its own entry, never the list. `mapsRoot` must exist
 * (the caller guards).
 */
export function buildMapsIndexEntries(mapsRoot: string): MapsIndexEntry[] {
  return readdirSync(mapsRoot)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json') && !f.endsWith('.script.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort()
    .map((id) => {
      // Read in sidecar order (meta, then script) so a map with two bad sidecars warns in that order.
      const meta = metaOf(mapsRoot, id);
      const players = playersOf(mapsRoot, id);
      return {
        id,
        ...meta,
        minimap: existsSync(join(mapsRoot, `${id}.png`)),
        ...(players !== undefined ? { players: players.slots } : {}),
        ...(players?.fixedColors ? { fixedColors: true } : {}),
      };
    });
}
