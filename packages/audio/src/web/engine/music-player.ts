import type { MusicTrack } from '../../data/music/index.js';
import type { FetchBytes } from '../platform.js';

/**
 * The music half of playback. In game the map's track ring-loops the region the pipeline published
 * (the music stage owns the evidence for why segments repeat seamlessly). The menu instead rotates
 * a queue of tracks, each playing its first pass once with a parting fade and gap - a design choice
 * of this reimplementation.
 */

/** How a rotation track hands over to the next one. */
export interface MusicTiming {
  /** Seconds the outgoing track takes to reach silence, ending on the last sample it plays. */
  readonly fadeS: number;
  /** Seconds of silence between the outgoing track and the next. */
  readonly gapS: number;
}

/** Menu rotation handover. The rotation itself is this reimplementation's design, not original behaviour. */
export const MENU_MUSIC_TIMING: MusicTiming = { fadeS: 2, gapS: 1.5 };

/**
 * Replacing the track: the original starts the new segment immediately as the primary segment and
 * lets the old one's note releases and reverb ring under it (byte evidence: `PlaySegmentEx` with no
 * boundary flags). A rendered file cannot ring its tail out, so a short fade stands in for it.
 */
export const MUSIC_SWITCH_TIMING: MusicTiming = { fadeS: 1.5, gapS: 0 };

/** Muting or tearing down: the original stops at once and lets the tail ring; the same stand-in fade. */
export const MUSIC_STOP_FADE_S = 1.5;

/** Decoded tracks kept for re-use (current + the previous one a mood flip returns to). */
const BUFFER_CACHE_SIZE = 2;

