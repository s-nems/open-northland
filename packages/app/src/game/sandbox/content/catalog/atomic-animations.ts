import type { AtomicEvent } from '@open-northland/data';
import { systems } from '@open-northland/sim';
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
  CATAPULT_SHOT_FRAME,
  CATAPULT_SHOT_LENGTH,
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
import { GATHERERS, type GatherMode, GOOD_LEATHER, GOOD_MEAT, GOOD_WOOL } from '../../ids/index.js';
import {
  NEED_CLIPS,
  SOLDIER_SWING_DRAIN_VALUE,
  swingDrainEvents,
  WORK_DRAIN_VALUE,
  workDrainEvents,
} from '../../need-animations.js';
import { soundCueEvents } from '../../sound-cues.js';
import {
  BREEDER_CLIP_LENGTH,
  BREEDER_PRODUCE_ANIMATION_BY_SPECIES,
  BREEDER_SLAY_ANIMATION_BY_SPECIES,
  BUILD_GUIDE_ANIMATION,
  BUILD_GUIDE_SWING_LENGTH,
  BUILD_HOUSE_ANIMATION,
  BUILD_HOUSE_SWING_LENGTH,
  BUILD_WALL_ANIMATION,
  BUILD_WALL_SWING_LENGTH,
  CIVILIST_EXERCISE_ANIMATION,
  CIVILIST_EXERCISE_LENGTH,
  CIVILIST_EXERCISE_XP,
  CIVILIST_EXERCISE_XP_FRAME,
  CIVILIST_IDLE_SHORT_ANIMATIONS,
  CIVILIST_IDLE_SHORT_LENGTHS,
  CIVILIST_LISTEN_ANIMATION,
  CIVILIST_TALK_ANIMATION,
  CIVILIST_TALK_LENGTH,
  CIVILIST_TALK_PULSE_FRAMES,
  FARMER_REAP_ANIMATION,
  FARMER_REAP_LENGTH,
  FARMER_REAP_WORK_EVENT_FRAME,
  FARMER_SOW_ANIMATION,
  FARMER_SOW_LENGTH,
  FARMER_WATER_ANIMATION,
  FARMER_WATER_LENGTH,
  HIVE_DRAW_ANIMATION,
  LISTEN_QUIET_PULSE_VALUE,
  SLAY_DEPOSIT_FRAMES_BY_SPECIES,
  STORE_EXCHANGE_LENGTH,
  STORE_PICKUP_ANIMATION,
  STORE_PILEUP_ANIMATION,
  TALK_PULSE_VALUE,
  TRAINING_EXPERIENCE_EVENT_TYPE,
  UTILITY_DRAW_LENGTH,
  WELL_DRAW_ANIMATION,
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
  extra: readonly Omit<AtomicEvent, 'extended'>[] = [],
): { id: string; name: string; length: number; events: object[] } {
  return { id: name, name, length, events: [...extra, ...soundCueEvents(name, length)] };
}

/** A clip feeding one need bar in equal pulses at the extracted event `frames`. */
function needClip(
  name: string,
  length: number,
  channel: number,
  frames: readonly number[],
  value: number,
): { id: string; name: string; length: number; interruptible: true; events: object[] } {
  const pulses = frames.map((at) => ({ at, type: channel, value }));
  // `interruptable 1` in the source rows.
  return { ...clip(name, length, pulses), interruptible: true };
}

/** A clip whose swing costs its worker rest and food, on top of whatever else it carries. */
function workClip(name: string, length: number, extra: readonly Omit<AtomicEvent, 'extended'>[] = []) {
  return clip(name, length, [...workDrainEvents(length), ...extra]);
}

/** An attack clip: the frame its blow lands on, plus what that swing costs the fighter. */
function swingClip(name: string, length: number, hitFrame: number, drain = SOLDIER_SWING_DRAIN_VALUE) {
  return clip(name, length, [{ at: hitFrame, type: ATTACK_EVENT_TYPE }, ...swingDrainEvents(drain)]);
}

const SOCIAL = systems.ATOMIC_EVENT_CHANNEL.LEISURE;

/** The work event each gather mode's clip carries, which decides whether its strokes are counted. */
const GATHER_EVENT_TYPE: Readonly<Record<GatherMode, number>> = {
  fell: systems.ATOMIC_EVENT_TYPE_TRANSFORM,
  mine: systems.ATOMIC_EVENT_TYPE_SPLIT_UP,
  pick: systems.ATOMIC_EVENT_TYPE_PICKUP,
};

/** The sandbox ids of the wares a slaughter clip names, by their content slug. */
const SLAY_WARE_BY_SLUG: Readonly<Record<string, number>> = {
  wool: GOOD_WOOL,
  leather: GOOD_LEATHER,
  meat: GOOD_MEAT,
};

/** A breeder's slaughter clip: its transcribed frames each put one ware in the farm. */
function slayClip(species: string, name: string) {
  const deposits = (SLAY_DEPOSIT_FRAMES_BY_SPECIES[species] ?? []).flatMap(([at, ware]) => {
    const good = SLAY_WARE_BY_SLUG[ware];
    return good === undefined ? [] : [{ at, type: systems.ATOMIC_EVENT_TYPE_PUT_GOOD_IN_STOCK, value: good }];
  });
  return workClip(name, BREEDER_CLIP_LENGTH, deposits);
}

