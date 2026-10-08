/**
 * A settler is two layered bob sets drawn at the same bob id, a body (`CR_Hum_Body_*`) and a head
 * (`CR_Hum_Head_*`) on top, as the original's `jobgraphics` (`gfxbobmanagerbody` + `gfxbobmanagerhead`)
 * composes a human. The reducers here are pure; byte loading and sheet assembly live in `../sprite-sheet/`.
 */
export { carryAnimsByGood, characterBinding } from './bindings-character.js';
export { buildHumanBindings } from './bindings-demo.js';
export { borrowedGaitHeadAtlas, borrowedHeadAtlas } from './borrowed-head-frames.js';
export {
  ADULT_CHARACTER_BY_JOB,
  CHARACTER_SPEC_ENTRIES,
  CHARACTER_SPECS,
  type CharacterSpec,
  type CharacterSpecId,
  HERO_JOBS,
  UNARMED_WARRIOR_SPEC,
  WARRIOR_JOBS,
  WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG,
  YOUNG_CHARACTER_BY_JOB,
} from './character-specs.js';
export { carryHeadFallback, type HeadClip, headBinding, headClips } from './head-binding.js';
export {
  directionalAnimFromSeq,
  eightDirAnim,
  FACING,
  frameListsByFacing,
  type GoodRef,
  programFrameLists,
} from './seq-anim.js';
export {
  HARVEST_TICKS,
  IDLE_ACTIONS,
  MUSHROOM_PLUCK_FRAMES,
  MUSHROOM_PLUCKS_PER_PICK,
} from './sequences.js';
export {
  DEFAULT_PALETTE,
  isAnimalBody,
  lookFrom,
  lookStem,
  type TribeLook,
  tribeLooks,
} from './tribe-looks.js';
