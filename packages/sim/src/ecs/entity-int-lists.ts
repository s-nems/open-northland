import type { Entity } from './component.js';

/** Words the buffer starts with and never shrinks below. */
const INITIAL_WORDS = 1024;
/** Free room a repack must leave, as a share of the live words, for it to pack in place: a quarter
 *  makes a repack pay for at least a quarter of its copy in writes before the next one. */
const SLACK_SHARE = 0.25;
/** A grown buffer's size over the words it must hold, so churn after growth packs in place. */
const GROWTH = 2;
/** Each list's first word holds its length. */
const HEADER_WORDS = 1;

/**
 * Per entity, one list of int32 values (or an int32 brand such as a node id) packed into a shared buffer
 * as `[length, ...values]`, instead of an array object per entity: a derived view holding a short list
 * per standing resource keeps tens of thousands of them. A replaced or deleted list leaves dead words
 * behind; running out of room repacks the live lists, in place while they leave the slack free.
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

  /** Pack the live lists, in holding order, with room for `need` more words plus slack: in place while
   *  they fit, so churn reuses the buffer, else into a buffer grown to `GROWTH` times what they need.
   *  `starts` iterates in ascending start (a list is always set at the end), so an in-place copy only
   *  ever moves a list towards the front, over words already packed or dead. */
  private makeRoom(need: number): void {
    const required = this.liveWords + need;
    const old = this.words;
    const words =
      required * (1 + SLACK_SHARE) <= old.length
        ? old
        : new Int32Array(Math.max(INITIAL_WORDS, Math.ceil(required * GROWTH)));
    let end = 0;
    const { starts } = this;
    starts.forEach((start, e) => {
      const stop = start + (old[start] as number) + HEADER_WORDS;
      starts.set(e, end);
      if (words === old) words.copyWithin(end, start, stop);
      else words.set(old.subarray(start, stop), end);
      end += stop - start;
    });
    this.words = words;
    this.end = end;
  }
}
