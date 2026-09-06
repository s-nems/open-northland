import type { AtomicEvent } from '@open-northland/data';
import { systems } from '@open-northland/sim';

// The need clips, transcribed from the mod's `atomicanimations12/atomicanimations.ini`. A settler's meals,
// rest and prayer are worth exactly what these `event <at> <channel> <delta>` rows say, so the committed
// catalog has to carry them for a world running without an owned copy.

/** One transcribed need clip: its length and the frames its equal pulses land on. */
export interface NeedClip {
  readonly name: string;
  readonly length: number;
  readonly channel: number;
  readonly frames: readonly number[];
  readonly value: number;
}

const { REST, HUNGER, PIETY } = systems.ATOMIC_EVENT_CHANNEL;

/** A meal is one pulse two thirds in; the soldier and woman bodies eat the same meal as the civilist. */
const EAT_LENGTH = 50;
const EAT_FRAMES = [30] as const;
const EAT_VALUE = 4000;

/** Rest arrives in equal pulses: one for the woman, two for the civilist, four for the soldier, and the
 *  civilist's at-home twin packs its two into a fifth of the time. */
const SLEEP_VALUE = 4000;

export const CIVILIST_EAT_ANIMATION = 'viking_civilist_eat_slot_food';
export const WOMAN_EAT_ANIMATION = 'viking_woman_eat_slot_food';
export const SOLDIER_EAT_ANIMATION = 'viking_soldier_eat_unarmed';
export const CIVILIST_SLEEP_ANIMATION = 'viking_civilist_sleep';
export const WOMAN_SLEEP_ANIMATION = 'viking_woman_sleep';
export const SOLDIER_SLEEP_ANIMATION = 'viking_soldier_sleep';
export const CIVILIST_PRAY_ANIMATION = 'viking_civilist_pray';

export const NEED_CLIPS: readonly NeedClip[] = [
  { name: CIVILIST_EAT_ANIMATION, length: EAT_LENGTH, channel: HUNGER, frames: EAT_FRAMES, value: EAT_VALUE },
  { name: WOMAN_EAT_ANIMATION, length: EAT_LENGTH, channel: HUNGER, frames: EAT_FRAMES, value: EAT_VALUE },
  { name: SOLDIER_EAT_ANIMATION, length: EAT_LENGTH, channel: HUNGER, frames: EAT_FRAMES, value: EAT_VALUE },
  { name: CIVILIST_SLEEP_ANIMATION, length: 237, channel: REST, frames: [60, 200], value: SLEEP_VALUE },
  // The at-home twin no `setatomic` binds; the sim resolves it by the `<clip>_home` name.
  {
    name: `${CIVILIST_SLEEP_ANIMATION}_home`,
    length: 50,
    channel: REST,
    frames: [40, 45],
    value: SLEEP_VALUE,
  },
  { name: WOMAN_SLEEP_ANIMATION, length: 100, channel: REST, frames: [20], value: SLEEP_VALUE },
  {
    name: SOLDIER_SLEEP_ANIMATION,
    length: 237,
    channel: REST,
    frames: [30, 80, 120, 200],
    value: SLEEP_VALUE,
  },
  {
    name: CIVILIST_PRAY_ANIMATION,
    length: 100,
    channel: PIETY,
    frames: [20, 40, 60, 80, 95],
    value: 800,
  },
];

/** What one swing costs its worker in rest and in food. A trained fighter's costs a fifth of that: the
 *  soldier and hero attack clips all carry `-20` where every civilian clip carries `-100`. */
export const WORK_DRAIN_VALUE = -100;
export const SOLDIER_SWING_DRAIN_VALUE = -20;

/** Where the drain lands. Every extracted attack clip fires its own on frame 2; the work clips scatter
 *  from a tenth to two fifths in, so a single ratio for them is authored. */
const WORK_DRAIN_FRAME_RATIO = 0.4;
const SWING_DRAIN_FRAME = 2;

type ClipEvent = Omit<AtomicEvent, 'extended'>;

/** The `event <at> 1 <drain>` / `<at> 2 <drain>` pair, on the rest and food channels both. */
function drainPair(at: number, value: number): readonly ClipEvent[] {
  return [
    { at, type: REST, value },
    { at, type: HUNGER, value },
  ];
}

/** The drain a work clip of `length` carries. */
export function workDrainEvents(length: number): readonly ClipEvent[] {
  return drainPair(Math.max(1, Math.round(length * WORK_DRAIN_FRAME_RATIO)), WORK_DRAIN_VALUE);
}

/** The drain an attack clip carries, `value` telling a trained fighter's swing from a civilian's. */
export function swingDrainEvents(value: number): readonly ClipEvent[] {
  return drainPair(SWING_DRAIN_FRAME, value);
}
