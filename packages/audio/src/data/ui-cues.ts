import type { OneShot } from './types.js';

/**
 * The engine's hardwired cues, played centred at full volume outside the `soundfx.cif` groups. The two
 * GUI clicks answer an input event straight away (a pressed button or an accepted world action confirms,
 * a cancelled tool fails); the lobby rings `chat` when another player's line arrives; a map script's
 * `PlayCutscene` opens the briefing with `briefing` and its `StartEarthQuake` rumbles `earthquake`.
 * All play at volume 100 where the static groups author 80.
 */
export type UiCue = 'confirm' | 'fail' | 'chat' | 'briefing' | 'earthquake';

/** The wav each cue plays, relative to the sounds root. */
export const UI_CUE_FILES: Readonly<Record<UiCue, string>> = {
  confirm: 'gui/click_confirm.wav',
  fail: 'gui/click_fail.wav',
  chat: 'gui/chat_incoming.wav',
  briefing: 'gui/briefing_popup.wav',
  earthquake: 'misc/earthquak.wav',
};

/** Gain of a hardwired cue - full scale, the original's 100 against the static groups' 80 (`SFX_GAIN`). */
export const UI_CUE_GAIN = 1;

/** The centred, full-gain one-shot a cue plays. Keyed per cue, so the engine's one-shot cooldown
 *  swallows a repeat press inside its window (approximation: the original replays every press). */
export function uiCueShot(cue: UiCue): OneShot {
  return { files: [UI_CUE_FILES[cue]], gain: UI_CUE_GAIN, pan: 0, key: `ui:${cue}` };
}
