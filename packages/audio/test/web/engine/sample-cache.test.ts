import {
  SOUND_BANKS_FILE,
  SOUND_QUALITIES,
  type SoundBanksDocument,
  type SoundQuality,
  soundBankPath,
} from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { DECODED_BYTES_PER_SAMPLE, type PreloadSample } from '../../../src/index.js';
import { SampleCache } from '../../../src/web/engine/sample-cache.js';
import { NO_SOUND_BANKS, servingSoundBanks } from '../../support/fake-audio.js';

/** A decoded wav of `frames` mono frames: the fake decoder reads the frame count off the byte length. */
const BYTES_PER_FRAME = 1;
/** Every test clip: a hundred frames, so a budget counts in clips. */
const CLIP_FRAMES = 100;
const CLIP_BYTES = CLIP_FRAMES * DECODED_BYTES_PER_SAMPLE;

/** Every byte of a compact clip or bank in the fake tree, so a decoder can tell the encodings apart. */
const COMPACT_MARK = 0x0c;
const isCompact = (file: string): boolean => file.endsWith('.ogg') || file.endsWith('.compact.bin');
/** Every byte of a clip served corrupt, which no decoder takes. */
const CORRUPT_MARK = 0xee;
/** Every byte of a clip the decoder turns into an empty buffer without an error. */
const EMPTY_MARK = 0xe0;
/** An Ogg stream's capture pattern, which opens the cache's Opus probe. */
const OGG_CAPTURE = [0x4f, 0x67, 0x67, 0x53];
const isOgg = (bytes: Uint8Array): boolean => OGG_CAPTURE.every((byte, i) => bytes[i] === byte);

/** A URL under the sounds root as its path there; an app asset's URL stays whole. */
const underSounds = (url: string): string =>
  url.startsWith('/sounds/') ? url.slice('/sounds/'.length) : url;

interface Harness {
  readonly cache: SampleCache;
  /** Every URL asked for under the sounds root, `banks.json` included. */
  readonly fetched: string[];
  readonly warnings: string[];
  /** The fetches still waiting, in the order they were asked for. */
  readonly pending: Array<{ readonly file: string; readonly release: () => void }>;
  /** The byte length of every Ogg stream decoded: the cache's Opus probe. */
  readonly oggDecodes: number[];
}

function makeCache(
  opts: {
    budgetClips?: number;
    concurrency?: number;
    held?: boolean;
    missing?: string;
    banks?: SoundBanksDocument | null;
    quality?: SoundQuality;
    /** How many `banks.json` fetches fail before one succeeds. */
    indexFailures?: number;
    /** The decoder rejects compact bytes, as Safari before 18.4 does Ogg Opus. */
    noCompactDecoder?: boolean;
    /** A clip file served with bytes no decoder takes. */
    corrupt?: string;
    /** A clip file the decoder answers with an empty buffer, as WebKit did a FLAC it misread. */
    empty?: string;
    /** The decoder answers compact bytes with an empty buffer instead of rejecting them. */
    emptyCompactDecoder?: boolean;
  } = {},
): Harness {
  const fetched: string[] = [];
  const oggDecodes: number[] = [];
  const warnings: string[] = [];
  const pending: Harness['pending'] = [];
  const serve = async (url: string): Promise<ArrayBuffer> => {
    const file = underSounds(url);
    if (opts.held === true) await new Promise<void>((release) => pending.push({ file, release }));
    if (file === opts.missing) throw new Error('missing clip');
    // A bank holds every clip its index places in it, back to back.
    const bankClips = Object.values(opts.banks?.clips ?? {}).filter((entry) =>
      SOUND_QUALITIES.some((quality) => soundBankPath(entry.bank, quality) === file),
    ).length;
    const bytes = new Uint8Array(Math.max(1, bankClips) * CLIP_FRAMES * BYTES_PER_FRAME);
    if (isCompact(file)) bytes.fill(COMPACT_MARK);
    if (file === opts.corrupt) bytes.fill(CORRUPT_MARK);
    if (file === opts.empty) bytes.fill(EMPTY_MARK);
    return bytes.buffer;
  };
  const served = opts.banks === null ? serve : servingSoundBanks(serve, opts.banks ?? NO_SOUND_BANKS);
  let indexFailures = opts.indexFailures ?? 0;
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    const file = underSounds(url);
    fetched.push(file);
    if (file === SOUND_BANKS_FILE && indexFailures-- > 0) throw new Error('index unavailable');
    return served(url);
  };
  const cache = new SampleCache(
    '/sounds/',
    fetchBytes,
    async (bytes) => {
      const view = new Uint8Array(bytes);
      if (isOgg(view)) oggDecodes.push(view.length);
      const opus = view[0] === COMPACT_MARK || isOgg(view);
      if (view[0] === CORRUPT_MARK || (opts.noCompactDecoder === true && opus))
        throw new DOMException('Unable to decode audio data', 'EncodingError');
      const empty = view[0] === EMPTY_MARK || (opts.emptyCompactDecoder === true && opus);
      return {
        length: empty ? 0 : bytes.byteLength / BYTES_PER_FRAME,
        numberOfChannels: 1,
        duration: 1,
      } as unknown as AudioBuffer;
    },
    {
      ...(opts.budgetClips !== undefined ? { budgetBytes: opts.budgetClips * CLIP_BYTES } : {}),
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.quality !== undefined ? { quality: opts.quality } : {}),
      warn: (message) => warnings.push(message),
    },
  );
  return { cache, fetched, warnings, pending, oggDecodes };
}

