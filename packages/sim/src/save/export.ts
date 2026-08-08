import type { CommandEnvelope } from '../core/commands/index.js';
import { isPlainRecord, valueShapeName } from '../core/plain-value.js';
import type { Simulation } from '../simulation.js';
import {
  SAVE_FORMAT_VERSION,
  SAVE_KIND,
  SAVE_MAP_KEY,
  type SaveGame,
  type SaveGameSection,
} from './format.js';

export interface ExportSaveOptions {
  /** The decoded map id the run loaded, recorded as provenance; omit for scenes and mapless sims. */
  mapId?: string;
}

/**
 * Capture the complete run state as a canonical plain-data {@link SaveGame}. Call at a tick
 * boundary, never from inside a system; the walk copies every value, so the result shares nothing
 * with the live world.
 */
export function exportSaveGame(sim: Simulation, opts: ExportSaveOptions = {}): SaveGame {
  // One visit per object across the whole export: a repeat is a cycle or a cross-entity alias,
  // and either would silently restore as disconnected copies.
  const seen = new WeakMap<object, string>();
  const sections: SaveGameSection[] = [
    { id: 'entities', nextId: sim.world.nextEntityId, alive: [...sim.world.canonicalEntities()] },
  ];
  sim.world.forEachStore((name, entries) => {
    const saved: Array<readonly [number, unknown]> = [];
    for (const [entity, value] of entries) {
      saved.push([entity, savedValue(value, `component:${name}/${entity}`, seen)]);
    }
    sections.push({ id: 'component', name, entries: saved });
  });
  sections.push({ id: 'rng', state: sim.rng.getState() });
  const fog = sim.fog;
  if (fog !== undefined) {
    // tryMaskFor, never maskFor: the allocating accessor would grow hashed fog state from an export.
    const masks: Array<readonly [number, string]> = [];
    for (const player of fog.playersWithMasks()) {
      const mask = fog.tryMaskFor(player);
      if (mask !== undefined) masks.push([player, maskDigits(mask)]);
    }
    sections.push({
      id: 'fog',
      activeMode: fog.activeMode,
      lastRebuildTick: fog.lastRebuildTick,
      masks,
    });
  }
  sections.push({
    id: 'commands',
    nextSequence: sim.commands.nextSequenceNumber,
    pending: sim.commands.pendingSnapshot().map(
      (envelope, i) =>
        // The walk is a shape-preserving deep copy, so the result is still the envelope it copied.
        savedValue(envelope, `commands.pending[${i}]`, seen) as CommandEnvelope,
    ),
  });
  return {
    header: {
      kind: SAVE_KIND,
      formatVersion: SAVE_FORMAT_VERSION,
      irVersion: sim.content.manifest.version,
      contentRevision: sim.content.manifest.contentRevision,
      mapId: opts.mapId ?? null,
      mapFingerprint: sim.mapFingerprint ?? null,
      seed: sim.seed,
      tick: sim.tick,
    },
    sections,
  };
}

/** The canonical byte encoding of a save: JSON with every object's keys in construction order. */
export function serializeSaveGame(save: SaveGame): string {
  return JSON.stringify(save);
}

/**
 * Deep-copy one component or envelope value to JSON-safe plain data: a `Map` becomes a single-key
 * `{'$map': entries}` wrapper, record keys keep insertion order, and a throw names `path` for any
 * shape JSON would corrupt - `undefined`, a non-finite number, a non-plain object, or an object
 * `seen` already holds from anywhere in the same export.
 */
function savedValue(value: unknown, path: string, seen: WeakMap<object, string>): unknown {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}: non-finite number does not survive JSON`);
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    const prior = seen.get(value);
    if (prior !== undefined) {
      throw new Error(`${path}: object already saved at ${prior}; shared or cyclic state cannot round-trip`);
    }
    seen.set(value, path);
  }
  if (value instanceof Map) {
    // Entry order is the Map's live insertion order, not key-sorted: systems iterate component Maps
    // directly, so the order is observable state a restore must reproduce.
    const entries: unknown[] = [];
    for (const [k, v] of value) {
      const i = entries.length;
      entries.push([savedValue(k, `${path}[${i}].key`, seen), savedValue(v, `${path}[${i}]`, seen)]);
    }
    return { [SAVE_MAP_KEY]: entries };
  }
  if (Array.isArray(value)) {
    // An index loop, not `map`: a sparse hole must hit the undefined throw, never serialize as null.
    const out = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) out[i] = savedValue(value[i], `${path}[${i}]`, seen);
    return out;
  }
  if (isPlainRecord(value)) {
    if (Object.hasOwn(value, SAVE_MAP_KEY)) {
      throw new Error(`${path}: the key '${SAVE_MAP_KEY}' is reserved for the Map encoding`);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = savedValue(value[key], `${path}.${key}`, seen);
    return out;
  }
  throw new Error(`${path}: unsaveable value shape ${valueShapeName(value)}`);
}

const DIGIT_ZERO = '0'.charCodeAt(0);

/** One FOG_STATE digit per cell, row-major; the tri-state contract keeps every byte single-digit. */
function maskDigits(mask: Uint8Array): string {
  const chars = new Array<string>(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const state = mask[i] ?? 0;
    if (state > 9) throw new Error(`fog mask byte ${state} is outside the single-digit encoding`);
    chars[i] = String.fromCharCode(DIGIT_ZERO + state);
  }
  return chars.join('');
}
