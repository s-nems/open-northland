export const INSTALLED_MAP_GENERATION = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const MAX_INSTALLED_MAP_RECORD_BYTES = 1024 * 1024;

/** A map id names a file on every peer, so it is one plain ASCII token (the app's `isMapId`). */
const INSTALLED_MAP_ID = /^[a-z0-9_-]{1,128}$/i;

/** The sidecars a converted map ships, longest first so `.meta.json` is not read as `.json`. */
export const INSTALLED_MAP_SUFFIXES = [
  '.briefing.json',
  '.strings.json',
  '.script.json',
  '.meta.json',
  '.json',
  '.png',
] as const;
export type InstalledMapSuffix =
  | (typeof INSTALLED_MAP_SUFFIXES)[number]
  | `.pictures-${string}.png`
  | `.voice-${string}.wav`;
/** A briefing picture or spoken line, named as the app's map store names them. */
const BRIEFING_FILE_SUFFIX = /^(?:\.pictures-[0-9a-f]{16}\.png|\.voice-(?:pol|eng|ger|rus)-\d{4,}\.wav)$/;

/** The app's own cap on one map document; a picture is far smaller. */
export const MAX_INSTALLED_MAP_FILE_BYTES = 64 * 1024 * 1024;

export interface InstalledMapFileWrite {
  readonly mapId: string;
  readonly suffix: InstalledMapSuffix;
  readonly bytes: Uint8Array;
}

export function parseInstalledMapId(value: unknown): string {
  if (typeof value !== 'string' || !INSTALLED_MAP_ID.test(value)) throw new Error('Invalid map id');
  return value;
}

export function parseInstalledMapSuffix(value: unknown): InstalledMapSuffix {
  if (typeof value === 'string' && BRIEFING_FILE_SUFFIX.test(value)) return value as InstalledMapSuffix;
  const suffix = INSTALLED_MAP_SUFFIXES.find((candidate) => candidate === value);
  if (suffix === undefined) throw new Error('Invalid map file suffix');
  return suffix;
}

/** The renderer's write request, checked before anything touches the disk. */
export function parseInstalledMapFileWrite(
  mapId: unknown,
  suffix: unknown,
  bytes: unknown,
): InstalledMapFileWrite {
  const id = parseInstalledMapId(mapId);
  const known = parseInstalledMapSuffix(suffix);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('Invalid map file bytes');
  if (bytes.byteLength > MAX_INSTALLED_MAP_FILE_BYTES) throw new Error('Map file exceeds the size limit');
  return { mapId: id, suffix: known, bytes };
}