/** The fetched clip and bank files, without the index. */
const files = (fetched: readonly string[]): string[] => fetched.filter((file) => file !== SOUND_BANKS_FILE);

const samples = (files: readonly string[], pinned: boolean): PreloadSample[] =>
  files.map((file) => ({ file, pinned }));

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('SampleCache preload', () => {
  it('loads in plan order, a bounded number at a time', async () => {
    const { cache, fetched, pending } = makeCache({ concurrency: 2, held: true });
    const done = cache.preload(samples(['a.wav', 'b.wav', 'c.wav', 'd.wav'], true));
    await settle();
    expect(files(fetched)).toEqual(['a.flac', 'b.flac']);
    pending.shift()?.release();
    await settle();
    expect(files(fetched)).toEqual(['a.flac', 'b.flac', 'c.flac']);
    while (pending.length > 0) {
      pending.shift()?.release();
      await settle();
    }
    const report = await done;
    expect(files(fetched)).toEqual(['a.flac', 'b.flac', 'c.flac', 'd.flac']);
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
    expect(files(fetched)).toEqual(['a.flac', 'b.flac']);
    expect(report.decoded).toBe(2);
  });

  it('counts a failed wav and never fetches it again', async () => {
    const { cache, fetched } = makeCache({ missing: 'gone.flac' });
    const report = await cache.preload(samples(['gone.wav', 'ok.wav'], true));
    expect(report.failed).toBe(1);
    expect(await cache.get('gone.wav')).toBeNull();
    expect(files(fetched).filter((file) => file === 'gone.flac')).toHaveLength(1);
  });

  it('shares a play that is already loading instead of fetching twice', async () => {
    const { cache, fetched } = makeCache();
    const playing = cache.get('a.wav');
    const report = await cache.preload(samples(['a.wav'], true));
    await playing;
    expect(files(fetched)).toEqual(['a.flac']);
    expect(report.decoded).toBe(0);
  });

  it('stops preloading unpinned wavs at the budget but always loads pinned ones', async () => {
    const { cache, fetched } = makeCache({ budgetClips: 2, concurrency: 1 });
    const report = await cache.preload([
      ...samples(['click.wav', 'answer.wav', 'hammer.wav'], true),
      ...samples(['talk.wav', 'bed.wav'], false),
    ]);
    expect(files(fetched)).toEqual(['click.flac', 'answer.flac', 'hammer.flac']);
    expect(report.skipped).toBe(2);
    expect(report.pinnedBytes).toBe(3 * CLIP_BYTES);
  });
});

