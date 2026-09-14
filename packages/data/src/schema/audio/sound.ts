import { z } from 'zod';

/**
 * One `SFX "<path>" <n…>` line: the wav plus its trailing integers, kept verbatim because their
 * meaning is positional, section-specific, and only partly reversed.
 */
export const SoundSfx = z.strictObject({
  /** Wav path relative to `data/engine2d/bin/sounds`, forward-slashed and lower-cased; joins onto the
   *  served `/sounds/<file>` route. */
  file: z.string(),
  /** The trailing integers in file order: a static group's volume (0-100), an ambient's volume then
   *  probability. */
  params: z.array(z.number().int()).default([]),
});
export type SoundSfx = z.infer<typeof SoundSfx>;

/**
 * A `SoundFXStatic` group from `soundfx.cif`: interchangeable wavs the engine picks one of per play,
 * optionally bound to a `LogicSoundType` the original triggers off an animation, job or combat frame.
 */
export const SoundStaticGroup = z.strictObject({
  /** `Name` - the group's join key (e.g. `"Gui_Click"`). */
  name: z.string(),
  /** `LogicSoundType` - the engine trigger this group answers to; absent = never auto-triggered. */
  logicSoundType: z.number().int().nonnegative().optional(),
  sfx: z.array(SoundSfx).default([]),
});
export type SoundStaticGroup = z.infer<typeof SoundStaticGroup>;

/**
 * A `SoundFXAmbient` group: a bed tied to the terrain and landscape groups the camera frames. A
 * single-wav ambient loops; a multi-wav one plays sparsely by its per-`SFX` probability params.
 */
export const SoundAmbient = z.strictObject({
  /** `Name` - the ambient's handle (e.g. `"Water See"`). */
  name: z.string(),
  /** `PatternGroup` names this ambient covers, lower-cased for the terrain pattern-group join. */
  patternGroups: z.array(z.string()).default([]),
  /** `LandscapeGroup` names this ambient covers (tree families), lower-cased. */
  landscapeGroups: z.array(z.string()).default([]),
  sfx: z.array(SoundSfx).default([]),
});
export type SoundAmbient = z.infer<typeof SoundAmbient>;

/**
 * A `SoundFXJingle` group: a life-event stinger (birth, house built, mission won) bound to a numeric
 * `MusicType`. Jingles are UI feedback, not world sound, so they play at full volume with no pan.
 */
export const SoundJingle = z.strictObject({
  /** `Name` - the jingle handle (e.g. `"Birth"`). */
  name: z.string(),
  /** `MusicType` - the engine trigger; absent = handle-only. */
  musicType: z.number().int().nonnegative().optional(),
  sfx: z.array(SoundSfx).default([]),
});
export type SoundJingle = z.infer<typeof SoundJingle>;

/**
 * The decoded `soundfx.cif` sound bank: render-binding data the pure sim ignores. Empty when the
 * pipeline has not run, so the app degrades to silence rather than crashing.
 */
export const SoundBank = z.strictObject({
  staticGroups: z.array(SoundStaticGroup).default([]),
  ambient: z.array(SoundAmbient).default([]),
  jingles: z.array(SoundJingle).default([]),
});
export type SoundBank = z.infer<typeof SoundBank>;
