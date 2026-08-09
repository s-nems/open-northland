import { readText, type Vfs, vjoin } from '@open-northland/vfs';
import type { MapsIndexEntry, MapsIndexPlayerSlot } from './wire.js';

/** The sidecar's `[multiplayer]` lobby table, read tolerantly off the parsed JSON. */
interface ScriptMultiplayer {
  /** Slots whose `playeroption` row offers `human`. */
  readonly humanOptionSlots: ReadonlySet<number>;
  /** Slots whose `playeroption` row omits `ai` (Human/Closed-only seats). */
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

/** Guards the menu against a hand-edited roster row; the pipeline zod-validates what it emits. */
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

/** Undefined when `<id><suffix>` is absent or unparsable; an unparsable sidecar warns, never throws. */
async function readSidecar(fs: Vfs, mapsRoot: string, id: string, suffix: string): Promise<unknown> {
  const file = vjoin(mapsRoot, `${id}${suffix}`);
  if ((await fs.stat(file))?.kind !== 'file') return undefined;
  try {
    return JSON.parse(await readText(fs, file));
  } catch (err) {
    console.warn(`[content-resolver] maps-index: ${id}${suffix} unreadable: ${(err as Error).message}`);
    return undefined;
  }
}

/** Display strings from `<id>.meta.json`; a wrong-typed field is dropped without a warning. */
async function metaOf(
  fs: Vfs,
  mapsRoot: string,
  id: string,
): Promise<{ readonly name?: string; readonly description?: string }> {
  const parsed = await readSidecar(fs, mapsRoot, id, '.meta.json');
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

/** Undefined when `<id>.script.json` is absent, malformed, or carries no readable slot. */
async function playersOf(
  fs: Vfs,
  mapsRoot: string,
  id: string,
): Promise<
  | {
      readonly slots: readonly MapsIndexPlayerSlot[];
      readonly fixedColors: boolean;
      readonly multiplayer: boolean;
    }
  | undefined
> {
  const parsed = await readSidecar(fs, mapsRoot, id, '.script.json');
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { players, multiplayer } = parsed as Record<string, unknown>;
  if (!Array.isArray(players)) return undefined;
  const mp = multiplayerOf(multiplayer);
  const slots = players.map((p) => playerSlotOf(p, mp)).filter((s) => s !== undefined);
  return slots.length > 0
    ? {
        slots,
        fixedColors: mp.fixedColors,
        multiplayer: typeof multiplayer === 'object' && multiplayer !== null,
      }
    : undefined;
}

/**
 * One entry per `content/maps/<id>.json` grid, joined with its optional sidecars. Tolerance is per
 * entry: one malformed sidecar degrades its own entry, never the list. `mapsRoot` must exist - the
 * caller guards.
 */
export async function buildMapsIndexEntries(fs: Vfs, mapsRoot: string): Promise<MapsIndexEntry[]> {
  const ids = (await fs.readdir(mapsRoot))
    .filter(
      (e) =>
        e.kind === 'file' &&
        e.name.endsWith('.json') &&
        !e.name.endsWith('.meta.json') &&
        !e.name.endsWith('.script.json'),
    )
    .map((e) => e.name.slice(0, -'.json'.length))
    .sort();
  const entries: MapsIndexEntry[] = [];
  for (const id of ids) {
    const meta = await metaOf(fs, mapsRoot, id);
    const players = await playersOf(fs, mapsRoot, id);
    entries.push({
      id,
      ...meta,
      minimap: (await fs.stat(vjoin(mapsRoot, `${id}.png`)))?.kind === 'file',
      ...(players !== undefined ? { players: players.slots } : {}),
      ...(players?.fixedColors ? { fixedColors: true } : {}),
      ...(players?.multiplayer ? { multiplayer: true } : {}),
    });
  }
  return entries;
}