describe('SampleCache preload budget', () => {
  it('stops adding unpinned wavs once a load in flight has evicted one', async () => {
    const { cache, fetched } = makeCache({ budgetClips: 2, concurrency: 3 });
    const report = await cache.preload(samples(['talk-1.wav', 'talk-2.wav', 'talk-3.wav', 'bed.wav'], false));
    // Three loads start together; the third evicts the first, so the bed is never fetched.
    expect(files(fetched)).toEqual(['talk-1.flac', 'talk-2.flac', 'talk-3.flac']);
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
    expect(files(fetched).filter((file) => file === 'talk-2.flac')).toHaveLength(2);
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

/** Two banks of two clips each, every span one clip long, both qualities laid out alike. */
function twoBanks(): SoundBanksDocument {
  const span = (slot: number) => ({ offset: slot * CLIP_BYTES_ENCODED, length: CLIP_BYTES_ENCODED });
  const entry = (bank: string, slot: number) => ({
    bank,
    spans: { lossless: span(slot), compact: span(slot) },
  });
  return {
    ...NO_SOUND_BANKS,
    clips: {
      'gui/click.wav': entry('gui-0', 0),
      'gui/fail.wav': entry('gui-0', 1),
      'talk/a.wav': entry('talk-0', 0),
      'talk/b.wav': entry('talk-0', 1),
    },
  };
}
/** An encoded clip's bytes in a test bank: the fake decoder reads one frame per byte. */
const CLIP_BYTES_ENCODED = CLIP_FRAMES * BYTES_PER_FRAME;

describe('SampleCache banks', () => {
  it('preloads each bank with one fetch and decodes every clip from it', async () => {
    const { cache, fetched } = makeCache({ banks: twoBanks() });
    const report = await cache.preload(
      samples(['gui/click.wav', 'talk/a.wav', 'gui/fail.wav', 'talk/b.wav'], true),
    );
    expect(files(fetched)).toEqual(['banks/gui-0.lossless.bin', 'banks/talk-0.lossless.bin']);
    expect(report.decoded).toBe(4);
    expect(report.pinnedBytes).toBe(4 * CLIP_BYTES);
  });

  it('fetches the compact copies when asked for that quality', async () => {
    const { cache, fetched } = makeCache({ banks: twoBanks(), quality: 'compact' });
    await cache.preload(samples(['gui/click.wav'], true));
    await cache.get('talk/a.wav');
    expect(files(fetched)).toEqual(['banks/gui-0.compact.bin', 'talk/a.ogg']);
  });

  it('lets go of a bank after the preload, so a later load fetches the clip alone', async () => {
    const { cache, fetched } = makeCache({ banks: twoBanks(), budgetClips: 1 });
    await cache.preload(samples(['talk/a.wav'], false));
    await cache.get('talk/b.wav');
    expect(files(fetched)).toEqual(['banks/talk-0.lossless.bin', 'talk/b.flac']);
  });

  it('fetches an app asset at its own path in either quality, bypassing the banks', async () => {
    for (const quality of SOUND_QUALITIES) {
      const { cache, fetched } = makeCache({ banks: twoBanks(), quality });
      expect(await cache.get('/audio/mace.ogg')).not.toBeNull();
      expect(files(fetched)).toEqual(['/audio/mace.ogg']);
    }
  });

  it('loads a clip from its own file when its bank fails to arrive', async () => {
    const { cache, fetched } = makeCache({ banks: twoBanks(), missing: 'banks/gui-0.lossless.bin' });
    const report = await cache.preload(samples(['gui/click.wav'], true));
    expect(files(fetched)).toEqual(['banks/gui-0.lossless.bin', 'gui/click.flac']);
    expect(report.decoded).toBe(1);
  });

  it('loads each clip from its own file while the index is missing, asking for the index again', async () => {
    const { cache, fetched } = makeCache({ banks: null });
    const report = await cache.preload(samples(['gui/click.wav'], true));
    expect(report.decoded).toBe(1);
    expect(await cache.get('talk/a.wav')).not.toBeNull();
    expect(fetched).toEqual([
      SOUND_BANKS_FILE,
      SOUND_BANKS_FILE,
      'gui/click.flac',
      SOUND_BANKS_FILE,
      'talk/a.flac',
    ]);
  });

  it('recovers the banks after a transient index failure', async () => {
    const { cache, fetched } = makeCache({ banks: twoBanks(), indexFailures: 1 });
    await settle();
    const report = await cache.preload(samples(['talk/a.wav', 'talk/b.wav'], true));
    expect(report.decoded).toBe(2);
    expect(fetched).toEqual([SOUND_BANKS_FILE, SOUND_BANKS_FILE, 'banks/talk-0.lossless.bin']);
  });

  it('serves a lossless-only clip as FLAC in the compact quality', async () => {
    const { cache, fetched } = makeCache({
      banks: { ...twoBanks(), losslessOnly: ['talk/a.wav'] },
      quality: 'compact',
    });
    await cache.get('talk/a.wav');
    await cache.get('talk/b.wav');
    expect(files(fetched)).toEqual(['talk/a.flac', 'talk/b.ogg']);
  });
});

describe('SampleCache compact fallback', () => {
  it('moves to lossless for the session once a compact clip fails to decode, warning once', async () => {
    const { cache, fetched, warnings } = makeCache({
      banks: twoBanks(),
      quality: 'compact',
      noCompactDecoder: true,
      concurrency: 1,
    });
    const report = await cache.preload(samples(['gui/click.wav', 'gui/fail.wav'], true));
    expect(report).toMatchObject({ decoded: 2, failed: 0 });
    expect(await cache.get('talk/a.wav')).not.toBeNull();
    expect(files(fetched)).toEqual([
      'banks/gui-0.compact.bin',
      'gui/click.flac',
      'banks/gui-0.lossless.bin',
      'talk/a.flac',
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/lossless/);
  });

  it('fails only a corrupt compact clip when the browser decodes Ogg Opus, probing once', async () => {
    const { cache, fetched, warnings, oggDecodes } = makeCache({
      banks: twoBanks(),
      quality: 'compact',
      corrupt: 'talk/a.ogg',
    });
    expect(await cache.get('talk/a.wav')).toBeNull();
    expect(await cache.get('talk/b.wav')).not.toBeNull();
    expect(await cache.get('gui/click.wav')).not.toBeNull();
    expect(files(fetched)).toEqual(['talk/a.ogg', 'talk/b.ogg', 'gui/click.ogg']);
    expect(oggDecodes).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('treats an empty buffer from compact bytes as a failed decode and moves to lossless', async () => {
    const { cache, fetched, warnings } = makeCache({
      banks: twoBanks(),
      quality: 'compact',
      emptyCompactDecoder: true,
    });
    expect((await cache.get('talk/a.wav'))?.length).toBe(CLIP_FRAMES);
    expect(files(fetched)).toEqual(['talk/a.ogg', 'talk/a.flac']);
    expect(warnings).toHaveLength(1);
  });

  it('fails a clip that decodes to no samples instead of caching the empty buffer', async () => {
    const { cache, fetched } = makeCache({ banks: twoBanks(), quality: 'lossless', empty: 'talk/a.flac' });
    expect(await cache.get('talk/a.wav')).toBeNull();
    expect(await cache.get('talk/a.wav')).toBeNull();
    expect(cache.bytes).toBe(0);
    expect(files(fetched)).toEqual(['talk/a.flac']);
  });

  it('stays compact when a clip fails to arrive rather than to decode', async () => {
    const { cache, fetched, warnings } = makeCache({
      banks: twoBanks(),
      quality: 'compact',
      missing: 'talk/a.ogg',
    });
    expect(await cache.get('talk/a.wav')).toBeNull();
    await cache.get('talk/b.wav');
    expect(files(fetched)).toEqual(['talk/a.ogg', 'talk/b.ogg']);
    expect(warnings).toEqual([]);
  });
});
