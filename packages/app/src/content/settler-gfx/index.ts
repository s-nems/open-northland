/**
 * The settler render binding: turn one body's decoded `[bobseq]` ranges into the directional, tick-animated
 * state bindings the renderer plays (walk / idle / chop / carry), and hold the per-job character roster
 * (the `[jobbasegraphics]` join). A settler is composed of two layered bob sets — a **body**
 * (`CR_Hum_Body_*`) and a **head** (`CR_Hum_Head_*`), the head drawn on top at the same bob id — exactly
 * as the original's `jobgraphics` (`gfxbobmanagerbody` + `gfxbobmanagerhead`) compose a human. Every
 * reducer here is pure + unit-tested without a browser; the byte loading + sheet assembly live in
 * {@link import('../sprite-sheet.js')}.
 *
 * The frame RANGES (start + length) are read from the IR's `bobSequences` (the `extractBobSequences`
 * pipeline leg) by sequence name and turned into a {@link DirectionalAnim} via {@link directionalAnimFromSeq}
 * (`stride = length / DIRS`). What stays in code is the render-taste tuning the data does not carry: which
 * sequence drives which state, the `phaseStart` windup offset, and the single-frame idle hold. This feature
 * splits into three modules: the named-clip + timing data ({@link import('./sequences.js')}), the per-job
 * character roster ({@link import('./character-specs.js')}), and the pure binding reducers
 * ({@link import('./bindings.js')}).
 */
export {
  buildHumanBindings,
  carryAnimsByGood,
  carryHeadAnims,
  characterBinding,
  directionalAnimFromSeq,
  type GoodRef,
} from './bindings.js';
export {
  ADULT_CHARACTER_BY_JOB,
  CHARACTER_SPEC_ENTRIES,
  CHARACTER_SPECS,
  type CharacterSpec,
  type CharacterSpecId,
  WARRIOR_SPEC_BY_WEAPON_GOOD,
  YOUNG_CHARACTER_BY_JOB,
} from './character-specs.js';
export { HARVEST_TICKS, MUSHROOM_PLUCK_FRAMES, MUSHROOM_PLUCKS_PER_PICK } from './sequences.js';
