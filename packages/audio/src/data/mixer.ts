import type { OneShot } from './types.js';

/**
 * The mixer's buses and player volumes. Every sound plays on one bus under the master:
 *
 * - `music`: the soundtrack;
 * - `voice`: unprompted speech in the world (chatter, screams, animal calls);
 * - `world`: positioned action sounds (work, combat, buildings, objects);
 * - `ambient`: terrain beds and weather;
 * - `ui`: GUI cues, order answers and life-event jingles.
 *
 * Order answers ride `ui` rather than `voice`: they answer the player's own click like a button does,
 * so they keep one level wherever the camera is and the voice slider cannot bury feedback the player
 * asked for. Jingles and alerts sit beside them for the same reason.
 */
export type SoundBus = 'music' | 'voice' | 'world' | 'ambient' | 'ui';

/** One player volume slider: the master or a bus. */
export type VolumeChannel = 'master' | SoundBus;

/** Every bus, in the order the engine builds them. */
export const SOUND_BUSES: readonly SoundBus[] = ['music', 'voice', 'world', 'ambient', 'ui'];

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
/** Ambient slider default, about -15 dB: the beds and weather sit under the action. Approximation. */
export const DEFAULT_AMBIENT_VOLUME = 70;
/** Default of every other bus slider: full scale, so the mix inside the bus decides. */
export const DEFAULT_BUS_VOLUME = VOLUME_MAX;

export const DEFAULT_VOLUMES: MixerVolumes = {
  master: DEFAULT_MASTER_VOLUME,
  music: DEFAULT_BUS_VOLUME,
  voice: DEFAULT_BUS_VOLUME,
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

/** The bus a one-shot plays on, from the lane it is rationed in; a shot outside every lane answers the
 *  player (a GUI cue, an order's answer) and plays on `ui`. */
export function oneShotBus(shot: OneShot): SoundBus {
  const lane = shot.lane;
  if (lane === undefined) return 'ui';
  switch (lane.kind) {
    case 'jingle':
    case 'alert':
      return 'ui';
    case 'voice':
      return 'voice';
    case 'sfx':
      return 'world';
  }
}