export const CATAPULT_ANIMATION = 'viking_catapult_attack';

export function buildSandboxAtomicAnimations(): readonly object[] {
  return [
    ...GATHERERS.map((gatherer) =>
      workClip(gatherer.animation, HARVEST_TICKS[gatherer.atomic] ?? 1, [
        { at: gatherer.workEventFrame, type: GATHER_EVENT_TYPE[gatherer.mode] },
      ]),
    ),
    clip(STORE_PICKUP_ANIMATION, STORE_EXCHANGE_LENGTH),
    clip(STORE_PILEUP_ANIMATION, STORE_EXCHANGE_LENGTH),
    clip(WELL_DRAW_ANIMATION, UTILITY_DRAW_LENGTH),
    clip(HIVE_DRAW_ANIMATION, UTILITY_DRAW_LENGTH),
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
    needClip(
      CIVILIST_TALK_ANIMATION,
      CIVILIST_TALK_LENGTH,
      SOCIAL,
      CIVILIST_TALK_PULSE_FRAMES,
      TALK_PULSE_VALUE,
    ),
    needClip(
      CIVILIST_LISTEN_ANIMATION,
      CIVILIST_TALK_LENGTH,
      SOCIAL,
      CIVILIST_TALK_PULSE_FRAMES,
      TALK_PULSE_VALUE,
    ),
    needClip(WOMAN_TALK_ANIMATION, WOMAN_TALK_LENGTH, SOCIAL, WOMAN_TALK_PULSE_FRAMES, TALK_PULSE_VALUE),
    needClip(
      WOMAN_LISTEN_ANIMATION,
      WOMAN_TALK_LENGTH,
      SOCIAL,
      WOMAN_TALK_PULSE_FRAMES,
      LISTEN_QUIET_PULSE_VALUE,
    ),
    ...NEED_CLIPS.map((c) => needClip(c.name, c.length, c.channel, c.frames, c.value)),
    swingClip('viking_fist_attack', FIST_SWING_LENGTH, FIST_HIT_FRAME),
    swingClip('viking_spear_attack', SPEAR_SWING_LENGTH, SPEAR_HIT_FRAME),
    swingClip('viking_sword_attack', SWORD_SWING_LENGTH, SWORD_HIT_FRAME),
    swingClip('viking_broadsword_attack', BROADSWORD_SWING_LENGTH, BROADSWORD_HIT_FRAME),
    swingClip('viking_bow_attack', SHORT_BOW_DRAW_LENGTH, SHORT_BOW_RELEASE_FRAME),
    // The hunter is a civilian trade, so his shot costs him a civilian's swing.
    swingClip('viking_hunter_attack', HUNTER_BOW_DRAW_LENGTH, HUNTER_BOW_RELEASE_FRAME, WORK_DRAIN_VALUE),
    workClip('viking_hunter_harvest_cadaver', HUNTER_HARVEST_CADAVER_LENGTH),
    swingClip('viking_bow_long_attack', LONG_BOW_DRAW_LENGTH, LONG_BOW_RELEASE_FRAME),
    // The catapult crews no body of its own: its shot clip carries only the release.
    clip(CATAPULT_ANIMATION, CATAPULT_SHOT_LENGTH, [{ at: CATAPULT_SHOT_FRAME, type: ATTACK_EVENT_TYPE }]),
    workClip(BUILD_HOUSE_ANIMATION, BUILD_HOUSE_SWING_LENGTH),
    workClip(BUILD_WALL_ANIMATION, BUILD_WALL_SWING_LENGTH),
    workClip(BUILD_GUIDE_ANIMATION, BUILD_GUIDE_SWING_LENGTH),
    clip(CIVILIST_EXERCISE_ANIMATION, CIVILIST_EXERCISE_LENGTH, [
      { at: CIVILIST_EXERCISE_XP_FRAME, type: TRAINING_EXPERIENCE_EVENT_TYPE, value: CIVILIST_EXERCISE_XP },
    ]),
    workClip(FARMER_REAP_ANIMATION, FARMER_REAP_LENGTH, [
      { at: FARMER_REAP_WORK_EVENT_FRAME, type: systems.ATOMIC_EVENT_TYPE_TRANSFORM },
    ]),
    ...CIVILIST_IDLE_SHORT_ANIMATIONS.map((name, slot) => clip(name, CIVILIST_IDLE_SHORT_LENGTHS[slot] ?? 1)),
    workClip(FARMER_SOW_ANIMATION, FARMER_SOW_LENGTH),
    workClip(FARMER_WATER_ANIMATION, FARMER_WATER_LENGTH),
    ...Object.values(BREEDER_PRODUCE_ANIMATION_BY_SPECIES).map((name) => workClip(name, BREEDER_CLIP_LENGTH)),
    ...Object.entries(BREEDER_SLAY_ANIMATION_BY_SPECIES).map(([species, name]) => slayClip(species, name)),
  ];
}
