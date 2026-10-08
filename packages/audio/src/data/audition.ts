import { poolGain, type SoundIndex } from './bank.js';
import { jingleDuck } from './bindings.js';
import { AMBIENT_MAX_GAIN } from './director/ambient.js';
import type { ShotLayer } from './perspective.js';
import type { AmbientLoop, OneShot } from './types.js';

/**
 * Shots built the way the director builds them in play, for a listener to audition one sound group
 * through the arbiter and the engine: the group's authored volume, its lane and guard, and a pan the
 * listener chooses instead of a position on screen.
 */

/** How a group sounds in play, which picks its lane, its guard and its bus. */
export type AuditionRole =
  /** A positioned action sound in the sfx lane (work, swings, impacts, object ambience). */
  | { readonly kind: 'world'; readonly layer: ShotLayer }
  /** An unprompted line in the voice lane (chatter, screams, animal calls): one wav sounds once at a time. */
  | { readonly kind: 'voice' }
  /** An order's answer: in no lane, and held while any line of its pool still sounds. */
  | { readonly kind: 'answer' }
  /** A life-event stinger in the jingle lane, ducking the music for its type's hold. */
  | { readonly kind: 'jingle'; readonly musicType: number };

const SFX_LANE = { kind: 'sfx' } as const;
const VOICE_LANE = { kind: 'voice' } as const;

/** One play of `files`, a pool the index holds, as `role` plays in the game at full on-screen gain. */
export function auditionShot(
  index: SoundIndex,
  files: readonly string[],
  role: AuditionRole,
  key: string,
  pan: number,
): OneShot {
  const gain = poolGain(index, files);
  switch (role.kind) {
    case 'world':
      return { files, gain, pan, key, lane: SFX_LANE, layer: role.layer };
    case 'voice':
      return { files, gain, pan, key, lane: VOICE_LANE, exclusive: 'wav' };
    case 'answer':
      return { files, gain, pan, key, exclusive: 'group' };
    case 'jingle': {
      const duck = jingleDuck(role.musicType);
      const lane = { kind: 'jingle', musicType: role.musicType } as const;
      // A jingle rings centred in play, whatever the pan.
      return duck === undefined
        ? { files, gain, pan: 0, key, lane }
        : { files, gain, pan: 0, key, lane, ...duck };
    }
  }
}

/** An ambient bed looping as it does when its ground fills the screen. */
export function auditionBed(name: string, file: string, pan: number): AmbientLoop {
  return { name, file, gain: AMBIENT_MAX_GAIN, pan };
}
