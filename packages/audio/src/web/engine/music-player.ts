import {
  cueLoops,
  cuePlaySeconds,
  type MusicCue,
  type MusicSequence,
  type MusicTiming,
  passBoundaryAfter,
} from '../../data/music/index.js';
import type { FetchBytes } from '../platform.js';
import { CLICK_FREE_RAMP_S } from './ramps.js';

/**
 * The music half of playback: it plays a sequence's cues one after another, each for its passes of
 * the region the pipeline published (the music stage owns the evidence for why segments repeat
 * seamlessly), at the track's levelling gain, ending on its fade and the next cue's silence. The menu
 * hands it a fixed rotation, a map its playlist.
 */

/**
 * Replacing the music: the original starts the new segment immediately as the primary segment and
 * lets the old one's note releases and reverb ring under it (original behavior: no wait for a
 * segment boundary). A rendered file cannot ring its tail out, so a short fade stands in for it.
 */
export const MUSIC_SWITCH_TIMING: MusicTiming = { fadeS: 1.5, gapS: 0 };

/** Muting or tearing down: the original stops at once and lets the tail ring; the same stand-in fade. */
export const MUSIC_STOP_FADE_S = 1.5;

/** Decoded tracks kept for re-use (current + the previous one a mood flip returns to). */
const BUFFER_CACHE_SIZE = 2;

interface PlayingCue {
  readonly cue: MusicCue;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  /** The track's levelling gain as a linear factor. */
  readonly level: number;
  readonly bufferS: number;
  /** Context time the source becomes audible; before it, the cue is still waiting out its silence. */
  readonly startsAt: number;
  /** Context time the cue reaches silence and stops. */
  endsAt: number;
}

export class MusicPlayer {
  private current: PlayingCue | null = null;
  /** The sequence the latest {@link play} asked for; null after a stop. */
  private sequence: MusicSequence | null = null;
  /** A cue's load is in flight. */
  private loading = false;
  /** Set once the sequence offered nothing playable, so re-asserting it does nothing. */
  private unplayable = false;
  /** Bumped by every play, interruption and stop; an async load only installs itself if it still holds
   *  the last stamp, so overlapping loads cannot install two sources. */
  private generation = 0;
  /** file → decoded buffer, most-recently-used last. */
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Files whose fetch/decode failed, so no sequence makes the player fetch one twice. A failed file
   *  also leaves its sequence through `drop`, for that sequence's lifetime. */
  private readonly failed = new Set<string>();
  /** Context time the last cue faded out reaches silence. A fade outlives {@link current}, so this is
   *  what a later handover has to wait for rather than opening over an audible tail. */
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

  /** Play `sequence` from its next cue, fading out whatever else plays; re-asserting the running
   *  sequence keeps it going. Null stops. */
  play(sequence: MusicSequence | null): void {
    if (sequence === null) {
      if (this.sequence !== null || this.current !== null) this.stop();
      return;
    }
    if (sequence === this.sequence && (this.current !== null || this.loading || this.unplayable)) return;
    this.sequence = sequence;
    this.unplayable = false;
    this.switchNow();
  }

  /** Cut over to the sequence's next cue now, the running one fading out first. */
  interrupt(): void {
    if (this.sequence === null) return;
    this.switchNow();
  }

  /** End the running cue at its next pass boundary that leaves room for its fade, rather than after
   *  all its passes; the sequence's next cue follows as usual. */
  endAtPassEnd(): void {
    const playing = this.current;
    const now = this.ctx.currentTime;
    if (playing === null || playing.startsAt > now) return;
    const { cue, gain, level, source } = playing;
    const boundary = passBoundaryAfter(cue.track, playing.bufferS, playing.startsAt, now + cue.fadeS);
    if (boundary >= playing.endsAt) return;
    // Before the boundary's fade the cue's own end fade has not begun either, so it sits at its level.
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(level, now);
    gain.gain.setValueAtTime(level, boundary - cue.fadeS);
    gain.gain.linearRampToValueAtTime(0, boundary);
    playing.endsAt = boundary;
    source.stop(boundary);
  }

  /** Fade out and drop the running cue (mute / teardown); the sequence is forgotten. */
  stop(): void {
    this.sequence = null;
    this.loading = false;
    this.unplayable = false;
    this.generation++;
    this.fadeOutCurrent(MUSIC_STOP_FADE_S);
  }

