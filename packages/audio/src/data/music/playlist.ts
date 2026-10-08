import type { DiplomacyState } from '@open-northland/sim';
import type { MusicManifest } from './manifest.js';
import { ownCalmStem, ownTenseStem } from './mood.js';
import type { MapMusic, MusicIntensity } from './pools.js';
import type { MusicCue, MusicSequence } from './sequence.js';

/**
 * A map's in-game soundtrack: a rotation over its culture's pools instead of one loop region forever.
 * Calm stretches open on the map's own stem, then alternate silence with shuffle-bag picks from the
 * calm pool, returning to the own stem every second or third cue. A fight cuts in at once with the
 * map's own tense stem and holds each tense stem for several passes; calm returns at a pass boundary.
 * The whole rotation is a design choice of this reimplementation (the original rings one segment per
 * map), and every number below is an approximation to tune by ear.
 */

/** Passes a calm cue plays, drawn per cue: one or two passes of a 50-127 s loop region. */
export const CALM_PASSES_MIN = 1;
export const CALM_PASSES_MAX = 2;
/** Seconds a calm cue fades out over before its silence. */
export const CALM_FADE_S = 2.5;
/** Silence before each calm cue after the first, drawn per cue. */
export const CALM_SILENCE_MIN_S = 20;
export const CALM_SILENCE_MAX_S = 60;
/** The map's own calm stem comes back every this many calm cues, drawn per return. */
export const OWN_STEM_EVERY_MIN = 2;
export const OWN_STEM_EVERY_MAX = 3;
/** Passes a tense stem holds before the fight rotates to another one. */
export const TENSE_PASSES = 3;
/** Seconds a tense cue fades out over when it hands over to the next tense stem. */
export const TENSE_FADE_S = 1.5;

/** A uniform draw in `[0, 1)`. */
export type MusicRandom = () => number;

/** What a change of mood asks the player to do with the cue it is playing. */
export type MusicTransition = 'none' | 'now' | 'atPassEnd';

/** The frame's mood as the playlist reads it. */
export interface PlaylistMood {
  readonly intensity: MusicIntensity;
  readonly stance: DiplomacyState;
  readonly wealthy: boolean;
}

function randomInt(min: number, max: number, random: MusicRandom): number {
  return min + Math.floor(random() * (max - min + 1));
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
  /** Audio digest of the last cue handed out, so no stem follows itself. */
  private lastAudio: string | null = null;
  /** Each pool's shuffle bag: stems still to play this round, drawn from the end. */
  private readonly bags: Record<MusicIntensity, string[]> = { calm: [], tense: [] };
  private readonly dropped = new Set<string>();

  constructor(
    private readonly music: MapMusic,
    private readonly manifest: MusicManifest,
    private readonly random: MusicRandom,
  ) {
    this.ownEvery = this.drawOwnEvery();
  }

  /** Take the frame's mood. Turning tense cuts in now; calming waits for the playing pass to end. */
  update(mood: PlaylistMood): MusicTransition {
    const previous = this.mood.intensity;
    this.mood = mood;
    if (mood.intensity === previous) return 'none';
    if (mood.intensity === 'calm') return 'atPassEnd';
    this.freshFight = true;
    return 'now';
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
    const stem = (own !== null && this.playable(own) ? own : null) ?? this.draw('tense', null);
    return stem === null ? null : this.cue(stem, TENSE_PASSES, 0, TENSE_FADE_S);
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
    const gapS = this.started
      ? CALM_SILENCE_MIN_S + this.random() * (CALM_SILENCE_MAX_S - CALM_SILENCE_MIN_S)
      : 0;
    return this.cue(stem, randomInt(CALM_PASSES_MIN, CALM_PASSES_MAX, this.random), gapS, CALM_FADE_S);
  }

  private cue(stem: string, passes: number, gapBeforeS: number, fadeS: number): MusicCue | null {
    const track = this.manifest.tracks[stem];
    if (track === undefined) return null;
    this.started = true;
    this.lastAudio = track.segmentSha256;
    return { track, passes, gapBeforeS, fadeS };
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
    return randomInt(OWN_STEM_EVERY_MIN, OWN_STEM_EVERY_MAX, this.random);
  }
}
