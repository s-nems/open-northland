import type { WielderSounds } from '@open-northland/audio';
import { JOB_SOLDIER_BROADSWORD, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { BYZANTINE } from '../../catalog/unit-variants.js';

/** The swing groups the sword soldiers' attack clips cue before the blow. */
const GROUP_SWORD_SHORT_SWING = 'Weapon Sword Short';
const GROUP_SWORD_LONG_SWING = 'Weapon Sword Long';

/** A mace blow, one of four CC0 clips per hit (notice in public/licenses). */
const MACE_BLOW = [
  '/audio/mace-hit-1.ogg',
  '/audio/mace-hit-2.ogg',
  '/audio/mace-hit-3.ogg',
  '/audio/mace-hit-4.ogg',
];
/** A mace's heavy swing, CC0 (notice in public/licenses). */
const MACE_SWING = ['/audio/mace-swing.ogg'];

/**
 * Settlers that sound with app clips instead of the bank's. Project choice, not the original's: both
 * Byzantine sword soldiers swing a mace, so they swing and strike as steel on a body rather than with
 * the sword their weapon row and clip name.
 */
export const WIELDER_SOUNDS: readonly WielderSounds[] = [
  {
    tribe: BYZANTINE,
    job: JOB_SOLDIER_SWORD,
    blow: MACE_BLOW,
    cues: { [GROUP_SWORD_SHORT_SWING]: MACE_SWING },
  },
  {
    tribe: BYZANTINE,
    job: JOB_SOLDIER_BROADSWORD,
    blow: MACE_BLOW,
    cues: { [GROUP_SWORD_LONG_SWING]: MACE_SWING },
  },
];
