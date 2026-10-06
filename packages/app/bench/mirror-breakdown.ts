import { serialize } from 'node:v8';
import { entityById, entityDeltas, type SnapshotDelta, type WorldSnapshot } from '@open-northland/sim';

const BYTES_PER_KB = 1024;
const PERCENT = 100;
/** The components a breakdown lists, heaviest first. */
const LISTED_COMPONENTS = 16;
/** The fields named per component, most often changed first. */
const LISTED_FIELDS = 4;
/** What V8's serializer writes around any value: subtracted so a value's figure is its own bytes. */
const SERIALIZED_ENVELOPE_BYTES = serialize(null).byteLength;
/** A numeric record travels as its fields in the delta's Float64Array. */
const BYTES_PER_NUMBER = 8;

interface ComponentTally {
  writes: number;
  /** Writes of an entity the mirror did not hold yet, which carry every component. */
  created: number;
  /** Writes whose value equals what the mirror already held. */
  unchanged: number;
  bytes: number;
  /** Per top-level field of a record value, the writes that changed it. */
  readonly fields: Map<string, number>;
}

/**
 * What the deltas of a window are made of, per component: writes, the share that rewrote an equal value,
 * the share that created the entity, the bytes they carry and the record fields that changed. Fed each
 * delta before the mirror applies it, so it compares against the previous state.
 */
export class DeltaBreakdown {
  private readonly tallies = new Map<string, ComponentTally>();
  private deltas = 0;

  add(delta: SnapshotDelta, before: WorldSnapshot): void {
    if (delta.rebuild) return;
    this.deltas++;
    for (const entry of entityDeltas(delta)) {
      const held = entityById(before, entry.id);
      for (const name in entry.components) {
        const value = entry.components[name];
        const tally = this.tallyOf(name);
        tally.writes++;
        tally.bytes += valueBytes(value);
        if (held === undefined) {
          tally.created++;
          continue;
        }
        const previous = held.components[name];
        if (plainEqual(previous, value)) {
          tally.unchanged++;
          continue;
        }
        if (!isRecord(value) || !isRecord(previous)) continue;
        for (const key in value) {
          if (!plainEqual(value[key], previous[key])) tally.fields.set(key, (tally.fields.get(key) ?? 0) + 1);
        }
      }
    }
  }

  /** The report lines, heaviest component first; resets the tallies. */
  lines(): string[] {
    if (this.deltas === 0) return [];
    const perDelta = this.deltas;
    const rows = [...this.tallies.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
    const totalBytes = rows.reduce((sum, [, tally]) => sum + tally.bytes, 0);
    const lines = [
      `  delta breakdown over ${perDelta} deltas, value KB/delta ${(totalBytes / perDelta / BYTES_PER_KB).toFixed(1)}: ` +
        'component  writes/delta  unchanged%  created%  KB/delta  changed fields (writes/delta)',
    ];
    for (const [name, tally] of rows.slice(0, LISTED_COMPONENTS)) {
      const fields = [...tally.fields.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, LISTED_FIELDS)
        .map(([field, writes]) => `${field} ${(writes / perDelta).toFixed(1)}`)
        .join(', ');
      lines.push(
        `    ${name}  ${(tally.writes / perDelta).toFixed(1)}  ${share(tally.unchanged, tally.writes)}  ` +
          `${share(tally.created, tally.writes)}  ${(tally.bytes / perDelta / BYTES_PER_KB).toFixed(2)}  ${fields}`,
      );
    }
    this.tallies.clear();
    this.deltas = 0;
    return lines;
  }

  private tallyOf(name: string): ComponentTally {
    let tally = this.tallies.get(name);
    if (tally === undefined) {
      tally = { writes: 0, created: 0, unchanged: 0, bytes: 0, fields: new Map() };
      this.tallies.set(name, tally);
    }
    return tally;
  }
}

function share(part: number, whole: number): string {
  return `${whole === 0 ? 0 : Math.round((part / whole) * PERCENT)}%`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The bytes the delta spends on the value: a record of numbers as its fields, anything else as V8
 *  serializes it. */
function valueBytes(value: unknown): number {
  if (isRecord(value)) {
    let numbers = 0;
    let numeric = true;
    for (const key in value) {
      if (typeof value[key] !== 'number') {
        numeric = false;
        break;
      }
      numbers++;
    }
    if (numeric) return numbers * BYTES_PER_NUMBER;
  }
  return serialize(value).byteLength - SERIALIZED_ENVELOPE_BYTES;
}

/** Deep equality of plain data, as a snapshot clone holds it. */
function plainEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!plainEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  for (const key of keys) if (!plainEqual(ra[key], rb[key])) return false;
  return true;
}
