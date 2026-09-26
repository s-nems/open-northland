import { diag } from '../diag/log.js';

/** Distinct keys a cache keeps before it forgets those no read asked for since the previous tick. */
const DEFAULT_CAPACITY = 256;

const DIAG_CHANNEL = 'session';

/** What an owner of several caches does to all of them alike. */
export interface AnswerCacheControl {
  /** Bumped by every answer that lands unlike the one it replaces: a memo over what the reads returned
   *  keys on it. */
  readonly version: number;
  /** Resolves once the asks in flight now have landed or failed. */
  settled(): Promise<void>;
  /** Forget every answer and drop the ones still in flight. */
  dispose(): void;
}

/**
 * The last answer to each asynchronous host read, for a consumer that must read synchronously (a frame,
 * a HUD model, a highlight). A read returns what landed last and asks again only when that answer went
 * stale; until the first answer to a key lands it returns undefined. A click does not decide on a last
 * answer: it awaits `fresh`.
 */
export interface LastAnswerCache<V> extends AnswerCacheControl {
  /**
   * The last answer to `key`. Asks `ask` when none was asked yet, and again once `inputs` differ from
   * those of the last ask or, for a `perTick` read, once the tick moved; one ask per key is in flight at
   * a time. A stale answer is still returned while the fresh one is on its way.
   */
  read(key: string, ask: () => Promise<V>, inputs?: string, perTick?: boolean): V | undefined;
  /** The answer to `key` as of now: the held one when it is current, else a new ask, which the cache
   *  keeps as its last answer too. Rejects when the host fails to answer. */
  fresh(key: string, ask: () => Promise<V>, inputs?: string, perTick?: boolean): Promise<V>;
}

export interface LastAnswerCacheOptions<V> {
  /** The session tick a `perTick` read follows, and the clock the eviction reads. */
  readonly tick: () => number;
  readonly capacity?: number;
  /** Whether a landed answer says nothing new; identity by default. */
  readonly same?: (held: V, landed: V) => boolean;
}

interface Entry<V> {
  answer: V | undefined;
  /** Whether any answer landed, since `undefined` may be one. */
  landed: boolean;
  askedInputs: string;
  askedTick: number;
  /** The newest ask's number, and the newest one that landed: an older ask landing late is dropped. */
  askedSeq: number;
  landedSeq: number;
  /** The inputs an ask failed under; the key is not asked again until they change. */
  failedInputs: string | null;
  readTick: number;
}

export function createLastAnswerCache<V>(options: LastAnswerCacheOptions<V>): LastAnswerCache<V> {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const same = options.same ?? Object.is;
  // Insertion order is ask order: a re-ask moves its key last, so the first keys are the stalest.
  let entries = new Map<string, Entry<V>>();
  let version = 0;
  let seq = 0;
  const inFlight = new Set<Promise<void>>();

  /** Past capacity, forget the stalest keys no read asked for since the previous tick. A consumer that
   *  reads more keys per tick than the capacity keeps them all rather than losing each before it lands. */
  const evict = (tick: number): void => {
    for (const [key, entry] of entries) {
      if (entries.size <= capacity) return;
      if (entry.readTick < tick - 1 && entry.askedSeq === entry.landedSeq) entries.delete(key);
    }
  };

  const launch = (key: string, entry: Entry<V>, ask: () => Promise<V>, inputs: string): Promise<V> => {
    // Asked first: a host that throws while asking leaves the entry as it was.
    const asked = ask();
    const own = ++seq;
    entry.askedInputs = inputs;
    entry.askedTick = options.tick();
    entry.askedSeq = own;
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > capacity) evict(options.tick());
    const owner = entries;
    const landed = asked.then(
      () => undefined,
      () => undefined,
    );
    inFlight.add(landed);
    void landed.then(() => inFlight.delete(landed));
    return asked.then(
      (answer) => {
        if (owner !== entries || entries.get(key) !== entry || own < entry.landedSeq) return answer;
        entry.landedSeq = own;
        entry.failedInputs = null;
        if (entry.landed && same(entry.answer as V, answer)) return answer;
        entry.answer = answer;
        entry.landed = true;
        version++;
        return answer;
      },
      (error: unknown) => {
        if (own >= entry.landedSeq) entry.landedSeq = own;
        if (entry.failedInputs !== inputs) {
          entry.failedInputs = inputs;
          diag.warn(DIAG_CHANNEL, `the host failed to answer ${key}`, { error: String(error) });
        }
        throw error;
      },
    );
  };

  const entryOf = (key: string, inputs: string): Entry<V> => {
    const held = entries.get(key);
    if (held !== undefined) return held;
    return {
      answer: undefined,
      landed: false,
      askedInputs: inputs,
      askedTick: options.tick(),
      askedSeq: 0,
      landedSeq: 0,
      failedInputs: null,
      readTick: options.tick(),
    };
  };

  const current = (entry: Entry<V>, inputs: string, perTick: boolean): boolean =>
    entry.askedInputs === inputs && (!perTick || entry.askedTick === options.tick());

  return {
    read(key, ask, inputs = '', perTick = false) {
      const known = entries.has(key);
      const entry = entryOf(key, inputs);
      entry.readTick = options.tick();
      const pending = entry.askedSeq !== entry.landedSeq;
      const failed = entry.failedInputs === inputs;
      if (!known || (!pending && !failed && !current(entry, inputs, perTick))) {
        // A failed ask is reported, not retried every frame: the rejection is swallowed here.
        launch(key, entry, ask, inputs).catch(() => undefined);
      }
      return entry.answer;
    },
    fresh(key, ask, inputs = '', perTick = false) {
      const entry = entryOf(key, inputs);
      entry.readTick = options.tick();
      const pending = entry.askedSeq !== entry.landedSeq;
      if (entries.has(key) && entry.landed && !pending && current(entry, inputs, perTick)) {
        return Promise.resolve(entry.answer as V);
      }
      return launch(key, entry, ask, inputs);
    },
    get version() {
      return version;
    },
    settled: () => Promise.all([...inFlight]).then(() => undefined),
    dispose() {
      entries = new Map();
    },
  };
}

/** Structural equality for a small plain-data answer, where a re-asked answer arrives as a new object. */
export function samePlainData<V>(held: V, landed: V): boolean {
  return JSON.stringify(held) === JSON.stringify(landed);
}
