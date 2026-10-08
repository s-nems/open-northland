import type { FetchBytes } from '../platform.js';

/** Decoded PCM is float32: each sample frame costs this many bytes per channel. */
export const DECODED_BYTES_PER_SAMPLE = 4;

/**
 * The most decoded audio the cache keeps, in bytes. The whole bank decodes to about 240 MB at a
 * 48 kHz context, so past this the least recently played unpinned wav goes first. Approximation: room
 * for the pinned tiers (about 80 MB at 48 kHz) plus a working set of talk and beds.
 */
export const SAMPLE_CACHE_BUDGET_BYTES = 128 * 1024 * 1024;

/** Wavs a preload fetches and decodes at once: enough to keep the network busy, few enough that a
 *  click's own load is not queued behind a long burst. */
export const PRELOAD_CONCURRENCY = 4;

/** One wav a preload loads, and whether the cache keeps it for good. */
export interface PreloadSample {
  readonly file: string;
  readonly pinned: boolean;
}

/** What a finished preload left in the cache. */
export interface SamplePreloadReport {
  /** Wavs the preload decoded itself (a wav already cached or loading counts as neither). */
  readonly decoded: number;
  /** Wavs whose fetch or decode failed. */
  readonly failed: number;
  /** Unpinned wavs left out because the cache had reached its budget. */
  readonly skipped: number;
  /** Decoded bytes the cache holds now, pinned and unpinned. */
  readonly cachedBytes: number;
  /** Of {@link cachedBytes}, the bytes that are never evicted. */
  readonly pinnedBytes: number;
}

export interface SampleCacheOptions {
  /** Default {@link SAMPLE_CACHE_BUDGET_BYTES}. */
  readonly budgetBytes?: number;
  /** Default {@link PRELOAD_CONCURRENCY}. */
  readonly concurrency?: number;
}

/** A decoded buffer's memory: length x channels x {@link DECODED_BYTES_PER_SAMPLE}. */
export function decodedBytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * DECODED_BYTES_PER_SAMPLE;
}

/**
 * The fetch+decode cache for wav samples: each file is loaded and decoded at most once while cached,
 * concurrent requests share the in-flight promise, and a failure is memoised as null so a missing wav
 * never spams the network. Decoding on the playing context resamples each wav to its rate once. Past
 * the byte budget the least recently played unpinned wav is dropped and loads again on its next play.
 * Owned by the engine (decoding needs its `AudioContext`).
 */
export class SampleCache {
  /** file → decoded buffer (or an in-flight promise; a null result means load failed - don't retry). */
  private readonly entries = new Map<string, AudioBuffer | null | Promise<AudioBuffer | null>>();
  /** Decoded unpinned files → their bytes, least recently played first. */
  private readonly evictable = new Map<string, number>();
  private readonly pinned = new Set<string>();
  private cached = 0;
  private pinnedCached = 0;
  /** Wavs dropped for the budget so far; a preload stops adding unpinned ones once this moves. */
  private evictions = 0;
  private readonly budgetBytes: number;
  private readonly concurrency: number;

  constructor(
    /** URL prefix the wav files are served under (a file path is appended). */
    private readonly baseUrl: string,
    private readonly fetchBytes: FetchBytes,
    /** Decode raw wav bytes into a playable buffer (the context's `decodeAudioData`). */
    private readonly decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>,
    options: SampleCacheOptions = {},
  ) {
    this.budgetBytes = options.budgetBytes ?? SAMPLE_CACHE_BUDGET_BYTES;
    this.concurrency = options.concurrency ?? PRELOAD_CONCURRENCY;
  }

  /** Decoded bytes held now. */
  get bytes(): number {
    return this.cached;
  }

  /** The decoded buffer for `file`, fetched on first use; null once its load has ever failed. A play
   *  marks the wav as the most recently used. */
  get(file: string): Promise<AudioBuffer | null> {
    const size = this.evictable.get(file);
    if (size !== undefined) {
      this.evictable.delete(file);
      this.evictable.set(file, size);
    }
    return this.load(file);
  }

  /** The decoded length of `file` in seconds, or undefined while it is unloaded, loading or failed. */
  duration(file: string): number | undefined {
    const entry = this.entries.get(file);
    return entry === undefined || entry === null || entry instanceof Promise ? undefined : entry.duration;
  }

  /**
   * Load `samples` in order, {@link SampleCacheOptions.concurrency} at a time. Pinned wavs always load
   * and stay; unpinned ones stop once the cache reaches its budget or first evicts, so a preload never
   * churns through what it just decoded.
   */
  async preload(samples: readonly PreloadSample[]): Promise<SamplePreloadReport> {
    const evictionsBefore = this.evictions;
    const full = (): boolean => this.cached >= this.budgetBytes || this.evictions !== evictionsBefore;
    let next = 0;
    let decoded = 0;
    let failed = 0;
    let skipped = 0;
    const worker = async (): Promise<void> => {
      for (let i = next++; i < samples.length; i = next++) {
        const sample = samples[i];
        if (sample === undefined) continue;
        if (sample.pinned) this.pin(sample.file);
        if (this.entries.has(sample.file)) continue;
        if (!sample.pinned && full()) {
          skipped++;
          continue;
        }
        if ((await this.load(sample.file)) === null) failed++;
        else decoded++;
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, this.concurrency) }, worker));
    return { decoded, failed, skipped, cachedBytes: this.cached, pinnedBytes: this.pinnedCached };
  }

  /** Keep `file` for good; a wav already decoded leaves the eviction order. */
  private pin(file: string): void {
    if (this.pinned.has(file)) return;
    this.pinned.add(file);
    const size = this.evictable.get(file);
    if (size === undefined) return;
    this.evictable.delete(file);
    this.pinnedCached += size;
  }

  private load(file: string): Promise<AudioBuffer | null> {
    const cached = this.entries.get(file);
    if (cached !== undefined) return Promise.resolve(cached); // a buffer, a cached-null failure, or an in-flight promise
    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const bytes = await this.fetchBytes(this.baseUrl + file);
        const buffer = await this.decode(bytes);
        this.store(file, buffer);
        return buffer;
      } catch {
        this.entries.set(file, null); // remember the failure - don't re-fetch
        return null;
      }
    })();
    this.entries.set(file, promise);
    return promise;
  }

  private store(file: string, buffer: AudioBuffer): void {
    this.entries.set(file, buffer);
    const size = decodedBytes(buffer);
    this.cached += size;
    if (this.pinned.has(file)) {
      this.pinnedCached += size;
      return;
    }
    this.evictable.set(file, size);
    // The newest stays even over budget: its caller is about to play it.
    while (this.cached > this.budgetBytes && this.evictable.size > 1) {
      const oldest = this.evictable.keys().next().value;
      if (oldest === undefined) break;
      this.cached -= this.evictable.get(oldest) ?? 0;
      this.evictable.delete(oldest);
      this.entries.delete(oldest);
      this.evictions++;
    }
  }
}
