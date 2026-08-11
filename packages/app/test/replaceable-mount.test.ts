import { describe, expect, it, vi } from 'vitest';
import { createReplaceableMount } from '../src/hud/replaceable-mount.js';

interface TestMount {
  readonly key: number;
  state: number;
  dispose(): void;
}

function testMount(key: number, state = 0): TestMount {
  return { key, state, dispose: vi.fn() };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe('replaceable mount', () => {
  it('swaps mounts and disposes each mounted value once', async () => {
    const initial = testMount(1);
    const next = testMount(2);
    const mounts = createReplaceableMount(initial, async () => next);

    await mounts.replace(2);

    expect(mounts.current()).toBe(next);
    expect(initial.dispose).toHaveBeenCalledOnce();
    expect(next.dispose).not.toHaveBeenCalled();

    mounts.dispose();
    mounts.dispose();

    expect(initial.dispose).toHaveBeenCalledOnce();
    expect(next.dispose).toHaveBeenCalledOnce();
  });

  it('serializes mounts, skips queued keys, and rejects stale results', async () => {
    const first = deferred<TestMount>();
    const last = deferred<TestMount>();
    const factory = vi.fn((key: number): Promise<TestMount> => {
      if (key === 2) return first.promise;
      if (key === 4) return last.promise;
      throw new Error(`unexpected key ${key}`);
    });
    const initial = testMount(1);
    const stale = testMount(2);
    const latest = testMount(4);
    const mounts = createReplaceableMount(initial, factory);

    const firstReplacement = mounts.replace(2);
    const skippedReplacement = mounts.replace(3);
    const lastReplacement = mounts.replace(4);

    expect(factory).toHaveBeenCalledTimes(1);
    first.resolve(stale);
    await firstReplacement;

    expect(stale.dispose).toHaveBeenCalledOnce();
    expect(initial.dispose).not.toHaveBeenCalled();
    expect(factory.mock.calls.map(([key]) => key)).toEqual([2, 4]);

    last.resolve(latest);
    await Promise.all([skippedReplacement, lastReplacement]);

    expect(mounts.current()).toBe(latest);
    expect(initial.dispose).toHaveBeenCalledOnce();
    expect(stale.dispose).toHaveBeenCalledOnce();
  });

  it('disposes a pending result after the manager has been disposed', async () => {
    const pending = deferred<TestMount>();
    const initial = testMount(1);
    const late = testMount(2);
    const mounts = createReplaceableMount(initial, () => pending.promise);
    const replacement = mounts.replace(2);

    mounts.dispose();
    mounts.dispose();
    await replacement;

    expect(initial.dispose).toHaveBeenCalledOnce();
    expect(late.dispose).not.toHaveBeenCalled();

    pending.resolve(late);
    await vi.waitFor(() => expect(late.dispose).toHaveBeenCalledOnce());
  });

  it('accepts a later replacement after the factory rejects', async () => {
    const initial = testMount(1);
    const recovered = testMount(3);
    const factory = vi.fn((key: number): Promise<TestMount> => {
      if (key === 2) return Promise.reject(new Error('mount failed'));
      return Promise.resolve(recovered);
    });
    const mounts = createReplaceableMount(initial, factory);

    await expect(mounts.replace(2)).rejects.toThrow('mount failed');
    await mounts.replace(3);

    expect(factory.mock.calls.map(([key]) => key)).toEqual([2, 3]);
    expect(mounts.current()).toBe(recovered);
    expect(initial.dispose).toHaveBeenCalledOnce();
  });

  it('runs the state-transfer hook before disposing the previous mount', async () => {
    const initial = testMount(1, 23);
    const next = testMount(2);
    const beforeSwap = vi.fn((incoming: TestMount, previous: TestMount): void => {
      expect(previous.dispose).not.toHaveBeenCalled();
      incoming.state = previous.state;
    });
    const mounts = createReplaceableMount(initial, async () => next, beforeSwap);

    await mounts.replace(2);

    expect(beforeSwap).toHaveBeenCalledWith(next, initial);
    expect(mounts.current().state).toBe(23);
    expect(initial.dispose).toHaveBeenCalledOnce();
  });
});
