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

/** The three voice classes `humans/sounds.cif` keys its groups by, in the file's own `0 1 2` order. */
export const VOICE_CLASSES = ['child', 'female', 'male'] as const;
export const VoiceClass = z.enum(VOICE_CLASSES);
export type VoiceClass = z.infer<typeof VoiceClass>;

/**
 * One tribe's voice for one class from `humans/sounds.cif`: the {@link SoundStaticGroup} names the engine
 * plays when such a settler is hit (`scream`), natters unprompted on screen (`generic`), or answers a
 * player's order (`respond <class> 0` for the "ok" pool, `respond <class> 1` for the "no" pool; the
 * engine keeps at most 15 of each). A class the tribe leaves silent has no row.
 */
export const HumanVoices = z.strictObject({
  /** `logictribe` - the settler tribe these voices belong to. */
  tribe: z.number().int().nonnegative(),
  voiceClass: VoiceClass,
  scream: z.string().optional(),
  generic: z.string().optional(),
  /** The "ok" answer pools, in file order: a settler keeps one for life (its index modulo the count). */
  respondOk: z.array(z.string()).default([]),
  /** The "no" answer pools, in file order; the original loads them and never plays one. */
  respondNo: z.array(z.string()).default([]),
});
export type HumanVoices = z.infer<typeof HumanVoices>;

/**
 * One animal tribe's unprompted call from `animals/sounds.ini`: while at least `minCount` of them are
 * drawn, each game tick rolls `probability` in 1000 to play `group` at one of them.
 */
export const AnimalCall = z.strictObject({
  /** `logictribetype` - the animal tribe (8 and up in the base data). */
  tribe: z.number().int().nonnegative(),
  /** `mincount` - drawn animals of the tribe needed before a call may roll. */
  minCount: z.number().int().nonnegative(),
  /** `probability` - the per-tick chance in thousandths. */
  probability: z.number().int().nonnegative(),
  /** `enginesoundgroup` - the {@link SoundStaticGroup} name. */
  group: z.string(),
});
export type AnimalCall = z.infer<typeof AnimalCall>;

/**
 * The decoded sound bank: the `soundfx.cif` groups, beds and jingles plus the creature voice tables
 * (`humans/sounds.cif`, `animals/sounds.ini`) that name those groups. Render-binding data the pure sim
 * ignores. Empty when the pipeline has not run, so the app degrades to silence rather than crashing.
 */
export const SoundBank = z.strictObject({
  staticGroups: z.array(SoundStaticGroup).default([]),
  ambient: z.array(SoundAmbient).default([]),
  jingles: z.array(SoundJingle).default([]),
  humanVoices: z.array(HumanVoices).default([]),
  animalCalls: z.array(AnimalCall).default([]),
});
export type SoundBank = z.infer<typeof SoundBank>;

/** The bank a set without decoded sound carries: every table empty. */
export const EMPTY_SOUND_BANK: SoundBank = {
  staticGroups: [],
  ambient: [],
  jingles: [],
  humanVoices: [],
  animalCalls: [],
};
