import { describe, expect, it } from 'vitest';
import { DECODED_BYTES_PER_SAMPLE, type PreloadSample } from '../src/index.js';
import { SampleCache } from '../src/web/engine/sample-cache.js';

/** A decoded wav of `frames` mono frames: the fake decoder reads the frame count off the byte length. */
const BYTES_PER_FRAME = 1;
/** Every test clip: a hundred frames, so a budget counts in clips. */
const CLIP_FRAMES = 100;
const CLIP_BYTES = CLIP_FRAMES * DECODED_BYTES_PER_SAMPLE;

interface Harness {
  readonly cache: SampleCache;
  readonly fetched: string[];
  /** The fetches still waiting, in the order they were asked for. */
  readonly pending: Array<{ readonly file: string; readonly release: () => void }>;
}

function makeCache(
  opts: { budgetClips?: number; concurrency?: number; held?: boolean; missing?: string } = {},
): Harness {
  const fetched: string[] = [];
  const pending: Harness['pending'] = [];
  const cache = new SampleCache(
    '/sounds/',
    async (url) => {
      const file = url.slice('/sounds/'.length);
      fetched.push(file);
      if (opts.held === true) await new Promise<void>((release) => pending.push({ file, release }));
      if (file === opts.missing) throw new Error('missing wav');
      return new ArrayBuffer(CLIP_FRAMES * BYTES_PER_FRAME);
    },
    async (bytes) =>
      ({
        length: bytes.byteLength / BYTES_PER_FRAME,
        numberOfChannels: 1,
        duration: 1,
      }) as unknown as AudioBuffer,
    {
      ...(opts.budgetClips !== undefined ? { budgetBytes: opts.budgetClips * CLIP_BYTES } : {}),
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
    },
  );
  return { cache, fetched, pending };
}

const samples = (files: readonly string[], pinned: boolean): PreloadSample[] =>
  files.map((file) => ({ file, pinned }));

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('SampleCache preload', () => {
  it('loads in plan order, a bounded number at a time', async () => {
    const { cache, fetched, pending } = makeCache({ concurrency: 2, held: true });
    const done = cache.preload(samples(['a.wav', 'b.wav', 'c.wav', 'd.wav'], true));
    await settle();
    expect(fetched).toEqual(['a.wav', 'b.wav']);
    pending.shift()?.release();
    await settle();
    expect(fetched).toEqual(['a.wav', 'b.wav', 'c.wav']);
    while (pending.length > 0) {
      pending.shift()?.release();
      await settle();
    }
    const report = await done;
    expect(fetched).toEqual(['a.wav', 'b.wav', 'c.wav', 'd.wav']);
    expect(report).toEqual({
      decoded: 4,
      failed: 0,
      skipped: 0,
      cachedBytes: 4 * CLIP_BYTES,
      pinnedBytes: 4 * CLIP_BYTES,
    });
  });

  it('starts no further wav once its stop condition holds', async () => {
    const { cache, fetched, pending } = makeCache({ concurrency: 2, held: true });
    let stopped = false;
    const done = cache.preload(samples(['a.wav', 'b.wav', 'c.wav', 'd.wav'], true), () => stopped);
    await settle();
    stopped = true;
    for (const { release } of pending.splice(0)) release();
    const report = await done;
    expect(fetched).toEqual(['a.wav', 'b.wav']);
    expect(report.decoded).toBe(2);
  });

  it('counts a failed wav and never fetches it again', async () => {
    const { cache, fetched } = makeCache({ missing: 'gone.wav' });
    const report = await cache.preload(samples(['gone.wav', 'ok.wav'], true));
    expect(report.failed).toBe(1);
    expect(await cache.get('gone.wav')).toBeNull();
    expect(fetched.filter((file) => file === 'gone.wav')).toHaveLength(1);
  });

  it('shares a play that is already loading instead of fetching twice', async () => {
    const { cache, fetched } = makeCache();
    const playing = cache.get('a.wav');
    const report = await cache.preload(samples(['a.wav'], true));
    await playing;
    expect(fetched).toEqual(['a.wav']);
    expect(report.decoded).toBe(0);
  });

  it('stops preloading unpinned wavs at the budget but always loads pinned ones', async () => {
    const { cache, fetched } = makeCache({ budgetClips: 2, concurrency: 1 });
    const report = await cache.preload([
      ...samples(['click.wav', 'answer.wav', 'hammer.wav'], true),
      ...samples(['talk.wav', 'bed.wav'], false),
    ]);
    expect(fetched).toEqual(['click.wav', 'answer.wav', 'hammer.wav']);
    expect(report.skipped).toBe(2);
    expect(report.pinnedBytes).toBe(3 * CLIP_BYTES);
  });
});

describe('SampleCache preload budget', () => {
  it('stops adding unpinned wavs once a load in flight has evicted one', async () => {
    const { cache, fetched } = makeCache({ budgetClips: 2, concurrency: 3 });
    const report = await cache.preload(samples(['talk-1.wav', 'talk-2.wav', 'talk-3.wav', 'bed.wav'], false));
    // Three loads start together; the third evicts the first, so the bed is never fetched.
    expect(fetched).toEqual(['talk-1.wav', 'talk-2.wav', 'talk-3.wav']);
    expect(report.skipped).toBe(1);
  });
});

describe('SampleCache budget', () => {
  it('evicts the least recently played unpinned wav, never a pinned one', async () => {
    const { cache, fetched } = makeCache({ budgetClips: 3 });
    await cache.preload(samples(['click.wav'], true));
    await cache.get('talk-1.wav');
    await cache.get('talk-2.wav');
    // Played again, so talk-2 is now the least recently played.
    await cache.get('talk-1.wav');
    await cache.get('bed.wav');
    expect(cache.bytes).toBe(3 * CLIP_BYTES);
    expect(cache.duration('click.wav')).toBe(1);
    expect(cache.duration('talk-1.wav')).toBe(1);
    expect(cache.duration('talk-2.wav')).toBeUndefined();
    await cache.get('talk-2.wav');
    expect(fetched.filter((file) => file === 'talk-2.wav')).toHaveLength(2);
  });

  it('keeps the wav it just decoded even when the pinned set alone fills the budget', async () => {
    const { cache } = makeCache({ budgetClips: 1 });
    await cache.preload(samples(['click.wav', 'fail.wav'], true));
    expect(await cache.get('talk.wav')).not.toBeNull();
    expect(cache.duration('talk.wav')).toBe(1);
    await cache.get('bed.wav');
    expect(cache.duration('talk.wav')).toBeUndefined();
    expect(cache.duration('click.wav')).toBe(1);
  });

  it('pins a wav a play had already decoded', async () => {
    const { cache } = makeCache({ budgetClips: 2 });
    await cache.get('click.wav');
    await cache.preload(samples(['click.wav'], true));
    await cache.get('talk-1.wav');
    await cache.get('talk-2.wav');
    await cache.get('talk-3.wav');
    expect(cache.duration('click.wav')).toBe(1);
  });
});
