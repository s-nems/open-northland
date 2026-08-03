import type { DirectionalAnim } from '@open-northland/render';
import {
  CLAY_HARVEST_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  STONE_HARVEST_ATOMIC,
} from '../../catalog/atomics.js';

/**
 * The settler body's named `[bobseq]` clips, their fallback frame ranges, and the per-good harvest
 * durations. Live frame ranges come from the decoded `bobSequences` at load; what lives here is what that
 * data does not carry - which sequence drives which state, the windup offset, and the harvest lengths.
 */
export const DIRS = 8;
export const WALK_SEQ = 'human_man_generic_walk';
// The standing idle loop - the original plays it, not a frozen frame, whenever a settler stands.
export const WAIT_SEQ = 'human_man_generic_wait';
export const CHOP_SEQ = 'human_man_woodcutter_work_woodcutting';
// The collector job's per-good work clips on the generic man body (`cr_hum_body_00`). The original's
// `viking_collector_harvest_*` names are logic atomic animations (timing + events), never body bobseqs; the
// man body authors one clip per trade, which is what the render plays (source basis "Gathering work
// animations"). None is a clean 8-direction strip, so each plays facing-locked on the atomic's clock.
export const SHOVEL_SEQ = 'human_man_clayworker_work_shovel';
// The shared mining strike: `[gfxanimatomic]` actions 25/27/28 (stone, iron, gold) all map to
// `stonecrushing`; the man body authors no separate miner/pickaxe sequence.
export const STONECRUSH_SEQ = 'human_man_stonecrusher_work_stonecrushing';
// The `constructionworker` hammer swing, bound to BUILD_HOUSE_ATOMIC through the `[gfxanimatomic]`
// action-39 per-direction frame lists (13 entries/dir with the impact holds baked in; the 42-frame strip is
// 6 direction blocks, not a clean ×8). The facing-locked whole strip stays as the no-frame-lists fallback.
export const HAMMER_SEQ = 'human_man_constructionworker_Work_Hammer';
/** Sim ticks per hammer frame. Observed-pace approximation: the authored 13-entry swing reads frantically
 *  fast at 1 frame/tick. The construct atomic's duration scales with it, so the whole swing still plays
 *  exactly once per atomic and building slows in step. */
export const HAMMER_TICKS_PER_FRAME = 2;
// The farmer's three field clips - the render side of the original's `setatomic 18 29/34/35` farm loop.
// None is a clean ×8 strip cut (reap 66 / sow 120 / water 96 frames; the `[gfxanimatomic]` job-18 frame
// lists cut 24/23/29 per dir), so they bind through {@link CharacterSpec.dirListAtomics}.
export const REAP_SEQ = 'human_man_farmer_work_reap_grain'; // wheat harvest, atomic 29
export const SOW_SEQ = 'human_man_farmer_work_sow'; // plant, atomic 34
export const WATER_SEQ = 'human_man_farmer_work_water'; // cultivate, atomic 35
export const PICKUP_SEQ = 'human_man_generic_pick_up'; // the mushroom pluck + the carry pickup/deposit
// The loaded gait, bound to the settler's `carrying` override; its first frame holds a still loaded pose
// while it deposits.
export const WALK_WOOD_SEQ = 'human_man_generic_walk_wood';

// The known-good ranges (verified against an owned copy: walk 1988/96, chop 5106/120, walk_wood 4580/96),
// kept as the fallback when the manifest is absent.
export const FALLBACK_WALK: DirectionalAnim = { start: 1988, dirs: DIRS, stride: 12 };
// Fallback-path chop tuning (used when the IR carries no `[gfxanimatomic]` frame lists). In the 15-frame
// woodcut bobseq frames 0..8 are the axe coming down (impact ~frame 8) and 9..14 the axe rising, so the
// cycle starts at the windup to end on the strike. One frame per tick.
export const CHOP_PHASE_START = 9;
/** Frames per facing in the woodcut swing (verified 5106/120 = 15 across the 8 dirs). Wood's
 *  {@link HARVEST_TICKS} duration (30) is exactly two full swings of this stride. One clean swing needs
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
// The idle/wait loop (verified against an owned copy: 1931/57). 57 is not a clean ×8, so wait plays as a
// single-direction animation (`dirs: 1`, the whole 57-frame strip).
export const FALLBACK_WAIT: DirectionalAnim = { start: 1931, dirs: 1, stride: 57 };

/**
 * How many times one mushroom pick plays the authored `pick_up` pluck list back-to-back. The original's
 * 35-tick logic cycle looped the 19-frame list (~two bends per pick), and one-shot playback reads visibly
 * too fast. Observed-pace approximation.
 */
export const MUSHROOM_PLUCKS_PER_PICK = 3;
/** The viking `pick_up` `[gfxanimatomic]` list length (action 32, single facing-locked direction). Pinned
 *  so {@link HARVEST_TICKS} stays static content; the sheet builder warns when the extracted list drifts
 *  from this pin. */
export const MUSHROOM_PLUCK_FRAMES = 19;
/** Ticks the picker stands in the ready stance after the last bend, pinned locally so it tunes apart from
 *  the miners' inter-swing rest (sim `HARVEST_REST_TICKS`). */
const MUSHROOM_PLUCK_BREATHER_TICKS = 15;

/**
 * Per-good harvest durations in ticks: the `atomicanimations.ini` lengths of the collector's harvest
 * atomics (`viking_collector_harvest_*`), except iron/gold where the gfx frame-list length wins. One cycle
 * is one authored work motion with its pauses baked in.
 */
export const HARVEST_TICKS: Readonly<Record<number, number>> = {
  [HARVEST_ATOMIC]: 30, // wood     - viking_collector_harvest_tree
  [STONE_HARVEST_ATOMIC]: 29, // stone - viking_collector_harvest_stone
  [CLAY_HARVEST_ATOMIC]: 23, // clay/mud - viking_collector_harvest_mud
  // Iron/gold: the logic length is 23, but their gfx frame list is the shared 29-entry stonecrushing
  // strike and 23 cuts the swing off mid-follow-through, so the list length wins (named approximation).
  [IRON_HARVEST_ATOMIC]: 29, // iron  - viking_collector_harvest_iron (logic 23, gfx list 29)
  [GOLD_HARVEST_ATOMIC]: 29, // gold  - viking_collector_harvest_gold (logic 23, gfx list 29)
  // Mushroom: the pick plays the pluck list MUSHROOM_PLUCKS_PER_PICK times and the atomic covers every
  // bend plus a ready-stance breather; the logic length 35 assumed looping playback (observed pace).
  [MUSHROOM_HARVEST_ATOMIC]: MUSHROOM_PLUCK_FRAMES * MUSHROOM_PLUCKS_PER_PICK + MUSHROOM_PLUCK_BREATHER_TICKS,
};
/**
 * The other atomic ids the sim issues, pinned to the original's `setatomic` table (eat 10 / sleep 8 /
 * pray 12). Kept here rather than imported from sim because they are the animation table's `byAtomic` keys.
 */
export const EAT_ATOMIC = 10;
export const SLEEP_ATOMIC = 8;
export const PRAY_ATOMIC = 12;