  private switchNow(): void {
    this.generation++;
    this.fadeOutCurrent(MUSIC_SWITCH_TIMING.fadeS);
    // A tail from this fade - or from an earlier stop still running - has to finish before the
    // replacement opens, or the two play at once. A cut-in skips the cue's own silence.
    const now = this.ctx.currentTime;
    this.startNext(this.silentUntil > now ? this.silentUntil + MUSIC_SWITCH_TIMING.gapS : now, false);
  }

  /** Load and schedule the sequence's next cue to open at `openAfter`, plus its silence when asked. */
  private startNext(openAfter: number, withSilence: boolean): void {
    const cue = this.sequence?.next() ?? null;
    // A sequence offering a file that already failed would otherwise be pulled from in a tight loop.
    if (cue === null || this.failed.has(cue.track.file)) {
      // Nothing playable is left. Hold the sequence rather than forgetting it, so the next re-assert
      // of the same one returns early instead of pulling from it frame after frame.
      this.loading = false;
      this.unplayable = true;
      return;
    }
    this.start(cue, openAfter + (withSilence ? cue.gapBeforeS : 0), this.generation);
  }

  /** Silence the running cue, recording in {@link silentUntil} when it stops being audible. */
  private fadeOutCurrent(fadeS: number): void {
    const now = this.ctx.currentTime;
    const playing = this.current;
    if (playing === null) return;
    this.current = null;
    // A cue still waiting out its silence was never heard; drop it rather than fade silence.
    const silentAt = playing.startsAt > now ? now : Math.min(now + fadeS, playing.endsAt);
    // Read the live level before cancelling: cancelling first drops the ramp event this anchor is
    // meant to capture, which would restart the fade from full gain.
    const level = playing.gain.gain.value;
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(level, now);
    if (silentAt > now) playing.gain.gain.linearRampToValueAtTime(0, silentAt);
    try {
      playing.source.stop(silentAt);
    } catch {
      // Already stopped - nothing to do.
    }
    this.silentUntil = Math.max(this.silentUntil, silentAt);
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
      this.failed.add(file); // remember the failure - a re-play must not re-fetch
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

  private start(cue: MusicCue, openAt: number, generation: number): void {
    const { track } = cue;
    this.loading = true;
    void this.load(track.file).then((buffer) => {
      if (generation !== this.generation) return; // a newer play/interrupt/stop superseded this load
      this.loading = false;
      if (buffer === null) {
        // A track that cannot load leaves the sequence; the others carry on without it.
        this.sequence?.drop(track.file);
        this.startNext(openAt, false);
        return;
      }
      if (!this.canPlay()) {
        // Dropped without a stop() (context suspended externally): forget the sequence so a later
        // resume re-assert starts it again instead of hitting the already-playing early return.
        this.sequence = null;
        return;
      }
      const startsAt = Math.max(this.ctx.currentTime, openAt);
      const playS = cuePlaySeconds(track, cue.passes, buffer.duration);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const gain = this.ctx.createGain();
      source.connect(gain).connect(this.out);
      const level = 10 ** (track.gainDb / 20);
      const playing: PlayingCue = {
        cue,
        source,
        gain,
        level,
        bufferS: buffer.duration,
        startsAt,
        endsAt: startsAt + playS,
      };
      source.onended = (): void => {
        // Before the generation guard: a superseded cue is exactly the one whose nodes would
        // otherwise stay connected to the music bus for the rest of the session.
        source.disconnect();
        gain.disconnect();
        if (generation !== this.generation || this.current !== playing) return; // stopped or superseded
        this.current = null;
        this.silentUntil = Math.max(this.silentUntil, playing.endsAt);
        this.startNext(Math.max(this.ctx.currentTime, playing.endsAt), true);
      };
      if (cueLoops(track, cue.passes, buffer.duration)) {
        source.loop = true;
        source.loopStart = track.loopStartS;
        source.loopEnd = Math.min(track.loopEndS, buffer.duration);
      }
      gain.gain.setValueAtTime(0, startsAt);
      gain.gain.linearRampToValueAtTime(level, startsAt + CLICK_FREE_RAMP_S);
      // Land on silence at the last sample played, so nothing is cut mid-level.
      gain.gain.setValueAtTime(level, Math.max(startsAt + CLICK_FREE_RAMP_S, playing.endsAt - cue.fadeS));
      gain.gain.linearRampToValueAtTime(0, playing.endsAt);
      source.start(startsAt, 0, playS);
      this.current = playing;
    });
  }
}