/** `set` loops its single track seamlessly; `setRotation` advances through its queue. */
type MusicMode = 'loop' | 'rotation';

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
  /** Files whose fetch/decode failed, so one request never re-fetches them. Cleared by {@link stop},
   *  which is the mute or map change that gives a track dropped by a network blip another chance. */
  private readonly failed = new Set<string>();
  /** The tracks the latest reconcile asked for. A failed load leaves {@link queue} but not this, so a
   *  re-assert of the same request is still recognised as unchanged. */
  private desired: readonly MusicTrack[] = [];
  /** Set once every entry of {@link desired} has failed to load, so re-asserting it does nothing. */
  private unplayable = false;
  /** The tracks still playable; the loop mode holds one, the rotation plays them one at a time. */
  private queue: readonly MusicTrack[] = [];
  /** Index in {@link queue} of the entry playing or loading. */
  private queueAt = 0;
  private mode: MusicMode = 'loop';
  /** Context time the next track may open at: when the outgoing one fell silent, plus the gap. */
  private openAt = 0;
  /** Context time the last track faded out reaches silence. A fade outlives {@link current}, so this
   *  is what a later handover has to wait for rather than opening over an audible tail. */
  private silentUntil = 0;

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

  /** Reconcile playback to `track`, looping it seamlessly until replaced; null stops. */
  set(track: MusicTrack | null): void {
    this.reconcile(track === null ? [] : [track], 'loop');
  }

  /** Reconcile playback to `tracks` in order; a running queue of the same tracks keeps going. */
  setRotation(tracks: readonly MusicTrack[]): void {
    this.reconcile(tracks, 'rotation');
  }

  /** Fade out and drop the running track (mute / teardown); the desired track is forgotten. */
  stop(): void {
    this.queue = [];
    this.desired = [];
    this.desiredFile = null;
    this.unplayable = false;
    this.failed.clear();
    this.generation++;
    this.fadeOutCurrent(MUSIC_STOP_FADE_S);
  }

  private reconcile(tracks: readonly MusicTrack[], mode: MusicMode): void {
    if (tracks.length === 0) {
      if (this.desired.length > 0 || this.current !== null) this.stop();
      return;
    }
    const unchanged =
      mode === this.mode &&
      tracks.length === this.desired.length &&
      tracks.every((track, i) => track.file === this.desired[i]?.file);
    // Playing, still loading, or already proven unplayable: re-asserting it every frame has nothing to do.
    if (unchanged && (this.desiredFile !== null || this.unplayable)) return;
    this.mode = mode;
    this.desired = tracks;
    this.queue = tracks;
    this.unplayable = false;
    this.queueAt = 0;
    this.generation++;
    this.fadeOutCurrent(MUSIC_SWITCH_TIMING.fadeS);
    // A tail from this fade - or from an earlier stop still running - has to finish before the
    // replacement opens, or the two play at once.
    const now = this.ctx.currentTime;
    this.openAt = this.silentUntil > now ? this.silentUntil + MUSIC_SWITCH_TIMING.gapS : now;
    this.startQueued();
  }

  /** Move to the next rotation entry once the current one has played out, wrapping at the end. */
  private advance(): void {
    this.queueAt += 1;
    this.openAt = this.ctx.currentTime + MENU_MUSIC_TIMING.gapS;
    this.startQueued();
  }

  private startQueued(): void {
    if (this.queue.length > 0) this.queueAt %= this.queue.length;
    const track = this.queue[this.queueAt];
    if (track === undefined) {
      // Every entry failed to load. Hold the desire rather than forgetting it, so the next re-assert
      // of the same request returns early instead of rebuilding the queue frame after frame.
      this.unplayable = true;
      this.desiredFile = null;
      return;
    }
    this.desiredFile = track.file;
    this.start(track, this.generation);
  }

  /** Silence the running track, recording in {@link silentUntil} when it stops being audible. */
  private fadeOutCurrent(fadeS: number): void {
    const now = this.ctx.currentTime;
    const current = this.current;
    if (current === null) return;
    this.current = null;
    // A track still waiting out its gap was never heard; drop it rather than fade silence.
    const silentAt = current.startsAt > now ? now : now + fadeS;
    // Read the live level before cancelling: cancelling first drops the ramp event this anchor is
    // meant to capture, which would restart the fade from full gain.
    const level = current.gain.gain.value;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(level, now);
    if (silentAt > now) current.gain.gain.linearRampToValueAtTime(0, silentAt);
    try {
      current.source.stop(silentAt);
    } catch {
      // Already stopped - nothing to do.
    }
    this.silentUntil = silentAt;
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
    } catch (err) {
      this.failed.add(file); // remember the failure - a re-set must not re-fetch
      // Silence is what a missing track sounds like either way, so say which file went missing.
      console.warn(`[audio] music track ${file} failed to load: ${String(err)}`);
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
        // A track that cannot load leaves the queue; the others carry on without it.
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
        // Before the generation guard: a superseded track is exactly the one whose nodes would
        // otherwise stay connected to the music bus for the rest of the session.
        source.disconnect();
        gain.disconnect();
        if (generation !== this.generation) return; // stopped or superseded, not finished
        this.current = null;
        if (this.mode === 'rotation') this.advance();
        else this.startQueued(); // a looping source never finishes on its own; restart if one somehow does
      };
      const gain = this.ctx.createGain();
      source.connect(gain).connect(this.out);
      if (this.mode === 'loop') {
        this.configureLoop(source, track, buffer);
        source.start(startsAt);
      } else {
        const passS = firstPassSeconds(track, buffer);
        this.scheduleFadeOut(gain, startsAt, passS);
        source.start(startsAt, 0, passS);
      }
      this.current = { file: track.file, source, gain, startsAt };
    });
  }

  /** Ring-loop the published region: the first pass opens from silence, then the second pass -
   *  which carries the first's decay tails - repeats seamlessly. Without published points (an older
   *  manifest) the whole file loops, losing only the tail carry-over. */
  private configureLoop(source: AudioBufferSourceNode, track: MusicTrack, buffer: AudioBuffer): void {
    source.loop = true;
    if (
      track.loopStartS !== undefined &&
      track.loopEndS !== undefined &&
      track.loopStartS < buffer.duration
    ) {
      source.loopStart = track.loopStartS;
      source.loopEnd = Math.min(track.loopEndS, buffer.duration);
    }
  }

  /** Ramp a rotation track down over its last seconds, so it ends on silence rather than on a cut. */
  private scheduleFadeOut(gain: GainNode, startsAt: number, durationS: number): void {
    const endsAt = startsAt + durationS;
    gain.gain.setValueAtTime(1, Math.max(startsAt, endsAt - MENU_MUSIC_TIMING.fadeS));
    gain.gain.linearRampToValueAtTime(0, endsAt);
  }
}

/** A rotation entry plays the first pass only; the parting fade stands in for the tails the file
 *  carries only under the second pass. */
function firstPassSeconds(track: MusicTrack, buffer: AudioBuffer): number {
  const { loopStartS } = track;
  return loopStartS !== undefined && loopStartS > 0 && loopStartS < buffer.duration
    ? loopStartS
    : buffer.duration;
}
