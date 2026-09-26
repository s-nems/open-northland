import { describe, expect, it } from 'vitest';
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

  it('keeps separate answers per key and forgets the key asked longest ago past its capacity', async () => {
    const host = deferredHost();
    const cache = createLastAnswerCache<string>({ tick: () => 0, capacity: 2 });
    for (const key of ['a', 'b']) {
      cache.read(key, host.ask);
      await host.answer(key);
    }
    expect(cache.read('a', host.ask)).toBe('a');
    expect(cache.read('b', host.ask)).toBe('b');
    cache.read('c', host.ask);
    await host.answer('c');
    expect(cache.read('b', host.ask)).toBe('b');
    expect(cache.read('a', host.ask)).toBeUndefined();
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
