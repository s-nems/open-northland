import type { MusicTrack } from '../../data/music.js';
import type { FetchBytes } from '../platform.js';

/**
 * The one-track music half of playback: play the desired track's intro once, then loop its tail
 * forever, crossfading when the desired track changes. Loop semantics from the original segments
 * (`segh`: play start 0, infinite repeats, loop region from `mtLoopStart` to the end).
 */

/** Track changes crossfade over this many seconds. Approximation - DirectMusic transitions are
 *  bar-aligned, which a rendered file cannot reproduce. */
export const MUSIC_FADE_S = 1.5;

interface PlayingTrack {
  readonly file: string;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

export class MusicPlayer {
  private current: PlayingTrack | null = null;
  /** The file the latest {@link set} asked for - the stale-load guard for in-flight fetches. */
  private desiredFile: string | null = null;
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

  /** Reconcile playback to `track`: keep it when already playing, crossfade when it changed. */
  set(track: MusicTrack | null): void {
    if (track === null) {
      this.desiredFile = null;
      this.fadeOutCurrent();
      return;
    }
    if (this.desiredFile === track.file) return; // playing or already loading
    this.desiredFile = track.file;
    this.fadeOutCurrent();
    this.start(track);
  }

  /** Fade out and drop the running track (mute / teardown); the desired track is forgotten. */
  stop(): void {
    this.desiredFile = null;
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

  private start(track: MusicTrack): void {
    if (this.failed.has(track.file)) return;
    void (async (): Promise<void> => {
      let buffer: AudioBuffer;
      try {
        buffer = await this.ctx.decodeAudioData(await this.fetchBytes(this.baseUrl + track.file));
      } catch {
        this.failed.add(track.file); // remember the failure - a re-set must not re-fetch
        return;
      }
      // Re-check the gates: a mute or another set() can arrive while the track is in flight.
      if (this.desiredFile !== track.file || !this.canPlay()) return;
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
      gain.gain.linearRampToValueAtTime(1, now + MUSIC_FADE_S);
      this.current = { file: track.file, source, gain };
    })();
  }
}
