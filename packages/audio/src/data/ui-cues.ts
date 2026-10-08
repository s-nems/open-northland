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
 * card the briefing pop, another player's chat line the chat ring, a player joining or returning the
 * ship's bell, and a player leaving, being kicked or the world falling out of sync the same bell, lower
 * and quieter. The fail click stays the cancelled tool's alone.
 */
export type NotificationCue = 'card' | 'chat' | 'arrival' | 'departure';

/** How a notification sounds: its wav, its gain, its playback rate when not as recorded, and for one
 *  that may come in bursts the least seconds between two rings. */
export interface NotificationSound {
  readonly files: readonly string[];
  readonly gain: number;
  readonly rate?: number;
  readonly cooldownS?: number;
}

/** Least seconds between two sounds of one notice key (a message type, a notice voice) after a quiet
 *  spell: the shot's {@link OneShot.cooldownS}, which grows while the key keeps firing. Approximation: a
 *  busy settlement raises the same note for many settlers in a row. */
export const NOTICE_CUE_INTERVAL_S = 20;

/** A new card's briefing pop sits about 12 dB under a press: the bank's loudest GUI wav (peak -0.1 dBFS),
 *  rung unasked. Authored, tune by ear. */
export const NOTICE_CARD_GAIN = 0.25;
/** Another player's chat line rings about 6 dB under a press: a busy chat must not peck at the mix.
 *  Authored, tune by ear. */
export const CHAT_CUE_GAIN = UI_CUE_GAIN / 2;
/** Least seconds between two chat rings, so a burst of lines rings once. Authored. */
export const CHAT_CUE_COOLDOWN_S = 1;

/** The ship's bell: the one struck bell among `Ship Group3 Sails Bell`'s wavs (a sharp strike and an
 *  even decay; its two siblings are flapping sails). Nothing in the data plays the group. Chosen from
 *  its level envelope, still to be checked by ear in `?sounds`. */
export const SHIP_BELL_FILE = 'static/ship09.wav';
/** A player arriving rings the bell at about the chat ring's level: its strike sits near -16 dB RMS,
 *  6 dB under a press at this gain. Authored, tune by ear. */
export const ARRIVAL_BELL_GAIN = UI_CUE_GAIN / 2;
/** A player leaving rings the bell about four semitones lower, a falling farewell. Authored. */
export const DEPARTURE_BELL_RATE = 0.8;
/** A player leaving rings the bell about 3 dB under an arrival. Authored, tune by ear. */
export const DEPARTURE_BELL_GAIN = ARRIVAL_BELL_GAIN / Math.SQRT2;

export const NOTIFICATION_SOUNDS: Readonly<Record<NotificationCue, NotificationSound>> = {
  card: { files: [UI_CUE_FILES.briefing], gain: NOTICE_CARD_GAIN },
  chat: { files: [UI_CUE_FILES.chat], gain: CHAT_CUE_GAIN, cooldownS: CHAT_CUE_COOLDOWN_S },
  arrival: { files: [SHIP_BELL_FILE], gain: ARRIVAL_BELL_GAIN },
  departure: { files: [SHIP_BELL_FILE], gain: DEPARTURE_BELL_GAIN, rate: DEPARTURE_BELL_RATE },
};

/**
 * The one-shot a notification rings: its wav, keyed per notification so a burst of cards in one frame
 * rings once. With `rateKey` (a message type) the key is that type's and cools for
 * {@link NOTICE_CUE_INTERVAL_S}, longer while the type keeps coming, and the shot waits out its wav
 * still sounding, so cards of several types at once still ring once.
 */
export function notificationShot(notification: NotificationCue, rateKey?: string): OneShot {
  const sound = NOTIFICATION_SOUNDS[notification];
  const shot: OneShot = {
    files: sound.files,
    gain: sound.gain,
    pan: 0,
    key: `notify:${notification}`,
    ...(sound.rate !== undefined ? { rate: sound.rate } : {}),
    ...(sound.cooldownS !== undefined ? { cooldownS: sound.cooldownS } : {}),
  };
  if (rateKey === undefined) return shot;
  return {
    ...shot,
    key: `notify:${notification}:${rateKey}`,
    cooldownS: NOTICE_CUE_INTERVAL_S,
    cooldownGrows: true,
    exclusive: 'group',
  };
}
