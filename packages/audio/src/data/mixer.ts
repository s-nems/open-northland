import type { OneShot } from './types.js';

/**
 * The mixer's buses and player volumes, one slider each, named for what a player hears on them. Every
 * sound plays on one bus under the master:
 *
 * - `music`: the soundtrack;
 * - `responses`: settlers answering the player (an order's answer, a selection's line, a group's murmur);
 * - `world`: everything positioned in the world (work, combat, buildings, chatter, screams, animal calls);
 * - `ambient`: terrain beds, the landscape's object sounds and weather;
 * - `ui`: GUI cues, notifications, alerts and life-event jingles.
 *
 * Responses get their own bus: they answer the player's click, keep one level wherever the camera is,
 * and are the first thing a player may want quieter without losing the world.
 */
export type SoundBus = 'music' | 'responses' | 'world' | 'ambient' | 'ui';

/** One player volume slider: the master or a bus. */
export type VolumeChannel = 'master' | SoundBus;

/** Every bus, in the order the engine builds them. */
export const SOUND_BUSES: readonly SoundBus[] = ['music', 'responses', 'world', 'ambient', 'ui'];

/** The sliders in the order a settings page lists them. */
export const VOLUME_CHANNELS: readonly VolumeChannel[] = ['master', ...SOUND_BUSES];

/** Slider positions per channel, each 0..{@link VOLUME_MAX}. */
export type MixerVolumes = Readonly<Record<VolumeChannel, number>>;

/** A slider's top position: full gain. */
export const VOLUME_MAX = 100;
/** The dB span a slider covers above its silent bottom. Approximation: wide enough that the low end is
 *  usable as "barely there", the common choice for a perceptual game slider. */
export const VOLUME_RANGE_DB = 50;
/** Master slider default, about -10 dB: headroom for the bus sum before the master limiter.
 *  Approximation, tune by ear. */
export const DEFAULT_MASTER_VOLUME = 80;
/** Ambient slider default, about -7.5 dB: the beds, object ambience and weather sit under the action.
 *  Approximation, tune by ear. */
export const DEFAULT_AMBIENT_VOLUME = 85;
/** Music slider default, about -7.5 dB: the levelled score sits under the voices and the action rather
 *  than over them. Approximation; the original also opened its music volume below full, at 70 of 100,
 *  on a curve of its own. */
export const DEFAULT_MUSIC_VOLUME = 85;
/** Default of every other bus slider: full scale, so the mix inside the bus decides. */
export const DEFAULT_BUS_VOLUME = VOLUME_MAX;

export const DEFAULT_VOLUMES: MixerVolumes = {
  master: DEFAULT_MASTER_VOLUME,
  music: DEFAULT_MUSIC_VOLUME,
  responses: DEFAULT_BUS_VOLUME,
  world: DEFAULT_BUS_VOLUME,
  ambient: DEFAULT_AMBIENT_VOLUME,
  ui: DEFAULT_BUS_VOLUME,
};

/** A slider position clamped to 0..{@link VOLUME_MAX}; a non-finite position is silent. */
export function clampVolume(position: number): number {
  if (!Number.isFinite(position)) return 0;
  return Math.min(VOLUME_MAX, Math.max(0, position));
}

/**
 * Slider position to linear gain, linear in dB: `gain = 10^((p / 100 - 1) * 50 / 20)` for p in 1..100,
 * so 100 is 0 dB, 50 is -25 dB and 1 is -49.5 dB. Position 0 is a true mute rather than the -50 dB floor.
 */
export function volumeGain(position: number): number {
  const p = clampVolume(position);
  if (p <= 0) return 0;
  return 10 ** (((p / VOLUME_MAX - 1) * VOLUME_RANGE_DB) / 20);
}

/**
 * dB the music bus dips while an alert speaks ({@link OneShot.duckMusicDb}). Idle chatter, screams and
 * animal calls in the world leave the music alone: they ring unasked and often, and a duck under
 * them would pump the score. Approximation: the common 2-4 dB voice-over-music duck.
 */
export const VOICE_MUSIC_DUCK_DB = -3;
/** dB the music bus dips under an order's answer: lighter than an alert's, since the player hears one
 *  after nearly every order. A selection's short line dips nothing. Approximation. */
export const ANSWER_MUSIC_DUCK_DB = -2;

/** The bus a one-shot plays on: the one it names ({@link OneShot.bus}), else its lane's; a shot outside
 *  every lane (a GUI cue, a notification) plays on `ui`. */
export function oneShotBus(shot: OneShot): SoundBus {
  if (shot.bus !== undefined) return shot.bus;
  const lane = shot.lane;
  if (lane === undefined) return 'ui';
  switch (lane.kind) {
    case 'jingle':
    case 'alert':
      return 'ui';
    case 'voice':
      return 'world';
    case 'sfx':
      return 'world';
  }
}
