import { FNV_OFFSET_BASIS, fnvMixWord } from '@open-northland/data';
import { ABSENT_WORD, stringWord } from '../core/hash-value.js';
import type { EntitySnapshot, WorldSnapshot } from './snapshot.js';
import { entityById } from './snapshot.js';
import type { SnapshotDelta } from './snapshot-delta.js';

/** A set of entities in two words: how many there are, and the XOR of one word per component. */
export interface DeltaDigest {
  readonly entities: number;
  readonly hash: number;
}

/** Where a mirror parted from the world its deltas came from. */
export interface DigestMismatch {
  readonly tick: number;
  /** What the side that took the delta folded. */
  readonly expected: DeltaDigest;
  /** What the mirror holds after applying it. */
  readonly actual: DeltaDigest;
}

interface FoldedEntity {
  components: Readonly<Record<string, unknown>>;
  /** One word per component `components` carries. */
  readonly words: Map<string, number>;
  /** The XOR of `words`. */
  word: number;
}

const NO_COMPONENTS: Readonly<Record<string, unknown>> = {};

/**
 * An order-free hash over a set of entity snapshots, kept per entity: the XOR of one word per id,
 * component name and value. Snapshot clones are never edited in place, so a component object an entity
 * held at its previous fold keeps its word and a fold hashes only the components whose object changed.
 * A value mutated in place is therefore not seen.
 */
export class EntityDigest {
  private readonly held = new Map<number, FoldedEntity>();
  private word = 0;

  get hash(): number {
    return this.word >>> 0;
  }

  /** Replace the entity's part with the components it carries now. */
  fold(entity: EntitySnapshot): void {
    let folded = this.held.get(entity.id);
    if (folded === undefined) {
      folded = { components: NO_COMPONENTS, words: new Map(), word: 0 };
      this.held.set(entity.id, folded);
    }
    const before = folded.components;
    const components = entity.components;
    let word = folded.word;
    let kept = 0;
    // Most components keep their object between folds, so identity is tested before ownership.
    for (const name in components) {
      const value = components[name];
      const held = before[name];
      if (held === value && held !== undefined) {
        kept++;
        continue;
      }
      if (Object.hasOwn(before, name)) {
        kept++;
        word ^= folded.words.get(name) ?? 0;
      }
      const componentWord = mixPlain(
        fnvMixWord(fnvMixWord(FNV_OFFSET_BASIS, entity.id), stringWord(name)),
        value,
      );
      folded.words.set(name, componentWord);
      word ^= componentWord;
    }
    if (kept < folded.words.size) {
      for (const [name, lost] of folded.words) {
        if (Object.hasOwn(components, name)) continue;
        word ^= lost;
        folded.words.delete(name);
      }
    }
    this.word ^= folded.word ^ word;
    folded.word = word;
    folded.components = components;
  }

  drop(id: number): void {
    const folded = this.held.get(id);
    if (folded === undefined) return;
    this.word ^= folded.word;
    this.held.delete(id);
  }

  clear(): void {
    this.held.clear();
    this.word = 0;
  }
}

/** Scratch for a non-integer's two 32-bit halves. */
const FLOAT = new Float64Array(1);
const FLOAT_WORDS = new Uint32Array(FLOAT.buffer);

/**
 * Fold one plain snapshot value into `h`, records in their own key order: both sides of the check hold
 * clones of one object, and a structured clone keeps the order, so no key sort is needed.
 */
function mixPlain(h: number, value: unknown): number {
  if (typeof value === 'number') {
    if ((value | 0) === value) return fnvMixWord(h, value);
    FLOAT[0] = value;
    return fnvMixWord(fnvMixWord(h, FLOAT_WORDS[0] ?? 0), FLOAT_WORDS[1] ?? 0);
  }
  if (typeof value === 'string') return fnvMixWord(h, stringWord(value));
  if (typeof value === 'boolean') return fnvMixWord(h, value ? 1 : 0);
  if (value === null || typeof value !== 'object') return fnvMixWord(h, ABSENT_WORD);
  if (Array.isArray(value)) {
    let out = fnvMixWord(h, value.length);
    for (const item of value) out = mixPlain(out, item);
    return out;
  }
  let out = h;
  const record = value as Record<string, unknown>;
  for (const key in record) out = mixPlain(fnvMixWord(out, stringWord(key)), record[key]);
  return out;
}

/**
 * The mirror side of the truth check: folds the entities each delta named as the mirror holds them
 * once it applied the delta, and compares that with the digest the delta carries. The taking side folds
 * the world's own clones of the same entities, so a lost write, a lost removal or a patch gone wrong
 * shows on the delta that caused it; an entity the delta never named is only counted.
 */
export class MirrorTruth {
  private readonly digest = new EntityDigest();

  /** Call after `mirror.apply(delta)` with the mirror's snapshot; null while the two agree or the
   *  delta carries no digest. */
  check(delta: SnapshotDelta, snapshot: WorldSnapshot): DigestMismatch | null {
    const digest = this.digest;
    if (delta.rebuild) {
      digest.clear();
      for (const entity of snapshot.entities) digest.fold(entity);
    } else {
      for (const id of delta.removed) digest.drop(id);
      for (const id of delta.touched) {
        const entity = entityById(snapshot, id);
        if (entity === undefined) digest.drop(id);
        else digest.fold(entity);
      }
    }
    const expected = delta.digest;
    if (expected === undefined) return null;
    const actual: DeltaDigest = { entities: snapshot.entities.length, hash: digest.hash };
    if (actual.entities === expected.entities && actual.hash === expected.hash) return null;
    return { tick: delta.tick, expected, actual };
  }
}
