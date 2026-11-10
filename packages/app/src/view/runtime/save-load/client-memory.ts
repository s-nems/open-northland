import type { PetNameRecord } from '../../../game/character-names/pet-names.js';
import { type FogMemory, fogMemoryOf } from './fog-memory.js';

/** The layout {@link encodeClientMemory} writes; a reader accepts exactly this one. */
const CLIENT_MEMORY_VERSION = 2;

/**
 * What the saving client remembers beside the world, carried in a save's `presentation` text: its fog
 * memory and the names its player gave. It never reaches another seat: the relay sends the world, not
 * this text.
 */
export interface ClientMemory {
  readonly fog: FogMemory | null;
  readonly names: readonly PetNameRecord[];
}

const NO_MEMORY: ClientMemory = { fog: null, names: [] };

/** One given name as the text keeps it: `[entity, pool, raw, name]`. */
type NameRow = readonly [number, string, string, string];
const NAME_ROW_FIELDS = 4;

export function encodeClientMemory(memory: ClientMemory): string {
  const names: NameRow[] = memory.names.map((r) => [r.entity, r.pool, r.raw, r.name]);
  return JSON.stringify({ version: CLIENT_MEMORY_VERSION, fog: memory.fog, names });
}

/** The memory a save's presentation text holds. Text that is absent, of another layout or malformed
 *  reads as none, and a malformed part as that part missing: a lost memory never fails a load. */
export function decodeClientMemory(text: string | null): ClientMemory {
  if (text === null) return NO_MEMORY;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NO_MEMORY;
  }
  if (!isRecord(raw) || raw.version !== CLIENT_MEMORY_VERSION) return NO_MEMORY;
  return {
    fog: raw.fog === null ? null : fogMemoryOf(raw.fog),
    names: Array.isArray(raw.names) ? raw.names.flatMap(nameRecordOf) : [],
  };
}

function nameRecordOf(row: unknown): PetNameRecord[] {
  if (!Array.isArray(row) || row.length !== NAME_ROW_FIELDS) return [];
  const [entity, pool, raw, name] = row as unknown[];
  if (typeof entity !== 'number' || !Number.isSafeInteger(entity) || entity < 0) return [];
  if (typeof pool !== 'string' || typeof raw !== 'string' || typeof name !== 'string') return [];
  return [{ entity, pool, raw, name }];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
