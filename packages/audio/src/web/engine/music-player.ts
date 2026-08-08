import type { MusicTrack } from '../../data/music.js';
import type { FetchBytes } from '../platform.js';

/**
 * The one-track music half of playback: play the desired track's intro once, then loop its tail
 * forever, crossfading when the desired track changes.
 */

/** Track changes crossfade over this many seconds. Approximation - DirectMusic transitions are
 *  bar-aligned, which a rendered file cannot reproduce. */
export const MUSIC_FADE_S = 1.5;

/** Decoded tracks kept for re-use (current + the previous one a mood flip returns to). */
const BUFFER_CACHE_SIZE = 2;

interface PlayingTrack {
  readonly file: string;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

export class MusicPlayer {
  private current: PlayingTrack | null = null;
  /** The file the latest {@link set} asked for. */
  private desiredFile: string | null = null;
  /** Bumped by every set/stop; an async load only installs itself if it still holds the last stamp,
   *  so overlapping loads of even the same file cannot install two looping sources. */
  private generation = 0;
  /** file → decoded buffer, most-recently-used last. */
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Files whose fetch/decode failed - never re-fetched (a resume/enable re-set would loop otherwise). */
  private readonly failed = new Set<string>();

  constructor(
    private readonly ctx: AudioContext,
    /** The node tracks play into (the engine's music bus). */
    private readonly out: AudioNode,
    /** URL prefix the music files are served under (a file path is appended). */
    private readonly baseUrl: string,
    private readonly fetchBytes: FetchBytes,
    /** Playback gate, re-checked when an async load lands (a mute can arrive while a track is in flight). */
    private readonly canPlay: () => boolean,
  ) {}

  /** Reconcile playback to `track`: keep it when already playing or loading, crossfade when it changed. */
  set(track: MusicTrack | null): void {
    if (track === null) {
      this.stop();
      return;
    }
    if (this.desiredFile === track.file) return; // playing or already loading
    this.desiredFile = track.file;
    this.generation++;
    this.fadeOutCurrent();
    this.start(track, this.generation);
  }

  /** Fade out and drop the running track (mute / teardown); the desired track is forgotten. */
  stop(): void {
    this.desiredFile = null;
    this.generation++;
    this.fadeOutCurrent();
  }

  private fadeOutCurrent(): void {
    const current = this.current;
    if (current === null) return;
    this.current = null;
    const now = this.ctx.currentTime;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(current.gain.gain.value, now);
    current.gain.gain.linearRampToValueAtTime(0, now + MUSIC_FADE_S);
    try {
      current.source.stop(now + MUSIC_FADE_S);
    } catch {
      // Already stopped - nothing to do.
    }
  }

  private async load(file: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(file);
    if (cached !== undefined) {
      this.buffers.delete(file); // re-insert as most recent
      this.buffers.set(file, cached);
      return cached;
    }
    if (this.failed.has(file)) return null;
    let buffer: AudioBuffer;
    try {
      buffer = await this.ctx.decodeAudioData(await this.fetchBytes(this.baseUrl + file));
    } catch {
      this.failed.add(file); // remember the failure - a re-set must not re-fetch
      return null;
    }
    this.buffers.set(file, buffer);
    for (const key of this.buffers.keys()) {
      if (this.buffers.size <= BUFFER_CACHE_SIZE) break;
      this.buffers.delete(key);
    }
    return buffer;
  }

  private start(track: MusicTrack, generation: number): void {
    void this.load(track.file).then((buffer) => {
      if (generation !== this.generation) return; // a newer set/stop superseded this load
      if (buffer === null) return;
      if (!this.canPlay()) {
        // Dropped without a stop() (context suspended externally): forget the desire so a later
        // set/resume re-assert retries instead of hitting the already-loading early return.
        if (this.desiredFile === track.file) this.desiredFile = null;
        return;
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      // loopEnd stays 0 = the buffer's end; playback starts at 0 so the intro plays once.
      if (track.loopStartS !== undefined) source.loopStart = track.loopStartS;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.out);
      source.start();
      const now = this.ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + MUSIC_FADE_S);
      this.current = { file: track.file, source, gain };
    });
  }
}
