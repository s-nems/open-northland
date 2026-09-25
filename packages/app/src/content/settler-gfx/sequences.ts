import type { DirectionalAnim } from '@open-northland/render';
import {
  CLAY_HARVEST_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  STONE_HARVEST_ATOMIC,
} from '../../catalog/atomics.js';

// Live frame ranges come from the decoded `bobSequences` at load; this module owns what that data does not
// carry - which sequence drives which state, the windup offset, and the harvest lengths.

export const DIRS = 8;
export const WALK_SEQ = 'human_man_generic_walk';
// The standing idle loop - the original plays it, not a frozen frame, whenever a settler stands.
export const WAIT_SEQ = 'human_man_generic_wait';
export const CHOP_SEQ = 'human_man_woodcutter_work_woodcutting';
// The `viking_collector_harvest_*` names are logic atomic animations, never body bobseqs; the generic man
// body authors one work clip per trade instead (source basis "Gathering work animations").
export const SHOVEL_SEQ = 'human_man_clayworker_work_shovel';
// The shared mining strike: `[gfxanimatomic]` actions 25/27/28 (stone, iron, gold) all map to
// `stonecrushing`; the man body authors no separate miner/pickaxe sequence.
export const STONECRUSH_SEQ = 'human_man_stonecrusher_work_stonecrushing';
// The `constructionworker` swing. Its 42-frame strip is 6 direction blocks, not a clean ×8, so only the
// `[gfxanimatomic]` action-39 frame lists (13 entries/dir, impact holds baked in) lay it out.
export const HAMMER_SEQ = 'human_man_constructionworker_Work_Hammer';
/** Sim ticks per hammer frame. Observed-pace approximation: the 13-entry swing reads frantically fast at
 *  1 frame/tick. The construct atomic's duration scales with this, so the swing still plays once per
 *  atomic. */
export const HAMMER_TICKS_PER_FRAME = 2;
// The farmer's three field clips, the render side of `setatomic 18 29/34/35` (reap, sow, water). None is a
// clean ×8 strip cut (66 / 120 / 96 frames; the `[gfxanimatomic]` job-18 lists cut 24/23/29 per dir), so
// only their extracted frame lists lay them out.
export const REAP_SEQ = 'human_man_farmer_work_reap_grain';
export const SOW_SEQ = 'human_man_farmer_work_sow';
export const WATER_SEQ = 'human_man_farmer_work_water';
export const PICKUP_SEQ = 'human_man_generic_pick_up';
export const WALK_WOOD_SEQ = 'human_man_generic_walk_wood';

// The known-good ranges (verified against an owned copy: walk 1988/96, chop 5106/120, walk_wood 4580/96),
// kept as the fallback when the manifest is absent.
export const FALLBACK_WALK: DirectionalAnim = { start: 1988, dirs: DIRS, stride: 12 };
// Fallback-path tuning for an IR with no frame lists: frames 0..8 of the 15-frame woodcut bobseq are the
// axe coming down (impact ~frame 8) and 9..14 the axe rising, so the cycle starts at the windup to end on
// the strike.
export const CHOP_PHASE_START = 9;
/** Frames per facing in the woodcut swing (verified 5106/120 = 15 across the 8 dirs). One clean swing needs
 *  `CHOP_STRIDE + 1` sim ticks, because the render clock is `elapsed - 1` and the completion tick removes
 *  the atomic before its frame draws. */
const CHOP_STRIDE = 15;
export const FALLBACK_CHOP: DirectionalAnim = {
  start: 5106,
  dirs: DIRS,
  stride: CHOP_STRIDE,
  phaseStart: CHOP_PHASE_START,
};
export const FALLBACK_WALK_WOOD: DirectionalAnim = { start: 4580, dirs: DIRS, stride: 12 };
// Verified against an owned copy: 1931/57. 57 is not a clean ×8, so the wait plays facing-locked.
export const FALLBACK_WAIT: DirectionalAnim = { start: 1931, dirs: 1, stride: 57 };

/** How many times one pick plays the `pick_up` pluck list back-to-back. Observed-pace approximation: the
 *  original's 35-tick logic cycle looped the 19-frame list, and one-shot playback reads too fast. */
export const MUSHROOM_PLUCKS_PER_PICK = 3;
/** The viking `pick_up` list length (`[gfxanimatomic]` action 32, one facing-locked direction), pinned so
 *  {@link HARVEST_TICKS} stays static content. */
export const MUSHROOM_PLUCK_FRAMES = 19;
/** Ticks the picker stands in the ready stance after the last bend. */
const MUSHROOM_PLUCK_BREATHER_TICKS = 15;

/**
 * Per-good harvest durations in ticks: the `atomicanimations.ini` lengths of the collector's
 * `viking_collector_harvest_*` atomics, except where an entry notes otherwise. One cycle is one authored
 * work motion with its pauses baked in.
 */
export const HARVEST_TICKS: Readonly<Record<number, number>> = {
  [HARVEST_ATOMIC]: 30,
  [STONE_HARVEST_ATOMIC]: 29,
  [CLAY_HARVEST_ATOMIC]: 23,
  // Iron and gold: the logic length is 23, but their gfx frame list is the shared 29-entry stonecrushing
  // strike and 23 cuts the swing off mid-follow-through, so the list length wins (approximation).
  [IRON_HARVEST_ATOMIC]: 29,
  [GOLD_HARVEST_ATOMIC]: 29,
  // The pick covers every bend plus a ready-stance breather; the logic length 35 assumed looping playback
  // (observed pace).
  [MUSHROOM_HARVEST_ATOMIC]: MUSHROOM_PLUCK_FRAMES * MUSHROOM_PLUCKS_PER_PICK + MUSHROOM_PLUCK_BREATHER_TICKS,
};
/** The remaining atomic ids the animation tables key on, pinned to the original's `setatomic` table. */
export const EAT_ATOMIC = 10;
export const SLEEP_ATOMIC = 8;
export const PRAY_ATOMIC = 12;
