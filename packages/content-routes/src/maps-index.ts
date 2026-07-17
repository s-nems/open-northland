import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Node-side builder for the `/maps-index` payload — the decoded-maps list the app menu renders. */

/** One map player slot as the menu needs it, lifted from the `<id>.script.json` sidecar's roster. */
export interface MapsIndexPlayerSlot {
  /** 0-based player slot id. */
  readonly player: number;
  /** The slot's authored `playerdata` type: `human` or script-driven `ai`. */
  readonly type: 'human' | 'ai';
  /** `TRIBE_TYPE_HUMAN_*` code (1 viking … 7 egypt). */
  readonly tribeId: number;
  /** `PLAYER_COLOR_ID_*` code (0 blue … 9 black) — the slot's authored team colour. */
  readonly colorId: number;
  /** The slot's authored display name, when the map ships one. */
  readonly name?: string;
  /**
   * Whether a person may take this seat: the authored type is `human`, or the map's
   * `[multiplayer]` `playeroption` row offers `human` for the slot (the original lobby's
   * seat-eligibility table — how the packed multiplayer specials open their authored-`ai` slots).
   */
  readonly claimable: boolean;
  /** `[multiplayer]` `playerhideinmenu` — the original lobby never lists this slot. */
  readonly hidden: boolean;
  /** Whether the seat may auto-play when vacant: its `playeroption` row offers `ai`, or the map
   *  ships no row for it (45 corpus rows are Human/Closed-only — no AI offer). */
  readonly aiAllowed: boolean;
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
  /** `[multiplayer]` `playerfixcolors` — the map locks its authored team colours. */
  readonly fixedColors?: boolean;
}

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

/** Structurally validates one roster row off a parsed script sidecar (no schema dep here — the
 *  sidecar was zod-validated at pipeline emit; this guards the menu against a hand-edited file). */
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
    console.warn(`[content-routes] maps-index: ${id}${suffix} unreadable: ${(err as Error).message}`);
    return undefined;
  }
}

/** Reads `<id>.meta.json`'s display strings; a wrong-typed field is dropped silently. */
function metaOf(mapsRoot: string, id: string): { name?: string; description?: string } {
  const parsed = readSidecar(mapsRoot, id, '.meta.json');
  if (parsed === undefined) return {};
  if (typeof parsed !== 'object' || parsed === null) {
    console.warn(`[content-routes] maps-index: ${id}.meta.json is not an object; serving the bare id`);
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
      const players = playersOf(mapsRoot, id);
      return {
        id,
        ...metaOf(mapsRoot, id),
        minimap: existsSync(join(mapsRoot, `${id}.png`)),
        ...(players !== undefined ? { players: players.slots } : {}),
        ...(players?.fixedColors ? { fixedColors: true } : {}),
      };
    });
}
