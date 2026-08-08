/**
 * A settler is two layered bob sets drawn at the same bob id, a body (`CR_Hum_Body_*`) and a head
 * (`CR_Hum_Head_*`) on top, as the original's `jobgraphics` (`gfxbobmanagerbody` + `gfxbobmanagerhead`)
 * composes a human. The reducers here are pure; byte loading and sheet assembly live in `../sprite-sheet/`.
 */
export { carryAnimsByGood, carryHeadAnims, characterBinding } from './bindings-character.js';
export { buildHumanBindings } from './bindings-demo.js';
export {
  ADULT_CHARACTER_BY_JOB,
  CHARACTER_SPEC_ENTRIES,
  CHARACTER_SPECS,
  type CharacterSpec,
  type CharacterSpecId,
  UNARMED_WARRIOR_SPEC,
  WARRIOR_JOBS,
  WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG,
  YOUNG_CHARACTER_BY_JOB,
} from './character-specs.js';
export { directionalAnimFromSeq, eightDirAnim, frameListsByFacing, type GoodRef } from './seq-anim.js';
export {
  HAMMER_TICKS_PER_FRAME,
  HARVEST_TICKS,
  MUSHROOM_PLUCK_FRAMES,
  MUSHROOM_PLUCKS_PER_PICK,
} from './sequences.js';
