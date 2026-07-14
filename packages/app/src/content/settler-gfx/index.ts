/**
 * The settler render binding: turn one body's decoded `[bobseq]` ranges into the directional, tick-animated
 * state bindings the renderer plays (walk / idle / chop / carry), and hold the per-job character roster
 * (the `[jobbasegraphics]` join). A settler is composed of two layered bob sets — a **body**
 * (`CR_Hum_Body_*`) and a **head** (`CR_Hum_Head_*`), the head drawn on top at the same bob id — exactly
 * as the original's `jobgraphics` (`gfxbobmanagerbody` + `gfxbobmanagerhead`) compose a human. Every
 * reducer here is pure + unit-tested without a browser; the byte loading + sheet assembly live in
 * {@link import('../sprite-sheet/index.js')}.
 *
 * The frame ranges (start + length) are read from the IR's `bobSequences` (the `extractBobSequences`
 * pipeline leg) by sequence name and turned into a {@link DirectionalAnim} via {@link directionalAnimFromSeq}
 * (`stride = length / DIRS`). What stays in code is the render-taste tuning the data does not carry: which
 * sequence drives which state, the `phaseStart` windup offset, and the single-frame idle hold. This feature
 * splits by concern: the named-clip + timing data ({@link import('./sequences.js')}), the per-job character
 * roster ({@link import('./character-specs.js')}), the pure seq→anim primitives
 * ({@link import('./seq-anim.js')}), the legacy whole-sheet demo binding ({@link import('./bindings-demo.js')}),
 * and the per-character/warrior binding reducers ({@link import('./bindings-character.js')}).
 */
export { carryAnimsByGood, carryHeadAnims, characterBinding } from './bindings-character.js';
export { buildHumanBindings } from './bindings-demo.js';
export {
  ADULT_CHARACTER_BY_JOB,
  CHARACTER_SPEC_ENTRIES,
  CHARACTER_SPECS,
  type CharacterSpec,
  type CharacterSpecId,
  WARRIOR_SPEC_BY_WEAPON_GOOD,
  YOUNG_CHARACTER_BY_JOB,
} from './character-specs.js';
export { directionalAnimFromSeq, type GoodRef } from './seq-anim.js';
export {
  HAMMER_TICKS_PER_FRAME,
  HARVEST_TICKS,
  MUSHROOM_PLUCK_FRAMES,
  MUSHROOM_PLUCKS_PER_PICK,
} from './sequences.js';
