import type { Entity } from './component.js';

/** Words the buffer starts with and never shrinks below. */
const INITIAL_WORDS = 1024;
/** Free room a repack leaves, as a share of the live words: a quarter keeps the buffer near its live
 *  size while a repack still pays for at least a quarter of its copy in writes before the next one. */
const SLACK_SHARE = 0.25;
/** Each list's first word holds its length. */
const HEADER_WORDS = 1;

/**
 * Per entity, one list of int32 values (or an int32 brand such as a node id) packed into a shared buffer
 * as `[length, ...values]`, instead of an array object per entity: a derived view holding a short list
 * per standing resource keeps tens of thousands of them. A replaced or deleted list leaves dead words
 * behind; running out of room repacks the live lists into a buffer sized to them plus slack.
 */
export class EntityIntLists<V extends number = number> {
  private words = new Int32Array(INITIAL_WORDS);
  private end = 0;
  private liveWords = 0;
  private readonly starts = new Map<Entity, number>();

  get size(): number {
    return this.starts.size;
  }

  has(e: Entity): boolean {
    return this.starts.has(e);
  }

  /** Hold `values` as `e`'s list, replacing the one it held. */
  set(e: Entity, values: ArrayLike<V>): void {
    this.delete(e);
    const need = values.length + HEADER_WORDS;
    if (this.end + need > this.words.length) this.makeRoom(need);
    const { words } = this;
    const start = this.end;
    words[start] = values.length;
    for (let i = 0; i < values.length; i++) words[start + HEADER_WORDS + i] = values[i] as number;
    this.end += need;
    this.liveWords += need;
    this.starts.set(e, start);
  }

  delete(e: Entity): boolean {
    const start = this.starts.get(e);
    if (start === undefined) return false;
    this.liveWords -= (this.words[start] as number) + HEADER_WORDS;
    this.starts.delete(e);
    return true;
  }

  /** Copy `e`'s list into `out`, resized to it; false, leaving `out` empty, when `e` holds none. */
  read(e: Entity, out: V[]): boolean {
    out.length = 0;
    const start = this.starts.get(e);
    if (start === undefined) return false;
    const { words } = this;
    const from = start + HEADER_WORDS;
    const to = from + (words[start] as number);
    for (let k = from; k < to; k++) out.push(words[k] as V);
    return true;
  }

  clear(): void {
    this.starts.clear();
    this.end = 0;
    this.liveWords = 0;
  }

  /** Copy the live lists, in holding order, into a buffer with room for `need` more words plus slack. */
  private makeRoom(need: number): void {
    const capacity = Math.max(INITIAL_WORDS, Math.ceil((this.liveWords + need) * (1 + SLACK_SHARE)));
    const old = this.words;
    const words = new Int32Array(capacity);
    let end = 0;
    const { starts } = this;
    starts.forEach((start, e) => {
      const stop = start + (old[start] as number) + HEADER_WORDS;
      starts.set(e, end);
      for (let k = start; k < stop; k++) words[end++] = old[k] as number;
    });
    this.words = words;
    this.end = end;
  }
}
