import type { MusicTrack } from '../../data/music.js';
import type { FetchBytes } from '../platform.js';

/**
 * The music half of playback: either one track, whose intro plays once before its tail loops
 * forever, or a rotation whose entries play through one at a time, in the given order, wrapping at
 * the end. A changed desire crossfades.
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

/** How one track is to be played, decided before its load and never re-read from live state. */
interface StartOptions {
  /** A single track loops its tail forever; a rotation entry plays through and hands over. */
  readonly loop: boolean;
  /** Ramp up over the outgoing track, rather than opening at full gain. */
  readonly fadeIn: boolean;
}

/** What a caller decides; whether the track fades in follows from what it interrupts. */
type TrackMode = Omit<StartOptions, 'fadeIn'>;

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
  /** The rotation being played one entry at a time; empty in single-track mode. */
  private rotation: readonly MusicTrack[] = [];
  /** Index in {@link rotation} of the entry playing or loading. */
  private rotationAt = 0;

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
    // A rotation entry plays through once, so leaving a rotation always restarts the track as a loop.
    const wasRotating = this.rotation.length > 0;
    this.rotation = [];
    if (track === null) {
      this.stop();
      return;
    }
    if (!wasRotating && this.desiredFile === track.file) return; // playing or already loading
    this.startTrack(track, { loop: true });
  }

  /** Reconcile playback to `tracks` in order; a running rotation of the same tracks keeps going. */
  setRotation(tracks: readonly MusicTrack[]): void {
    const unchanged =
      tracks.length === this.rotation.length &&
      tracks.every((track, i) => track.file === this.rotation[i]?.file);
    if (unchanged && this.desiredFile !== null) return; // already rotating these
    if (!unchanged) this.rotationAt = 0;
    this.rotation = tracks;
    this.playRotationEntry();
  }

  /** Fade out and drop the running track (mute / teardown); the desired track is forgotten. */
  stop(): void {
    this.desiredFile = null;
    this.generation++;
    this.fadeOutCurrent();
  }

  /** Move to the next rotation entry, wrapping at the end. */
  private advance(): void {
    this.rotationAt += 1;
    this.playRotationEntry();
  }

  private playRotationEntry(): void {
    if (this.rotation.length === 0) {
      this.stop();
      return;
    }
    this.rotationAt %= this.rotation.length;
    const track = this.rotation[this.rotationAt];
    if (track === undefined) this.stop();
    else this.startTrack(track, { loop: false });
  }

  private startTrack(track: MusicTrack, mode: TrackMode): void {
    this.desiredFile = track.file;
    this.generation++;
    // Only a track that has to cover an outgoing one fades in; anything else opens at full gain
    // rather than creeping in from silence over the fade.
    const fadeIn = this.current !== null;
    this.fadeOutCurrent();
    this.start(track, this.generation, { ...mode, fadeIn });
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

  private start(track: MusicTrack, generation: number, options: StartOptions): void {
    void this.load(track.file).then((buffer) => {
      if (generation !== this.generation) return; // a newer set/stop superseded this load
      if (buffer === null) {
        if (this.rotation.length > 0) {
          // A track that cannot load leaves the rotation, so the retry cannot spin between failures.
          this.rotation = this.rotation.filter((entry) => entry.file !== track.file);
          this.playRotationEntry();
        }
        return;
      }
      if (!this.canPlay()) {
        // Dropped without a stop() (context suspended externally): forget the desire so a later
        // set/resume re-assert retries instead of hitting the already-loading early return.
        if (this.desiredFile === track.file) this.desiredFile = null;
        return;
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      // loopEnd stays 0 = the buffer's end; playback starts at 0 so the intro plays once.
      source.loop = options.loop;
      if (options.loop && track.loopStartS !== undefined) source.loopStart = track.loopStartS;
      source.onended = (): void => {
        if (generation !== this.generation) return; // stopped or superseded, not finished
        this.current = null;
        this.advance();
      };
      const gain = this.ctx.createGain();
      gain.gain.value = options.fadeIn ? 0 : 1;
      source.connect(gain).connect(this.out);
      source.start();
      if (options.fadeIn) {
        const now = this.ctx.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(1, now + MUSIC_FADE_S);
      }
      this.current = { file: track.file, source, gain };
    });
  }
}
