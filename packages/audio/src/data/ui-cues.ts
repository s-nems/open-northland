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

/** Gain of a hardwired cue - full scale, the original's 100 on the authored volume scale where the
 *  static groups mostly author 80 ({@link import('./bank.js').authoredVolumeGain}). */
export const UI_CUE_GAIN = 1;

/** The centred, full-gain one-shot a cue plays. Keyed per cue, so in game the arbiter's key
 *  cooldown swallows a repeat press inside its window (approximation: the original replays every press). */
export function uiCueShot(cue: UiCue): OneShot {
  return { files: [UI_CUE_FILES[cue]], gain: UI_CUE_GAIN, pan: 0, key: `ui:${cue}` };
}

/**
 * What a notification rings, all authored (the original sounds none of them in game): a new message
 * card the briefing pop, another player's chat line and a player joining or returning the chat ring, a
 * player leaving, being kicked or the world falling out of sync the fail click.
 */
export type NotificationCue = 'card' | 'chat' | 'arrival' | 'departure';

export const NOTIFICATION_CUES: Readonly<Record<NotificationCue, UiCue>> = {
  card: 'briefing',
  chat: 'chat',
  arrival: 'chat',
  departure: 'fail',
};

/** A new card's briefing pop sits about 6 dB under a press: the bank's loudest GUI wav, rung unasked.
 *  Authored, tune by ear. */
export const NOTICE_CARD_GAIN = UI_CUE_GAIN / 2;

/** The one-shot a notification rings: its cue's wav, keyed per notification so a burst of cards in
 *  one frame rings once. */
export function notificationShot(notification: NotificationCue): OneShot {
  const shot = uiCueShot(NOTIFICATION_CUES[notification]);
  const key = `notify:${notification}`;
  return notification === 'card' ? { ...shot, gain: NOTICE_CARD_GAIN, key } : { ...shot, key };
}
