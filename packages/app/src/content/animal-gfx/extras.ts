import type { FrameListAnim, SettlerStateBinding } from '@open-northland/render';
import { ANIMAL_EXTRA_ANIMATIONS } from '../../catalog/animal-animation-extras.js';
import type { BobSeqRow } from '../ir/rows.js';
import { eightDirAnim } from '../settler-gfx/index.js';

/** Three pose groups, visually matched to the stag's authored wait directions: left, right, front.
 * The unbound waits share that layout. Timing is an approximation: hold each pose for three ticks. */
const IDLE_GROUP_BY_FACING = [0, 0, 0, 1, 1, 1, 2, 2] as const;
const IDLE_POSE_HOLD = 3;

export function animalExtraIdle(
  tribe: number,
  sequences: ReadonlyMap<string, BobSeqRow>,
): FrameListAnim | undefined {
  const name = ANIMAL_EXTRA_ANIMATIONS.get(tribe)?.idle;
  const seq = name === undefined ? undefined : sequences.get(name);
  if (seq === undefined || seq.length <= 0 || seq.length % 3 !== 0) return undefined;
  const stride = seq.length / 3;
  return {
    start: seq.start,
    frameLists: IDLE_GROUP_BY_FACING.map((group) =>
      Array.from(
        { length: stride * IDLE_POSE_HOLD },
        (_, i) => group * stride + Math.floor(i / IDLE_POSE_HOLD),
      ),
    ),
  };
}

/** Keep an animal's gait stable throughout a walk. The existing character-variant selector distributes
 * the two looks by entity id; only ordinary movement changes, never the run or attack. */
export function animalWalkVariants(
  tribe: number,
  binding: SettlerStateBinding,
  sequences: ReadonlyMap<string, BobSeqRow>,
): readonly SettlerStateBinding[] | undefined {
  const alternate = eightDirAnim(sequences, ANIMAL_EXTRA_ANIMATIONS.get(tribe)?.alternateWalk);
  if (alternate === undefined || binding.moving === undefined) return undefined;
  return [binding, { ...binding, moving: alternate }];
}
