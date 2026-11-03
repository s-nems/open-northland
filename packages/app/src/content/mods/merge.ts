import { ContentSet, parseContentSet, parseGeneratedContentSet } from '@open-northland/data';

const ROW_KEY_FIELDS = [
  'tribe',
  'tribeId',
  'id',
  'typeId',
  /** The `[GfxHouse]` growth level: the house lanes key on `(tribeId, typeId, level)`, so levels of one
   *  type stay apart and a mod's verbatim clone of a tribe's rows adds instead of collapsing them. */
  'level',
  'atomicId',
  'job',
  'jobType',
  'goodType',
  'vehicleType',
  'action',
  'editName',
  'imagelib',
  'patternId',
  'logicType',
  'paletteName',
  'stackIdx',
  'state',
  'slot',
] as const;
type JsonRecord = Record<string, unknown>;
const CONTENT_LANES: ReadonlySet<string> = new Set(Object.keys(ContentSet.shape));

export class ContentModLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentModLoadError';
  }
}

function record(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowKey(value: unknown): string | null {
  if (!record(value)) return null;
  const identity = ROW_KEY_FIELDS.filter((field) => Object.hasOwn(value, field)).map((field) => [
    field,
    value[field],
  ]);
  return identity.length === 0 ? null : JSON.stringify(identity);
}

function mergeRows(base: readonly unknown[], patch: readonly unknown[]): unknown[] {
  const merged = [...base];
  const positions = new Map<string, number>();
  merged.forEach((value, index) => {
    const key = rowKey(value);
    if (key !== null) positions.set(key, index);
  });
  for (const value of patch) {
    const key = rowKey(value);
    const index = key === null ? undefined : positions.get(key);
    if (index === undefined) {
      if (key !== null) positions.set(key, merged.length);
      merged.push(value);
    } else {
      merged[index] = mergeContentModData(merged[index], value);
    }
  }
  return merged;
}

export function mergeContentModData(base: unknown, patch: unknown): unknown {
  if (!record(base) || !record(patch)) return patch;
  const merged = new Map(Object.entries(base));
  for (const [key, value] of Object.entries(patch)) {
    const previous = merged.get(key);
    if (CONTENT_LANES.has(key) && Array.isArray(previous) && Array.isArray(value)) {
      merged.set(key, mergeRows(previous, value));
    } else if (record(previous) && record(value)) {
      merged.set(key, mergeContentModData(previous, value));
    } else {
      merged.set(key, value);
    }
  }
  return Object.fromEntries(merged);
}

export function validateContentModPatch(raw: unknown): void {
  ContentSet.partial().parse(raw);
}

function isFullContentSet(raw: unknown): boolean {
  return record(raw) && Object.keys(ContentSet.shape).every((lane) => Object.hasOwn(raw, lane));
}

export function mergeContentModPatches(base: unknown | null, rawPatches: readonly unknown[]) {
  const patches = rawPatches.map((raw) => ContentSet.partial().parse(raw));
  let merged = base;
  if (merged === null) {
    const full = rawPatches.find(isFullContentSet);
    if (full === undefined) throw new Error('A partial content pack requires base content/ir.json');
    merged = parseGeneratedContentSet(full);
  }
  for (const patch of patches) merged = mergeContentModData(merged, patch);
  return parseContentSet(merged);
}
