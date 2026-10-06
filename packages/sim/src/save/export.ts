import type { CommandEnvelope } from '../core/commands/index.js';
import { mergeContinuation, type SavedCommand } from '../core/continuation.js';
import { isPlainRecord, PROTO_KEY, valueShapeName } from '../core/plain-value.js';
import type { Simulation } from '../simulation.js';
import { simContentFingerprint } from './content-fingerprint.js';
import {
  SAVE_FORMAT_VERSION,
  SAVE_KIND,
  SAVE_MAP_KEY,
  type SaveGame,
  type SaveGameSection,
} from './format.js';
import { parseSavedAt } from './header-fields.js';
import { parseSaveGame } from './parse.js';
import { copySessionMetadata } from './session-metadata.js';

export interface ExportSaveOptions {
  readonly continuation?: readonly SavedCommand[];
  /** Opaque plain JSON copied into the header; the session owner validates its schema. */
  readonly session?: unknown;
  readonly savedAt?: number | null;
  /** The caller's world identity token (the app uses the decoded map id, or `scene:<id>`), recorded
   *  so a loader can match the save to the world it boots. Omit for a world with no identity. */
  mapId?: string;
  /** The caller's relaunch token (the app uses the entry URL search), recorded so a loader can
   *  reboot the session the save came from. Omit when there is nothing to reboot into. */
  entry?: string;
  parent?: SaveGame;
}

/**
 * Capture the complete run state as a canonical plain-data {@link SaveGame}. Call at a tick
 * boundary, never from inside a system; the walk copies every value, so the result shares nothing
 * with the live world.
 */
export function exportSaveGame(sim: Simulation, opts: ExportSaveOptions = {}): SaveGame {
  try {
    return captureSave(sim, opts, null);
  } catch (err) {
    if (err !== UNSAVEABLE) throw err;
  }
  // The fast walk names no paths; walk again naming every value, which throws the precise reason.
  return captureSave(sim, opts, new WeakMap<object, string>());
}

/** Thrown by the walk without paths at the first unsaveable value, so the export can rerun with them. */
const UNSAVEABLE = new Error('unsaveable value');

/**
 * The export walk. With `paths` null it builds no path text and remembers visited objects in a plain set,
 * since a failure only needs naming once found; with `paths` it records each object's path to name the
 * value a repeat shares.
 */
function captureSave(
  sim: Simulation,
  opts: ExportSaveOptions,
  paths: WeakMap<object, string> | null,
): SaveGame {
  const savedAt = parseSavedAt(opts.savedAt ?? null);
  // One visit per object across the whole export: a repeat is a cycle or a cross-entity alias,
  // and either would silently restore as disconnected copies.
  const walk: Walk = { seen: new Set<object>(), paths };
  const sections: SaveGameSection[] = [
    { id: 'entities', nextId: sim.world.nextEntityId, alive: [...sim.world.canonicalEntities()] },
  ];
  sim.world.forEachStore((name, entries) => {
    const saved: Array<readonly [number, unknown]> = [];
    for (const [entity, value] of entries) {
      saved.push([entity, savedValue(value, paths === null ? null : `component:${name}/${entity}`, walk)]);
    }
    sections.push({ id: 'component', name, entries: saved });
  });
  sections.push({ id: 'rng', state: sim.rng.getState() });
  sections.push({ id: 'names', cursors: sim.names.snapshot() });
  const fog = sim.fog;
  if (fog !== undefined) {
    // tryMaskFor, never maskFor: the allocating accessor would grow hashed fog state from an export.
    const masks: Array<readonly [number, string]> = [];
    for (const group of fog.groupsWithMasks()) {
      const mask = fog.tryMaskFor(group);
      if (mask !== undefined) masks.push([group, maskDigits(mask)]);
    }
    sections.push({
      id: 'fog',
      activeMode: fog.activeMode,
      lastRebuildTick: fog.lastRebuildTick,
      sharedVision: fog.sharedVisionGroups(),
      masks,
    });
  }
  sections.push({
    id: 'commands',
    continuation: mergeContinuation(sim.commands.continuationSnapshot(), opts.continuation ?? [], sim.tick),
    nextSequence: sim.commands.nextSequenceNumber,
    pending: sim.commands.pendingSnapshot().map(
      (envelope, i) =>
        // The walk is a shape-preserving deep copy, so the result is still the envelope it copied.
        savedValue(envelope, paths === null ? null : `commands.pending[${i}]`, walk) as CommandEnvelope,
    ),
  });
  return {
    header: {
      kind: SAVE_KIND,
      formatVersion: SAVE_FORMAT_VERSION,
      irVersion: sim.content.manifest.version,
      contentFingerprint: simContentFingerprint(sim.content),
      savedAt,
      mapId: opts.mapId ?? null,
      mapFingerprint: sim.mapFingerprint ?? null,
      entry: opts.entry ?? null,
      session: copySessionMetadata(opts.session ?? null),
      seed: sim.seed,
      tick: sim.tick,
    },
    sections,
    ...(opts.parent !== undefined ? { parent: parseSaveGame(JSON.parse(JSON.stringify(opts.parent))) } : {}),
  };
}

