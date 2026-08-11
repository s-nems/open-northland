import type { MusicTrack } from '../../data/music/index.js';
import type { FetchBytes } from '../platform.js';

/**
 * The music half of playback: a queue of tracks played through one at a time, wrapping at the end.
 * In game the queue holds the map's single track, so that one track comes round again.
 */

/** How a track hands over to the next one. */
export interface MusicTiming {
  /** Seconds the outgoing track takes to reach silence, ending on its last sample. */
  readonly fadeS: number;
  /** Seconds of silence between the outgoing track and the next. */
  readonly gapS: number;
}

/**
 * Approximation: a rendered file cannot rejoin its own loop the way the original's sequencer repeats
 * a segment, so whole passes are parted with a fade and a gap instead. The game leaves room between
 * them; the menu parts sooner, so its screen is not silent for long.
 */
export const GAME_MUSIC_TIMING: MusicTiming = { fadeS: 4, gapS: 5 };
export const MENU_MUSIC_TIMING: MusicTiming = { fadeS: 2, gapS: 1.5 };

/** Muting or tearing down is not a handover: the track only has to get out of the way. */
export const MUSIC_STOP_FADE_S = 1.5;

/** Decoded tracks kept for re-use (current + the previous one a mood flip returns to). */
const BUFFER_CACHE_SIZE = 2;

interface PlayingTrack {
  readonly file: string;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  /** Context time the source becomes audible; before it, the track is still waiting out the gap. */
  readonly startsAt: number;
}

export class MusicPlayer {
  private current: PlayingTrack | null = null;
  /** The file the latest reconcile asked for. */
  private desiredFile: string | null = null;
  /** Bumped by every reconcile and stop; an async load only installs itself if it still holds the
   *  last stamp, so overlapping loads of even the same file cannot install two sources. */
  private generation = 0;
  /** file → decoded buffer, most-recently-used last. */
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Files whose fetch/decode failed - never re-fetched (a resume/enable re-set would loop otherwise). */
  private readonly failed = new Set<string>();
  /** The tracks being played one at a time. */
  private queue: readonly MusicTrack[] = [];
  /** Index in {@link queue} of the entry playing or loading. */
  private queueAt = 0;
  private timing: MusicTiming = GAME_MUSIC_TIMING;
  /** Context time the next track may open at: when the outgoing one fell silent, plus the gap. */
  private openAt = 0;

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

  /** Reconcile playback to `track`, which plays through and then comes round again; null stops. */
  set(track: MusicTrack | null): void {
    this.reconcile(track === null ? [] : [track], GAME_MUSIC_TIMING);
  }

  /** Reconcile playback to `tracks` in order; a running queue of the same tracks keeps going. */
  setRotation(tracks: readonly MusicTrack[]): void {
    this.reconcile(tracks, MENU_MUSIC_TIMING);
  }

  /** Fade out and drop the running track (mute / teardown); the desired track is forgotten. */
  stop(): void {
    this.queue = [];
    this.desiredFile = null;
    this.generation++;
    this.fadeOutCurrent(MUSIC_STOP_FADE_S);
  }

  private reconcile(tracks: readonly MusicTrack[], timing: MusicTiming): void {
    const unchanged =
      timing === this.timing &&
      tracks.length === this.queue.length &&
      tracks.every((track, i) => track.file === this.queue[i]?.file);
    if (unchanged && this.desiredFile !== null) return; // playing or already loading
    if (tracks.length === 0) {
      this.stop();
      return;
    }
    this.timing = timing;
    this.queue = tracks;
    this.queueAt = 0;
    this.generation++;
    // Only a track that has to make way earns the gap; with nothing playing the first one opens now.
    const silentAt = this.fadeOutCurrent(timing.fadeS);
    this.openAt = silentAt === null ? this.ctx.currentTime : silentAt + timing.gapS;
    this.startQueued();
  }

  /** Move to the next entry once the current one has played out, wrapping at the end. */
  private advance(): void {
    this.queueAt += 1;
    this.openAt = this.ctx.currentTime + this.timing.gapS;
    this.startQueued();
  }

  private startQueued(): void {
    if (this.queue.length === 0) {
      this.stop();
      return;
    }
    this.queueAt %= this.queue.length;
    const track = this.queue[this.queueAt];
    if (track === undefined) {
      this.stop();
      return;
    }
    this.desiredFile = track.file;
    this.start(track, this.generation);
  }

  /** Silence the running track, returning when it falls silent, or null if none was playing. */
  private fadeOutCurrent(fadeS: number): number | null {
    const now = this.ctx.currentTime;
    const current = this.current;
    if (current === null) return null;
    this.current = null;
    // A track still waiting out its gap was never heard; drop it rather than fade silence.
    const silentAt = current.startsAt > now ? now : now + fadeS;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(current.gain.gain.value, now);
    if (silentAt > now) current.gain.gain.linearRampToValueAtTime(0, silentAt);
    try {
      current.source.stop(silentAt);
    } catch {
      // Already stopped - nothing to do.
    }
    return silentAt;
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
      if (generation !== this.generation) return; // a newer reconcile/stop superseded this load
      if (buffer === null) {
        // A track that cannot load leaves the queue, so the retry cannot spin between failures.
        this.queue = this.queue.filter((entry) => entry.file !== track.file);
        this.startQueued();
        return;
      }
      if (!this.canPlay()) {
        // Dropped without a stop() (context suspended externally): forget the desire so a later
        // set/resume re-assert retries instead of hitting the already-loading early return.
        if (this.desiredFile === track.file) this.desiredFile = null;
        return;
      }
      const startsAt = Math.max(this.ctx.currentTime, this.openAt);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.onended = (): void => {
        if (generation !== this.generation) return; // stopped or superseded, not finished
        this.current = null;
        this.advance();
      };
      const gain = this.ctx.createGain();
      source.connect(gain).connect(this.out);
      this.scheduleFadeOut(gain, startsAt, buffer.duration);
      source.start(startsAt);
      this.current = { file: track.file, source, gain, startsAt };
    });
  }

  /** Ramp the track down over its last seconds, so it ends on silence rather than on a cut. */
  private scheduleFadeOut(gain: GainNode, startsAt: number, durationS: number): void {
    const endsAt = startsAt + durationS;
    gain.gain.setValueAtTime(1, Math.max(startsAt, endsAt - this.timing.fadeS));
    gain.gain.linearRampToValueAtTime(0, endsAt);
  }
}
