import { type ReadableVfs, readText, vjoin } from '@open-northland/vfs';
import { byCodeUnit, fileNamesIn } from './dir-listing.js';
import type { MapsIndexEntry, MapsIndexPlayerSlot, MapsIndexProvenance } from './wire.js';

/** The `PLAYER_TYPE_*` values a `playeroption` row may offer, as the sidecar spells them. */
const PLAYER_OPTIONS = ['human', 'ai', 'none'] as const;
// PLAYER_COLOR_ID_MAXIMUM in logicdefines.inc, shared by the sidecar schema.
const PLAYER_COLOR_COUNT = 10;

/** The sidecar's `[multiplayer]` lobby table, narrowed off the parsed JSON. */
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

/**
 * Undefined when the sidecar carries a `[multiplayer]` table this cannot read: seat eligibility lives
 * only there, so reading a malformed one as "absent" would quietly close seats the map opens.
 */
function multiplayerOf(raw: unknown): ScriptMultiplayer | undefined {
  if (raw === undefined) return NO_MULTIPLAYER;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const { slotOptions, hiddenSlots, fixedColors } = raw as Record<string, unknown>;
  if (fixedColors !== undefined && typeof fixedColors !== 'boolean') return undefined;
  const humanOptionSlots = new Set<number>();
  const aiDeniedSlots = new Set<number>();
  const hidden = new Set<number>();
  if (slotOptions !== undefined) {
    if (!Array.isArray(slotOptions)) return undefined;
    for (const opt of slotOptions) {
      if (typeof opt !== 'object' || opt === null) return undefined;
      const { player, allowed } = opt as Record<string, unknown>;
      if (!isNonnegativeInteger(player) || !Array.isArray(allowed)) return undefined;
      // A row whose values this cannot read decides seats by accident: an unrecognized `allowed`
      // entry reads as neither human nor ai, which closes the seat and denies the AI at once.
      if (!allowed.every((value) => PLAYER_OPTIONS.some((option) => option === value))) return undefined;
      if (allowed.includes('human')) humanOptionSlots.add(player);
      if (!allowed.includes('ai')) aiDeniedSlots.add(player);
    }
  }
  if (hiddenSlots !== undefined) {
    if (!Array.isArray(hiddenSlots) || !hiddenSlots.every(isNonnegativeInteger)) {
      return undefined;
    }
    for (const slot of hiddenSlots) hidden.add(slot);
  }
  return { humanOptionSlots, aiDeniedSlots, hiddenSlots: hidden, fixedColors: fixedColors === true };
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Guards the menu against a hand-edited roster row; the pipeline validates what it emits. */
function playerSlotOf(raw: unknown, multiplayer: ScriptMultiplayer): MapsIndexPlayerSlot | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const { player, type, tribeId, colorId, name } = raw as Record<string, unknown>;
  if (!isNonnegativeInteger(player)) return undefined;
  if (type !== 'human' && type !== 'ai') return undefined;
  if (!isNonnegativeInteger(tribeId) || tribeId === 0) return undefined;
  if (!isNonnegativeInteger(colorId) || colorId >= PLAYER_COLOR_COUNT) return undefined;
  if (name !== undefined && typeof name !== 'string') return undefined;
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

/** Mirrors the strict data MapProvenance schema at this untrusted wire boundary. */
function provenanceOf(raw: unknown): MapsIndexProvenance | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const { kind, folder, layer } = raw as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== 'kind' && key !== 'folder' && key !== 'layer')) return undefined;
  if (kind !== 'base' && kind !== 'mod' && kind !== 'user' && kind !== 'unknown') return undefined;
  if (layer !== 'game' && layer !== 'mod' && layer !== 'archive') return undefined;
  if (
    typeof folder !== 'string' ||
    folder.length === 0 ||
    folder.startsWith('/') ||
    folder.includes('\\') ||
    folder.includes(':') ||
    folder.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    return undefined;
  return { kind, folder, layer };
}

/** Optional metadata from `<id>.meta.json`; malformed fields are dropped. */
async function metaOf(
  dir: MapsDir,
  id: string,
): Promise<Pick<MapsIndexEntry, 'name' | 'description' | 'provenance' | 'mapTypes' | 'multiplayerOnly'>> {
  const parsed = await readSidecar(dir, id, '.meta.json');
  if (parsed === undefined) return {};
  if (typeof parsed !== 'object' || parsed === null) {
    console.warn(`[content-resolver] maps-index: ${id}.meta.json is not an object; serving the bare id`);
    return {};
  }
  const meta = parsed as Record<string, unknown>;
  const provenance = provenanceOf(meta.provenance);
  const mapTypes = Array.isArray(meta.mapTypes)
    ? meta.mapTypes.filter((code): code is number => Number.isInteger(code))
    : undefined;
  return {
    ...(provenance === undefined ? {} : { provenance }),
    ...(typeof meta.name === 'string' ? { name: meta.name } : {}),
    ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
    ...(mapTypes === undefined ? {} : { mapTypes }),
    ...(meta.multiplayerOnly === true ? { multiplayerOnly: true } : {}),
  };
}

/** Undefined when `<id>.script.json` is absent or carries no slot. A sidecar that is present but
 *  unreadable warns and serves no roster: a partial one would misreport which seats a map offers. */
async function playersOf(
  dir: MapsDir,
  id: string,
): Promise<{ readonly slots: readonly MapsIndexPlayerSlot[]; readonly fixedColors: boolean } | undefined> {
  const parsed = await readSidecar(dir, id, '.script.json');
  if (parsed === undefined) return undefined;
  const unreadable = (what: string): undefined => {
    console.warn(`[content-resolver] maps-index: ${id}.script.json ${what}; serving no roster`);
    return undefined;
  };
  if (typeof parsed !== 'object' || parsed === null) return unreadable('is not an object');
  const { players, multiplayer } = parsed as Record<string, unknown>;
  if (players === undefined) return undefined;
  if (!Array.isArray(players)) return unreadable('has a players field that is not an array');
  const mp = multiplayerOf(multiplayer);
  if (mp === undefined) return unreadable('has an unreadable [multiplayer] table');
  const slots: MapsIndexPlayerSlot[] = [];
  for (const row of players) {
    const slot = playerSlotOf(row, mp);
    if (slot === undefined) return unreadable('has an unreadable player row');
    slots.push(slot);
  }
  return slots.length > 0 ? { slots, fixedColors: mp.fixedColors } : undefined;
}

/**
 * One entry per `content/maps/<id>.json` grid, joined with its optional sidecars. Tolerance is per
 * entry: one malformed sidecar degrades its own entry, never the list. `mapsRoot` must exist - the
 * caller guards.
 */
export async function buildMapsIndexEntries(fs: ReadableVfs, mapsRoot: string): Promise<MapsIndexEntry[]> {
  const dir: MapsDir = { fs, root: mapsRoot, names: await fileNamesIn(fs, mapsRoot) };
  const ids = [...dir.names]
    .filter(isMapGridFile)
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
    });
  }
  return entries;
}

/** A map id is a dotless slug, so a dotted stem (`<id>.meta.json`, `.script.json`, `.strings.json`, `.briefing.json`)
 *  is a sidecar, never a grid of its own. */
function isMapGridFile(name: string): boolean {
  return name.endsWith('.json') && !name.slice(0, -'.json'.length).includes('.');
}