/** The canonical byte encoding of a save: JSON with every object's keys in construction order. */
export function serializeSaveGame(save: SaveGame): string {
  return JSON.stringify(save);
}

interface Walk {
  /** Every object visited so far in this export. */
  readonly seen: Set<object>;
  /** Each visited object's path, kept only by the naming walk. */
  readonly paths: WeakMap<object, string> | null;
}

/** Fail the walk at `path`: the naming walk throws the reason, the fast one only stops. */
function unsaveable(path: string | null, reason: string): never {
  throw path === null ? UNSAVEABLE : new Error(`${path}: ${reason}`);
}

/** `path` extended by `suffix`, or null on the walk that names nothing. */
function childPath(path: string | null, suffix: string | number): string | null {
  return path === null ? null : typeof suffix === 'number' ? `${path}[${suffix}]` : `${path}${suffix}`;
}

/**
 * Deep-copy one component or envelope value to JSON-safe plain data: a `Map` becomes a single-key
 * `{'$map': entries}` wrapper, record keys keep insertion order and a record key holding `undefined`
 * is saved as absent (a cleared optional field). A failure names `path` for any shape JSON would
 * corrupt - an `undefined` value or array element, a non-finite number, a non-plain object, or an
 * object the walk already saved from anywhere in the same export.
 */
function savedValue(value: unknown, path: string | null, walk: Walk): unknown {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) unsaveable(path, 'non-finite number does not survive JSON');
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    if (walk.seen.has(value)) {
      const prior = walk.paths?.get(value);
      unsaveable(path, `object already saved at ${prior}; shared or cyclic state cannot round-trip`);
    }
    walk.seen.add(value);
    if (path !== null) walk.paths?.set(value, path);
  }
  if (value instanceof Map) {
    // Entry order is the Map's live insertion order, not key-sorted: systems iterate component Maps
    // directly, so the order is observable state a restore must reproduce.
    const entries: unknown[] = [];
    for (const [k, v] of value) {
      const i = entries.length;
      entries.push([
        savedValue(k, path === null ? null : `${path}[${i}].key`, walk),
        savedValue(v, childPath(path, i), walk),
      ]);
    }
    return { [SAVE_MAP_KEY]: entries };
  }
  if (Array.isArray(value)) {
    // An index loop, not `map`: a sparse hole must hit the undefined failure, never serialize as null.
    const out = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) out[i] = savedValue(value[i], childPath(path, i), walk);
    return out;
  }
  if (isPlainRecord(value)) {
    if (Object.hasOwn(value, SAVE_MAP_KEY)) {
      unsaveable(path, `the key '${SAVE_MAP_KEY}' is reserved for the Map encoding`);
    }
    if (Object.hasOwn(value, PROTO_KEY))
      unsaveable(path, `the key '${PROTO_KEY}' cannot round-trip as plain data`);
    const out: Record<string, unknown> = {};
    for (const key in value) {
      const field = value[key];
      if (field !== undefined) out[key] = savedValue(field, path === null ? null : `${path}.${key}`, walk);
    }
    return out;
  }
  return unsaveable(path, `unsaveable value shape ${valueShapeName(value)}`);
}

const DIGIT_ZERO = '0'.charCodeAt(0);

/** One mask byte per cell as its digit, row-major; the four-value alphabet keeps every byte single-digit. */
function maskDigits(mask: Uint8Array): string {
  const chars = new Array<string>(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const state = mask[i] ?? 0;
    if (state > 9) throw new Error(`fog mask byte ${state} is outside the single-digit encoding`);
    chars[i] = String.fromCharCode(DIGIT_ZERO + state);
  }
  return chars.join('');
}
