import type { WielderBlowSound } from '@open-northland/audio';
import { JOB_SOLDIER_BROADSWORD } from '../../catalog/jobs.js';
import { BYZANTINE } from '../../catalog/unit-variants.js';

/**
 * Blows that sound with an app clip instead of the weapon's listed impact. Project choice, not the
 * original's: the Byzantine long-sword soldier swings a mace, so his blow rings as struck steel rather
 * than the sword cut his weapon row lists. A blow picks one of four CC0 clips (notice in public/licenses).
 */
export const WIELDER_BLOWS: readonly WielderBlowSound[] = [
  {
    tribe: BYZANTINE,
    job: JOB_SOLDIER_BROADSWORD,
    files: [
      '/audio/mace-hit-1.ogg',
      '/audio/mace-hit-2.ogg',
      '/audio/mace-hit-3.ogg',
      '/audio/mace-hit-4.ogg',
    ],
  },
];
