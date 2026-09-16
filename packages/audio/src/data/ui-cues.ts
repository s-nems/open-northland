import type { OneShot } from './types.js';

/**
 * The GUI's own click feedback, played straight from an input event rather than from a sim event: a
 * pressed button or an accepted world action confirms, a cancelled tool fails. Byte evidence (`the original`,
 * `an original routine` / `FXTool_Fail`): the engine hardwires these two wavs outside the
 * `soundfx.cif` groups and plays them centred, at volume 100 where the static groups author 80.
 */
export type UiCue = 'confirm' | 'fail';

/** The wav each cue plays, relative to the sounds root. */
export const UI_CUE_FILES: Readonly<Record<UiCue, string>> = {
  confirm: 'gui/click_confirm.wav',
  fail: 'gui/click_fail.wav',
};

/** Gain of a GUI cue - full scale, the original's 100 against the static groups' 80 (`SFX_GAIN`). */
export const UI_CUE_GAIN = 1;

/** The centred, full-gain one-shot a GUI cue plays. Keyed per cue, so the engine's one-shot cooldown
 *  swallows a repeat press inside its window (approximation: the original replays every press). */
export function uiCueShot(cue: UiCue): OneShot {
  return { files: [UI_CUE_FILES[cue]], gain: UI_CUE_GAIN, pan: 0, key: `ui:${cue}` };
}
