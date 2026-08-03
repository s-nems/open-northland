/**
 * The settler render binding: one body's decoded `[bobseq]` ranges become the directional state bindings
 * the renderer plays, plus the per-job character roster (the `[jobbasegraphics]` join). A settler is two
 * layered bob sets, a body (`CR_Hum_Body_*`) and a head (`CR_Hum_Head_*`) drawn on top at the same bob id,
 * as the original's `jobgraphics` (`gfxbobmanagerbody` + `gfxbobmanagerhead`) composes a human. The reducers
 * here are pure; the byte loading and sheet assembly live in `../sprite-sheet/`.
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
