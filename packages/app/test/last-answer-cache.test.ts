import { describe, expect, it, vi } from 'vitest';
import { diag } from '../src/diag/log.js';
import { createLastAnswerCache } from '../src/session/last-answer-cache.js';

/** A host that answers only when told to, so a test controls when each answer lands. */
function deferredHost() {
  const pending: ((answer: string) => void)[] = [];
  let asks = 0;
  return {
    ask: (): Promise<string> => {
      asks++;
      return new Promise((resolve) => pending.push(resolve));
    },
    answer: async (value: string): Promise<void> => {
      pending.shift()?.(value);
      await Promise.resolve();
    },
    asks: () => asks,
  };
}

describe('last-answer cache', () => {
  it('answers undefined until the first answer lands, and asks once while the question holds', async () => {
    const host = deferredHost();
    const cache = createLastAnswerCache<string>({ tick: () => 0 });
    expect(cache.read('k', host.ask)).toBeUndefined();
    expect(cache.read('k', host.ask)).toBeUndefined();
    expect(host.asks()).toBe(1);
    await host.answer('first');
    expect(cache.read('k', host.ask)).toBe('first');
    expect(cache.version).toBe(1);
    expect(host.asks()).toBe(1);
  });

  it('asks again when the inputs change, serving the stale answer until the fresh one lands', async () => {
    const host = deferredHost();
    const cache = createLastAnswerCache<string>({ tick: () => 0 });
    cache.read('k', host.ask, 'v1');
    await host.answer('old');
    expect(cache.read('k', host.ask, 'v2')).toBe('old');
    expect(host.asks()).toBe(2);
    // One ask per key is in flight: a third version waits for the second answer.
    expect(cache.read('k', host.ask, 'v3')).toBe('old');
    expect(host.asks()).toBe(2);
    await host.answer('new');
    expect(cache.version).toBe(2);
    expect(cache.read('k', host.ask, 'v3')).toBe('new');
    expect(host.asks()).toBe(3);
  });

  it('moves its version only for an answer unlike the last', async () => {
    const cache = createLastAnswerCache<boolean>({ tick: () => 0 });
    cache.read('k', () => Promise.resolve(true), 'v1');
    await Promise.resolve();
    expect(cache.version).toBe(1);
    cache.read('k', () => Promise.resolve(true), 'v2');
    await Promise.resolve();
    expect(cache.version).toBe(1);
    cache.read('k', () => Promise.resolve(false), 'v3');
    await Promise.resolve();
    expect(cache.version).toBe(2);
    expect(cache.read('k', () => Promise.resolve(false), 'v3')).toBe(false);
  });

  it('asks a per-tick read again once the tick moves, and a plain read never', async () => {
    const host = deferredHost();
    let tick = 0;
    const cache = createLastAnswerCache<string>({ tick: () => tick });
    cache.read('live', host.ask, '', true);
    cache.read('still', host.ask);
    await host.answer('a');
    await host.answer('b');
    tick = 1;
    expect(cache.read('live', host.ask, '', true)).toBe('a');
    expect(cache.read('still', host.ask)).toBe('b');
    expect(host.asks()).toBe(3);
  });

  it('forgets past its capacity only keys no read asked for since the previous tick', async () => {
    const host = deferredHost();
    let tick = 0;
    const cache = createLastAnswerCache<string>({ tick: () => tick, capacity: 2 });
    for (const key of ['a', 'b', 'c']) {
      cache.read(key, host.ask);
      await host.answer(key);
    }
    // Three keys read this tick outgrow the capacity of two and are all kept, so each answers.
    expect(['a', 'b', 'c'].map((key) => cache.read(key, host.ask))).toEqual(['a', 'b', 'c']);
    tick = 2;
    // Only `c` is read again: past capacity, the stale `a` and `b` make room for `d`.
    cache.read('c', host.ask);
    cache.read('d', host.ask);
    await host.answer('d');
    expect(cache.read('d', host.ask)).toBe('d');
    expect(cache.read('a', host.ask)).toBeUndefined();
  });

  it('reads more keys per tick than its capacity and still answers every one', async () => {
    const cache = createLastAnswerCache<number>({ tick: () => 0, capacity: 4 });
    const keys = Array.from({ length: 12 }, (_value, index) => index);
    for (const key of keys) cache.read(`${key}`, () => Promise.resolve(key));
    await Promise.resolve();
    expect(keys.map((key) => cache.read(`${key}`, () => Promise.resolve(key)))).toEqual(keys);
  });

  it('answers a click as of now: the held answer when current, else a fresh ask', async () => {
    const host = deferredHost();
    let tick = 0;
    const cache = createLastAnswerCache<string>({ tick: () => tick });
    cache.read('k', host.ask, '', true);
    await host.answer('held');
    await expect(cache.fresh('k', host.ask, '', true)).resolves.toBe('held');
    expect(host.asks()).toBe(1);
    tick = 1;
    const asked = cache.fresh('k', host.ask, '', true);
    await host.answer('now');
    await expect(asked).resolves.toBe('now');
    expect(cache.read('k', host.ask, '', true)).toBe('now');
  });

  it('reports a failed ask once and asks again only when the inputs change', async () => {
    let asks = 0;
    const failing = (): Promise<string> => {
      asks++;
      return Promise.reject(new Error('the host is gone'));
    };
    let tick = 0;
    const cache = createLastAnswerCache<string>({ tick: () => tick });
    const warn = vi.spyOn(diag, 'warn').mockImplementation(() => undefined);
    try {
      cache.read('k', failing, 'v1', true);
      await Promise.resolve();
      await Promise.resolve();
      tick = 1;
      cache.read('k', failing, 'v1', true);
      expect(asks).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
      cache.read('k', failing, 'v2', true);
      expect(asks).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps its version for an answer its equality calls unchanged', async () => {
    const cache = createLastAnswerCache<{ readonly n: number }>({
      tick: () => 0,
      same: (held, landed) => held.n === landed.n,
    });
    cache.read('k', () => Promise.resolve({ n: 1 }), 'v1');
    await Promise.resolve();
    cache.read('k', () => Promise.resolve({ n: 1 }), 'v2');
    await Promise.resolve();
    expect(cache.version).toBe(1);
  });

  it('settles once the asks in flight land, and drops what lands after disposal', async () => {
    const host = deferredHost();
    const cache = createLastAnswerCache<string>({ tick: () => 0 });
    cache.read('k', host.ask);
    let settled = false;
    const done = cache.settled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await host.answer('landed');
    await done;
    expect(settled).toBe(true);

    cache.read('other', host.ask);
    cache.dispose();
    await host.answer('late');
    expect(cache.version).toBe(1);
    expect(cache.read('other', host.ask)).toBeUndefined();
  });

  it('leaves a key unasked when asking throws, so the next read asks again', () => {
    const cache = createLastAnswerCache<string>({ tick: () => 0 });
    expect(() =>
      cache.read('k', () => {
        throw new Error('the host is wedged');
      }),
    ).toThrow('wedged');
    let asked = false;
    cache.read('k', () => {
      asked = true;
      return Promise.resolve('ok');
    });
    expect(asked).toBe(true);
  });
});
