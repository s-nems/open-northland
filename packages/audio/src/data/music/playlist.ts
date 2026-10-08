import type { DiplomacyState } from '@open-northland/sim';
import type { MusicManifest } from './manifest.js';
import { ownCalmStem, ownTenseStem } from './mood.js';
import type { MapMusic, MusicIntensity } from './pools.js';
import type { MusicCue, MusicSequence } from './sequence.js';

/**
 * A map's in-game soundtrack: a rotation over its culture's pools instead of one loop region forever.
 * Calm stretches open on the map's own stem, then alternate silence with shuffle-bag picks from the
 * calm pool, returning to the own stem every second or third cue. Over a long session the silences
 * grow and the own stem comes back less often, so the score thins out instead of wearing on the
 * listener. A fight cuts in at once with the
 * map's own tense stem and holds each tense stem for several passes; calm returns at a pass boundary
 * within {@link CALM_RETURN_MAX_WAIT_S}.
 * The whole rotation is a design choice of this reimplementation (the original rings one segment per
 * map), and every number below is an approximation to tune by ear.
 */

/** Passes a calm cue plays, drawn per cue: one or two passes of a 50-127 s loop region. */
export const CALM_PASSES_MIN = 1;
export const CALM_PASSES_MAX = 2;
/** Seconds a calm cue fades out over before its silence. */
export const CALM_FADE_S = 2.5;
/** Seconds a calm cue rises over from silence, so a rendered file's first downbeat does not punch in. */
export const CALM_FADE_IN_S = 1.5;
/** Silence before each calm cue after the first, drawn per cue, as a session starts. */
export const CALM_SILENCE_MIN_S = 20;
export const CALM_SILENCE_MAX_S = 60;
/** The map's own calm stem comes back every this many calm cues, drawn per return, as a session starts. */
export const OWN_STEM_EVERY_MIN = 2;
export const OWN_STEM_EVERY_MAX = 3;
/** Seconds of a session over which the silences and the own stem's spacing grow, linearly, from their
 *  opening ranges to their long-session ones, which then hold. */
export const LONG_SESSION_S = 30 * 60;
/** Silence before each calm cue once a session has run {@link LONG_SESSION_S}. */
export const LONG_SESSION_SILENCE_MIN_S = 60;
export const LONG_SESSION_SILENCE_MAX_S = 180;
/** How many calm cues apart the own stem comes back once a session has run {@link LONG_SESSION_S}. */
export const LONG_SESSION_OWN_STEM_EVERY_MIN = 3;
export const LONG_SESSION_OWN_STEM_EVERY_MAX = 5;
/** Passes a tense stem holds before the fight rotates to another one. */
export const TENSE_PASSES = 3;
/** Seconds a tense cue fades out over when it hands over to the next tense stem. */
export const TENSE_FADE_S = 1.5;
/** Seconds a tense cue rises over: it cuts in under the outgoing cue's fade, so it lands fast but not
 *  as a click. */
export const TENSE_FADE_IN_S = 0.3;
/** The longest a fight's music plays on once the mood has calmed: the handover waits for a pass end,
 *  but a pass can run two minutes, so past this it fades out wherever it is. */
export const CALM_RETURN_MAX_WAIT_S = 25;

/** A uniform draw in `[0, 1)`. */
export type MusicRandom = () => number;

/** Seconds the session has run. */
export type MusicClock = () => number;

/**
 * What a change of mood asks the player to do with the cue it is playing: nothing, cut over to the
 * next cue now, keep a cue that already fits the fight (calling off a pending pass-end handover), or
 * hand over at the next pass end.
 */
export type MusicTransition = 'none' | 'now' | 'keep' | 'atPassEnd';

/** The frame's mood as the playlist reads it. */
export interface PlaylistMood {
  readonly intensity: MusicIntensity;
  readonly stance: DiplomacyState;
  readonly wealthy: boolean;
}

function randomInt(min: number, max: number, random: MusicRandom): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** `from` moved toward `to` by `share` of the way. */
function lerp(from: number, to: number, share: number): number {
  return from + (to - from) * share;
}

function shuffled<T>(items: readonly T[], random: MusicRandom): T[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = order[i];
    const b = order[j];
    if (a !== undefined && b !== undefined) {
      order[i] = b;
      order[j] = a;
    }
  }
  return order;
}

export class MusicPlaylist implements MusicSequence {
  private mood: PlaylistMood = { intensity: 'calm', stance: 'neutral', wealthy: false };
  /** False until the first cue, which opens on the own stem without silence. */
  private started = false;
  /** Calm cues since the own stem last played, and how many make it due again. */
  private sinceOwn = 0;
  private ownEvery: number;
  /** Set on entering a fight, so its first cue is the map's own tense stem. */
  private freshFight = false;
  /** Audio digest and mood of the last cue handed out, so no stem follows itself. */
  private lastAudio: string | null = null;
  private lastIntensity: MusicIntensity = 'calm';
  /** Each pool's shuffle bag: stems still to play this round, drawn from the end. */
  private readonly bags: Record<MusicIntensity, string[]> = { calm: [], tense: [] };
  private readonly dropped = new Set<string>();

  constructor(
    private readonly music: MapMusic,
    private readonly manifest: MusicManifest,
    private readonly random: MusicRandom,
    private readonly sessionS: MusicClock,
  ) {
    this.ownEvery = this.drawOwnEvery();
  }

