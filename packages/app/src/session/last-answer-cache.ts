/** Distinct keys a cache keeps before it forgets the one asked longest ago. */
export const LAST_ANSWER_CAPACITY = 256;

/** What an owner of several caches does to all of them alike. */
export interface AnswerCacheControl {
  /** Bumped by every answer that lands unlike the one it replaces (by identity, so a primitive answer
   *  repeated moves nothing): a memo over what the reads returned keys on it. */
  readonly version: number;
  /** Resolves once the asks in flight now have landed or failed. */
  settled(): Promise<void>;
  /** Forget every answer and drop the ones still in flight. */
  dispose(): void;
}

/**
 * The last answer to each asynchronous host read, for a consumer that must read synchronously (a frame,
 * a HUD model, a click gate). A read returns what landed last and asks again only when that answer went
 * stale; until the first answer to a key lands it returns undefined.
 */
export interface LastAnswerCache<V> extends AnswerCacheControl {
  /**
   * The last answer to `key`. Asks `ask` when none was asked yet, and again once `inputs` differ from
   * those of the last ask or, for a `perTick` read, once the tick moved; one ask per key is in flight at
   * a time. A stale answer is still returned while the fresh one is on its way.
   */
  read(key: string, ask: () => Promise<V>, inputs?: string, perTick?: boolean): V | undefined;
}

export interface LastAnswerCacheOptions {
  /** The session tick a `perTick` read follows. */
  readonly tick: () => number;
  readonly capacity?: number;
}

interface Entry<V> {
  answer: V | undefined;
  /** Whether any answer landed, since `undefined` may be one. */
  landed: boolean;
  askedInputs: string;
  askedTick: number;
  pending: boolean;
}

export function createLastAnswerCache<V>(options: LastAnswerCacheOptions): LastAnswerCache<V> {
  const capacity = options.capacity ?? LAST_ANSWER_CAPACITY;
  // Insertion order is ask order: a re-ask moves its key last, so the first key is the stalest.
  let entries = new Map<string, Entry<V>>();
  let version = 0;
  const inFlight = new Set<Promise<void>>();

  const launch = (key: string, entry: Entry<V>, ask: () => Promise<V>, inputs: string): void => {
    // Asked first: a host that throws while asking leaves the entry as it was.
    const asked = ask();
    entry.askedInputs = inputs;
    entry.askedTick = options.tick();
    entry.pending = true;
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > capacity) {
      const stalest = entries.keys().next();
      if (!stalest.done) entries.delete(stalest.value);
    }
    const owner = entries;
    const landed = asked.then(
      () => undefined,
      () => undefined,
    );
    inFlight.add(landed);
    void landed.then(() => inFlight.delete(landed));
    void asked.then(
      (answer) => {
        entry.pending = false;
        if (owner !== entries || entries.get(key) !== entry) return;
        if (entry.landed && Object.is(entry.answer, answer)) return;
        entry.answer = answer;
        entry.landed = true;
        version++;
      },
      (error: unknown) => {
        entry.pending = false;
        // A failed read is the host's fault, not a stale answer: surface it where crashes are captured.
        throw error;
      },
    );
  };

  return {
    read(key, ask, inputs = '', perTick = false) {
      let entry = entries.get(key);
      if (entry === undefined) {
        entry = {
          answer: undefined,
          landed: false,
          askedInputs: inputs,
          askedTick: options.tick(),
          pending: false,
        };
        launch(key, entry, ask, inputs);
      } else if (
        !entry.pending &&
        (entry.askedInputs !== inputs || (perTick && entry.askedTick !== options.tick()))
      ) {
        launch(key, entry, ask, inputs);
      }
      return entry.answer;
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
