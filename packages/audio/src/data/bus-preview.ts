import { ATTACK_ALERT_GAIN } from './alerts.js';
import { authoredVolumeGain, DEFAULT_AUTHORED_VOLUME } from './bank.js';
import type { SoundBus } from './mixer.js';
import type { OneShot } from './types.js';

/**
 * The clip a settings page plays to let the player judge one bus's slider, since the menu has no world
 * or landscape sounding to judge by. One short, typical clip per bus that carries one-shots, at the level
 * it has in play; the music bus plays its score already and has none. Authored choices.
 */
export interface BusPreview {
  readonly files: readonly string[];
  readonly gain: number;
}

/** The authored volume of the trees' birdsong in the landscape ambience data. */
const BIRDSONG_AUTHORED_VOLUME = 70;

export const BUS_PREVIEWS: Readonly<Partial<Record<SoundBus, BusPreview>>> = {
  /** A Viking man's "ok". */
  responses: { files: ['humantalk/m1ok01.wav'], gain: authoredVolumeGain(DEFAULT_AUTHORED_VOLUME) },
  /** A tree's creak and crash as it falls. */
  world: { files: ['static/treefalling01.wav'], gain: authoredVolumeGain(DEFAULT_AUTHORED_VOLUME) },
  /** A bird in the trees. */
  ambient: { files: ['ambient/bird_01.wav'], gain: authoredVolumeGain(BIRDSONG_AUTHORED_VOLUME) },
  /** The attack horn, the loudest thing on the bus, as it rings for the settlement. */
  ui: { files: ['static/horn01.wav'], gain: ATTACK_ALERT_GAIN.base },
};

/** The centred one-shot that previews `bus`, or null for a bus without a clip. */
export function busPreviewShot(bus: SoundBus): OneShot | null {
  const preview = BUS_PREVIEWS[bus];
  if (preview === undefined) return null;
  return { files: preview.files, gain: preview.gain, pan: 0, key: `preview:${bus}`, bus };
}
