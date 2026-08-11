import { type ReadableVfs, readText, vjoin } from '@open-northland/vfs';
import { byCodeUnit, fileNamesIn } from './dir-listing.js';
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

/** One maps directory: its listing is read once, so sidecar existence never costs a `stat`. */
interface MapsDir {
  readonly fs: ReadableVfs;
  readonly root: string;
  readonly names: ReadonlySet<string>;
}

/** Undefined when `<id><suffix>` is absent or unparsable; an unparsable sidecar warns, never throws. */
async function readSidecar(dir: MapsDir, id: string, suffix: string): Promise<unknown> {
  const name = `${id}${suffix}`;
  if (!dir.names.has(name)) return undefined;
  try {
    return JSON.parse(await readText(dir.fs, vjoin(dir.root, name)));
  } catch (err) {
    console.warn(`[content-resolver] maps-index: ${id}${suffix} unreadable: ${(err as Error).message}`);
    return undefined;
  }
}

/** Display strings from `<id>.meta.json`; a wrong-typed field is dropped without a warning. */
async function metaOf(
  dir: MapsDir,
  id: string,
): Promise<{ readonly name?: string; readonly description?: string }> {
  const parsed = await readSidecar(dir, id, '.meta.json');
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
  dir: MapsDir,
  id: string,
): Promise<
  | {
      readonly slots: readonly MapsIndexPlayerSlot[];
      readonly fixedColors: boolean;
      readonly multiplayer: boolean;
    }
  | undefined
> {
  const parsed = await readSidecar(dir, id, '.script.json');
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
export async function buildMapsIndexEntries(fs: ReadableVfs, mapsRoot: string): Promise<MapsIndexEntry[]> {
  const dir: MapsDir = { fs, root: mapsRoot, names: await fileNamesIn(fs, mapsRoot) };
  const ids = [...dir.names]
    .filter(
      (name) => name.endsWith('.json') && !name.endsWith('.meta.json') && !name.endsWith('.script.json'),
    )
    .map((name) => name.slice(0, -'.json'.length))
    .sort(byCodeUnit);
  const entries: MapsIndexEntry[] = [];
  for (const id of ids) {
    const meta = await metaOf(dir, id);
    const players = await playersOf(dir, id);
    entries.push({
      id,
      ...meta,
      minimap: dir.names.has(`${id}.png`),
      ...(players !== undefined ? { players: players.slots } : {}),
      ...(players?.fixedColors ? { fixedColors: true } : {}),
      ...(players?.multiplayer ? { multiplayer: true } : {}),
    });
  }
  return entries;
}