  /**
   * Take the frame's mood. Turning tense cuts in now on the own tense stem, unless the last cue
   * already fits a fight (a tense cue still running out its pass, or the own tense stem itself), which
   * is kept; calming waits for the playing pass to end, at most {@link CALM_RETURN_MAX_WAIT_S}.
   */
  update(mood: PlaylistMood): MusicTransition {
    const previous = this.mood.intensity;
    this.mood = mood;
    if (mood.intensity === previous) return 'none';
    if (mood.intensity === 'calm') return 'atPassEnd';
    const ownTense = ownTenseStem(this.music.variants);
    const lastFits =
      this.lastIntensity === 'tense' || (ownTense !== null && this.audioOf(ownTense) === this.lastAudio);
    this.freshFight = !lastFits;
    return lastFits ? 'keep' : 'now';
  }

  next(): MusicCue | null {
    return (this.mood.intensity === 'tense' ? this.tenseCue() : null) ?? this.calmCue();
  }

  drop(file: string): void {
    this.dropped.add(file);
  }

  private tenseCue(): MusicCue | null {
    const own = this.freshFight ? ownTenseStem(this.music.variants) : null;
    this.freshFight = false;
    const ownFits = own !== null && this.playable(own) && this.audioOf(own) !== this.lastAudio;
    const stem = (ownFits ? own : null) ?? this.draw('tense', null);
    return stem === null ? null : this.cue(stem, 'tense', TENSE_PASSES, 0, TENSE_FADE_IN_S, TENSE_FADE_S);
  }

  private calmCue(): MusicCue | null {
    const own = ownCalmStem(this.music.variants, this.mood.stance, this.mood.wealthy);
    const ownPlayable = this.playable(own);
    const ownDue = !this.started || this.sinceOwn + 1 >= this.ownEvery;
    const ownFresh = ownPlayable && this.audioOf(own) !== this.lastAudio;
    let stem: string | null = ownDue && ownFresh ? own : this.draw('calm', ownPlayable ? own : null);
    if (stem === null && ownPlayable) stem = own;
    if (stem === null) return null;
    if (stem === own) {
      this.sinceOwn = 0;
      this.ownEvery = this.drawOwnEvery();
    } else {
      this.sinceOwn++;
    }
    const grown = this.sessionGrowth();
    const silenceMinS = lerp(CALM_SILENCE_MIN_S, LONG_SESSION_SILENCE_MIN_S, grown);
    const silenceMaxS = lerp(CALM_SILENCE_MAX_S, LONG_SESSION_SILENCE_MAX_S, grown);
    const gapS = this.started ? silenceMinS + this.random() * (silenceMaxS - silenceMinS) : 0;
    return this.cue(
      stem,
      'calm',
      randomInt(CALM_PASSES_MIN, CALM_PASSES_MAX, this.random),
      gapS,
      CALM_FADE_IN_S,
      CALM_FADE_S,
    );
  }

  private cue(
    stem: string,
    intensity: MusicIntensity,
    passes: number,
    gapBeforeS: number,
    fadeInS: number,
    fadeS: number,
  ): MusicCue | null {
    const track = this.manifest.tracks[stem];
    if (track === undefined) return null;
    this.started = true;
    this.lastAudio = track.segmentSha256;
    this.lastIntensity = intensity;
    return { track, passes, gapBeforeS, fadeInS, fadeS };
  }

  /**
   * The next stem from the pool's shuffle bag, never `except`'s audio and never the last cue's when
   * another is left; the bag refills reshuffled once it runs dry.
   */
  private draw(intensity: MusicIntensity, except: string | null): string | null {
    const exceptAudio = except === null ? null : this.audioOf(except);
    const pool = this.music.pools[intensity].filter(
      (stem) => this.playable(stem) && this.audioOf(stem) !== exceptAudio,
    );
    if (pool.length === 0) return null;
    const fresh = (stem: string) => this.audioOf(stem) !== this.lastAudio;
    let bag = this.bags[intensity].filter((stem) => pool.includes(stem));
    if (!bag.some(fresh)) bag = shuffled(pool, this.random);
    let at = bag.length - 1;
    while (at > 0 && !fresh(bag[at] ?? '')) at--;
    const [stem] = bag.splice(at, 1);
    this.bags[intensity] = bag;
    return stem ?? null;
  }

  private playable(stem: string): boolean {
    const track = this.manifest.tracks[stem];
    return track !== undefined && !this.dropped.has(track.file);
  }

  private audioOf(stem: string): string | undefined {
    return this.manifest.tracks[stem]?.segmentSha256;
  }

  private drawOwnEvery(): number {
    const grown = this.sessionGrowth();
    return randomInt(
      Math.round(lerp(OWN_STEM_EVERY_MIN, LONG_SESSION_OWN_STEM_EVERY_MIN, grown)),
      Math.round(lerp(OWN_STEM_EVERY_MAX, LONG_SESSION_OWN_STEM_EVERY_MAX, grown)),
      this.random,
    );
  }

  /** How far the session has grown toward its long-session spacing, 0 at its start to 1. */
  private sessionGrowth(): number {
    return Math.min(1, Math.max(0, this.sessionS() / LONG_SESSION_S));
  }
}
