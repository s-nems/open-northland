import type { WielderBlowSound } from '@open-northland/audio';
import { JOB_SOLDIER_BROADSWORD } from '../../catalog/jobs.js';
import { BYZANTINE } from '../../catalog/unit-variants.js';

/**
 * Blows that sound with an app clip instead of the weapon's listed impact. Project choice, not the
 * original's: the Byzantine long-sword soldier swings a mace, so his blow rings as struck steel rather
 * than the sword cut his weapon row lists. The clip is CC0 (notice in public/licenses).
 */
export const WIELDER_BLOWS: readonly WielderBlowSound[] = [
  { tribe: BYZANTINE, job: JOB_SOLDIER_BROADSWORD, files: ['/audio/mace-hit.ogg'] },
];
