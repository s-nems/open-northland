import { z } from 'zod';

/**
 * One `SFX "<path>" <n…>` line: the wav to play plus the record's trailing integer parameters,
 * kept verbatim. Their meaning is positional and section-specific — {@link SoundStaticGroup} carries
 * one volume int (0–100); {@link SoundAmbient} carries a `(volume, probability, …)` triple driving
 * the sparse one-shot birds. We keep the raw list rather than naming each slot: the format is only
 * partially reversed, and today's audio layer reads only `file` (gains come from named constants).
 */
export const SoundSfx = z.strictObject({
  /** Wav path relative to `data/engine2d/bin/sounds`, forward-slashed + lower-cased (e.g. `ambient/water3.wav`); joins onto the served `/sounds/<file>` route. */
  file: z.string(),
  /** The trailing integers on the `SFX` line, in file order (volume first; ambient adds probability/period). */
  params: z.array(z.number().int()).default([]),
});
export type SoundSfx = z.infer<typeof SoundSfx>;

/**
 * A `SoundFXStatic` group from `soundfx.cif`: a named bag of interchangeable wavs (the engine picks
 * one at play time) optionally bound to a numeric `LogicSoundType` the original triggers off an
 * animation/job/combat frame. Every group is extracted though this slice wires only a hand-picked
 * subset, so later slices needn't re-run the decoder.
 */
export const SoundStaticGroup = z.strictObject({
  /** `Name` — the group's join key (e.g. `"Gui_Click"`, `"Bear Sounds"`, `"Viking male ok 13"`). */
  name: z.string(),
  /** `LogicSoundType` — the numeric engine trigger this group answers to; absent = never auto-triggered. */
  logicSoundType: z.number().int().nonnegative().optional(),
  /** The group's interchangeable wavs (the engine chooses one per play). */
  sfx: z.array(SoundSfx).default([]),
});
export type SoundStaticGroup = z.infer<typeof SoundStaticGroup>;

/**
 * A `SoundFXAmbient` group: a looping/sparse bed tied to terrain the camera frames. It names the
 * terrain `PatternGroup`s (meadow/water/desert/…) and/or landscape `LandscapeGroup`s (tree families)
 * it plays over; the audio layer runs it while any of those are on screen. A single-wav ambient
 * (water, meadow) loops; a multi-wav ambient (the 17 forest birds) plays sparsely by the per-`SFX`
 * probability params.
 */
export const SoundAmbient = z.strictObject({
  /** `Name` — the ambient's handle (e.g. `"Water See"`, `"All Trees"`). */
  name: z.string(),
  /** `PatternGroup` names this ambient covers (join onto the terrain pattern groups), lower-cased. */
  patternGroups: z.array(z.string()).default([]),
  /** `LandscapeGroup` names this ambient covers (tree families etc.), lower-cased. */
  landscapeGroups: z.array(z.string()).default([]),
  /** The bed's wavs (see the group doc for loop-vs-sparse play). */
  sfx: z.array(SoundSfx).default([]),
});
export type SoundAmbient = z.infer<typeof SoundAmbient>;

/**
 * A `SoundFXJingle` group: a non-positional life-event stinger (birth, death, house built, marriage,
 * mission won/lost, …) bound to a numeric `MusicType`. Jingles play at full volume with no pan — they
 * are UI feedback, not world sound — so the audio layer treats them distinctly from spatial SFX.
 */
export const SoundJingle = z.strictObject({
  /** `Name` — the jingle handle (e.g. `"Birth"`, `"House Built"`). */
  name: z.string(),
  /** `MusicType` — the numeric engine trigger; absent = handle-only. */
  musicType: z.number().int().nonnegative().optional(),
  /** The jingle's wav(s). */
  sfx: z.array(SoundSfx).default([]),
});
export type SoundJingle = z.infer<typeof SoundJingle>;

/**
 * The decoded `soundfx.cif` sound bank — the data half of audio. Render-binding data the pure sim
 * ignores entirely (like {@link LandscapeGfx}); the browser audio layer joins its groups onto sim
 * events + on-screen terrain to decide what plays. Empty on a checkout whose pipeline hasn't been run
 * against a game copy (`soundfx.cif` absent), so the app degrades to silence, never a crash.
 */
export const SoundBank = z.strictObject({
  staticGroups: z.array(SoundStaticGroup).default([]),
  ambient: z.array(SoundAmbient).default([]),
  jingles: z.array(SoundJingle).default([]),
});
export type SoundBank = z.infer<typeof SoundBank>;
