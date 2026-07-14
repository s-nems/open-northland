import type { FetchBytes } from '../platform.js';

/**
 * The fetch+decode cache for wav samples: each file is loaded and decoded at most once, concurrent
 * requests share the in-flight promise, and a failure is memoised as null so a missing wav never
 * spams the network. Owned by the engine (decoding needs its `AudioContext`).
 */
export class SampleCache {
  /** file → decoded buffer (or an in-flight promise; a null result means load failed — don't retry). */
  private readonly entries = new Map<string, AudioBuffer | null | Promise<AudioBuffer | null>>();

  constructor(
    /** URL prefix the wav files are served under (a file path is appended). */
    private readonly baseUrl: string,
    private readonly fetchBytes: FetchBytes,
    /** Decode raw wav bytes into a playable buffer (the context's `decodeAudioData`). */
    private readonly decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>,
  ) {}

  /** The decoded buffer for `file`, fetched on first use; null once its load has ever failed. */
  async get(file: string): Promise<AudioBuffer | null> {
    const cached = this.entries.get(file);
    if (cached !== undefined) return cached; // a resolved buffer, a cached-null failure, or an in-flight promise
    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const bytes = await this.fetchBytes(this.baseUrl + file);
        const buffer = await this.decode(bytes);
        this.entries.set(file, buffer);
        return buffer;
      } catch {
        this.entries.set(file, null); // remember the failure — don't re-fetch
        return null;
      }
    })();
    this.entries.set(file, promise);
    return promise;
  }
}
