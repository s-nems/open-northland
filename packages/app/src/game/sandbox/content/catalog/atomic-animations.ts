import {
  HUNTER_BOW_DRAW_LENGTH,
  HUNTER_BOW_RELEASE_FRAME,
  HUNTER_HARVEST_CADAVER_LENGTH,
} from '../../../../catalog/hunting.js';
import { HARVEST_TICKS } from '../../../../content/settler-gfx/index.js';
import {
  ATTACK_EVENT_TYPE,
  BROADSWORD_HIT_FRAME,
  BROADSWORD_SWING_LENGTH,
  FIST_HIT_FRAME,
  FIST_SWING_LENGTH,
  LONG_BOW_DRAW_LENGTH,
  LONG_BOW_RELEASE_FRAME,
  SHORT_BOW_DRAW_LENGTH,
  SHORT_BOW_RELEASE_FRAME,
  SPEAR_HIT_FRAME,
  SPEAR_SWING_LENGTH,
  SWORD_HIT_FRAME,
  SWORD_SWING_LENGTH,
} from '../../combat.js';
import { GATHERERS } from '../../ids/index.js';
import { soundCueEvents } from '../../sound-cues.js';
import {
  BUILD_GUIDE_ANIMATION,
  BUILD_GUIDE_SWING_LENGTH,
  BUILD_HOUSE_ANIMATION,
  BUILD_HOUSE_SWING_LENGTH,
  CHANGE_SOCIAL_EVENT_TYPE,
  CIVILIST_EXERCISE_ANIMATION,
  CIVILIST_EXERCISE_LENGTH,
  CIVILIST_EXERCISE_XP,
  CIVILIST_EXERCISE_XP_FRAME,
  CIVILIST_LISTEN_ANIMATION,
  CIVILIST_TALK_ANIMATION,
  CIVILIST_TALK_LENGTH,
  CIVILIST_TALK_PULSE_FRAMES,
  FARMER_REAP_ANIMATION,
  FARMER_REAP_LENGTH,
  FARMER_SOW_ANIMATION,
  FARMER_SOW_LENGTH,
  FARMER_WATER_ANIMATION,
  FARMER_WATER_LENGTH,
  LISTEN_QUIET_PULSE_VALUE,
  STORE_EXCHANGE_LENGTH,
  STORE_PICKUP_ANIMATION,
  STORE_PILEUP_ANIMATION,
  TALK_PULSE_VALUE,
  TRAINING_EXPERIENCE_EVENT_TYPE,
  WOMAN_LISTEN_ANIMATION,
  WOMAN_TALK_ANIMATION,
  WOMAN_TALK_LENGTH,
  WOMAN_TALK_PULSE_FRAMES,
} from '../../work-animations.js';

/** One clip, with its transcribed `event <at> 34 <id>` cues resolved from its own name and length so the
 *  two never drift apart, plus any `extra` rows the clip authors on other channels. */
function clip(
  name: string,
  length: number,
  extra: readonly object[] = [],
): { id: string; name: string; length: number; events: object[] } {
  return { id: name, name, length, events: [...extra, ...soundCueEvents(name, length)] };
}

/** A clip restoring the company bar in channel-3 pulses of `value` at the extracted event `frames`. */
function chatClip(
  name: string,
  length: number,
  frames: readonly number[],
  value: number,
): { id: string; name: string; length: number; interruptible: true; events: object[] } {
  const pulses = frames.map((at) => ({ at, type: CHANGE_SOCIAL_EVENT_TYPE, value }));
  // `interruptable 1` in the source rows.
  return { ...clip(name, length, pulses), interruptible: true };
}

export function buildSandboxAtomicAnimations(): readonly object[] {
  return [
    ...GATHERERS.map((gatherer) => clip(gatherer.animation, HARVEST_TICKS[gatherer.atomic] ?? 1)),
    clip(STORE_PICKUP_ANIMATION, STORE_EXCHANGE_LENGTH),
    clip(STORE_PILEUP_ANIMATION, STORE_EXCHANGE_LENGTH),
    // Extracted lengths from the mod's `atomicanimations12/atomicanimations.ini`. The hearts phase runs
    // the longer civilist clock.
    clip('viking_woman_kiss', 50),
    clip('viking_woman_kissed', 50),
    clip('viking_civilist_kiss', 50),
    clip('viking_civilist_kissed', 50),
    clip('viking_woman_make_love', 50),
    clip('viking_civilist_make_love', 200),
    // Extracted lengths and channel-3 pulse rows. The woman restores little while listening because she
    // recovers on her talking turn, the pair alternating roles.
    chatClip(CIVILIST_TALK_ANIMATION, CIVILIST_TALK_LENGTH, CIVILIST_TALK_PULSE_FRAMES, TALK_PULSE_VALUE),
    chatClip(CIVILIST_LISTEN_ANIMATION, CIVILIST_TALK_LENGTH, CIVILIST_TALK_PULSE_FRAMES, TALK_PULSE_VALUE),
    chatClip(WOMAN_TALK_ANIMATION, WOMAN_TALK_LENGTH, WOMAN_TALK_PULSE_FRAMES, TALK_PULSE_VALUE),
    chatClip(WOMAN_LISTEN_ANIMATION, WOMAN_TALK_LENGTH, WOMAN_TALK_PULSE_FRAMES, LISTEN_QUIET_PULSE_VALUE),
    clip('viking_fist_attack', FIST_SWING_LENGTH, [{ at: FIST_HIT_FRAME, type: ATTACK_EVENT_TYPE }]),
    clip('viking_spear_attack', SPEAR_SWING_LENGTH, [{ at: SPEAR_HIT_FRAME, type: ATTACK_EVENT_TYPE }]),
    clip('viking_sword_attack', SWORD_SWING_LENGTH, [{ at: SWORD_HIT_FRAME, type: ATTACK_EVENT_TYPE }]),
    clip('viking_broadsword_attack', BROADSWORD_SWING_LENGTH, [
      { at: BROADSWORD_HIT_FRAME, type: ATTACK_EVENT_TYPE },
    ]),
    clip('viking_bow_attack', SHORT_BOW_DRAW_LENGTH, [
      { at: SHORT_BOW_RELEASE_FRAME, type: ATTACK_EVENT_TYPE },
    ]),
    clip('viking_hunter_attack', HUNTER_BOW_DRAW_LENGTH, [
      { at: HUNTER_BOW_RELEASE_FRAME, type: ATTACK_EVENT_TYPE },
    ]),
    clip('viking_hunter_harvest_cadaver', HUNTER_HARVEST_CADAVER_LENGTH),
    clip('viking_bow_long_attack', LONG_BOW_DRAW_LENGTH, [
      { at: LONG_BOW_RELEASE_FRAME, type: ATTACK_EVENT_TYPE },
    ]),
    clip(BUILD_HOUSE_ANIMATION, BUILD_HOUSE_SWING_LENGTH),
    clip(BUILD_GUIDE_ANIMATION, BUILD_GUIDE_SWING_LENGTH),
    clip(CIVILIST_EXERCISE_ANIMATION, CIVILIST_EXERCISE_LENGTH, [
      { at: CIVILIST_EXERCISE_XP_FRAME, type: TRAINING_EXPERIENCE_EVENT_TYPE, value: CIVILIST_EXERCISE_XP },
    ]),
    clip(FARMER_REAP_ANIMATION, FARMER_REAP_LENGTH),
    clip(FARMER_SOW_ANIMATION, FARMER_SOW_LENGTH),
    clip(FARMER_WATER_ANIMATION, FARMER_WATER_LENGTH),
  ];
}
