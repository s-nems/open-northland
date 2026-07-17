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
 * durations, read by the {@link import('./bindings.js')} reducers and the
 * {@link import('./character-specs.js')} roster. Live frame ranges come from the decoded `bobSequences` at
 * load; what lives here is what that data doesn't carry — which sequence drives which state, the windup
 * offset, and the harvest lengths.
 */
export const DIRS = 8;
export const WALK_SEQ = 'human_man_generic_walk';
// The standing idle loop — the original plays it, not a frozen frame, whenever a settler stands.
export const WAIT_SEQ = 'human_man_generic_wait';
export const CHOP_SEQ = 'human_man_woodcutter_work_woodcutting';
// The collector job's per-good work clips on the generic man body (`cr_hum_body_00`). The original's
// `viking_collector_harvest_*` names are logic atomic animations (timing + events), never body bobseqs; the
// man body authors one clip per trade, which is what the render plays (source basis "Gathering work
// animations"). Unlike the ×8 chop these are not clean 8-direction strips, so {@link characterBinding}
// plays the whole strip facing-locked on the atomic's clock.
export const SHOVEL_SEQ = 'human_man_clayworker_work_shovel'; // clay/mud — the shovel dig (soft ground)
// The original's shared mining strike: the collector job maps stone, iron and gold to this one clip
// (`[gfxanimatomic]` actions 25/27/28 all → `stonecrushing`; the man body authors no separate
// miner/pickaxe sequence).
export const STONECRUSH_SEQ = 'human_man_stonecrusher_work_stonecrushing';
// The `constructionworker` trade's hammer swing on the generic man body — the render twin of the logic
// `viking_builder_build_house` atomic. Bound to BUILD_HOUSE_ATOMIC through the `[gfxanimatomic]` action-39
// per-direction frame lists (13 entries/dir with the impact holds baked in — the 42-frame strip is 6
// direction blocks, not a clean ×8); the facing-locked whole strip stays only as the no-frame-lists
// fallback (source basis "Gathering work animations").
export const HAMMER_SEQ = 'human_man_constructionworker_Work_Hammer';
/** Sim ticks per hammer frame. User-tuned approximation: the authored 13-entry swing at the default
 *  1 frame/tick read frantically fast. The construct atomic's duration scales with it
 *  ({@link import('../../game/sandbox/work-animations.js').BUILD_HOUSE_SWING_LENGTH}) so the whole swing
 *  still plays exactly once per atomic, and building slows in step. */
export const HAMMER_TICKS_PER_FRAME = 2;
// The farmer's three field clips — the render side of the original's `setatomic 18 29/34/35` farm loop.
// None is a clean ×8 strip cut (reap 66 / sow 120 / water 96 frames; the per-direction cuts are the
// `[gfxanimatomic]` job-18 frame lists at 24/23/29 frames per dir), so they bind through
// {@link CharacterSpec.dirListAtomics} as directional FrameListAnims (source basis "Gathering work
// animations").
export const REAP_SEQ = 'human_man_farmer_work_reap_grain'; // the scythe sweep (wheat harvest, atomic 29)
export const SOW_SEQ = 'human_man_farmer_work_sow'; // the seed-scatter (plant, atomic 34)
export const WATER_SEQ = 'human_man_farmer_work_water'; // the watering can (cultivate, atomic 35)
export const PICKUP_SEQ = 'human_man_generic_pick_up'; // the bend-and-pick; mushroom's pluck + the carry pickup/deposit
// The loaded gait — hauling a log, same directional layout as the empty walk. Bound to the settler's
// `carrying` override; its first frame holds a still loaded pose while it deposits.
export const WALK_WOOD_SEQ = 'human_man_generic_walk_wood';

// The known-good ranges (verified against an owned copy: walk 1988/96, chop 5106/120, walk_wood 4580/96)
// kept as the fallback when the manifest is absent (a checkout without content/, or an IR predating
// bobSequences) so the real-graphics path still degrades to the right cycles instead of a wrong range.
export const FALLBACK_WALK: DirectionalAnim = { start: 1988, dirs: DIRS, stride: 12 };
// Fallback-path chop tuning (used when the IR carries no `[gfxanimatomic]` frame lists). The 15-frame
// woodcut bobseq is a continuous loop whose frames 0..8 are the axe coming down (impact ~frame 8) and 9..14
// the axe rising (verified by rendering every frame to a filmstrip), so the cycle starts at the windup to
// end on the strike. Tick-locked cadence (one frame/tick).
export const CHOP_PHASE_START = 9;
/** Frames per facing in the woodcut swing (verified 5106/120 = 15 across the 8 dirs). Wood's duration in
 *  {@link HARVEST_TICKS} (30 — the `atomicanimations.ini` length, an independent pin) is exactly two full
 *  swings of this stride, so the chop clip never cuts off mid-swing. */
const CHOP_STRIDE = 15;
export const FALLBACK_CHOP: DirectionalAnim = {
  start: 5106,
  dirs: DIRS,
  stride: CHOP_STRIDE,
  phaseStart: CHOP_PHASE_START,
};
export const FALLBACK_WALK_WOOD: DirectionalAnim = { start: 4580, dirs: DIRS, stride: 12 };
// The idle/wait loop (verified against an owned copy: 1931/57). 57 isn't a clean ×8, so wait is a
// single-direction animation (`dirs: 1`, the whole 57-frame strip), the way the gallery's `clipDirs`
// classifies a non-×8 length (see source basis).
export const FALLBACK_WAIT: DirectionalAnim = { start: 1931, dirs: 1, stride: 57 };

/**
 * How many times one mushroom pick plays the authored `pick_up` pluck list back-to-back — the original's
 * 35-tick logic cycle looped the 19-frame list (~two bends per pick), while one-shot list playback read
 * visibly too fast, so the sheet builder repeats the list this many times and {@link HARVEST_TICKS} sizes
 * the atomic to fit. Observed-pace approximation.
 */
export const MUSHROOM_PLUCKS_PER_PICK = 3;
/** The viking `pick_up` `[gfxanimatomic]` list length (action 32, single facing-locked direction).
 *  Pinned so {@link HARVEST_TICKS} stays static content; the sheet builder warns when the extracted
 *  list drifts from this pin (the duration would then cut or pad the repeated motion). */
export const MUSHROOM_PLUCK_FRAMES = 19;
/** Ticks the picker stands in the ready stance after the last bend — the same breather feel as the
 *  miners' inter-swing rest (sim `HARVEST_REST_TICKS`), pinned locally so the two paces tune apart. */
const MUSHROOM_PLUCK_BREATHER_TICKS = 15;

/**
 * Per-good harvest durations (ticks) — the one global source so gathering pace can't drift per scene: the
 * `atomicanimations.ini` lengths of the collector's harvest atomics (`viking_collector_harvest_*`,
 * content/ir.json), except iron/gold where the gfx frame-list length wins (see the entries). A cycle is one
 * authored work motion with its pauses baked in — the woodcut frame list is
 * `windup → strike → 4-frame impact hold → follow-through → 4-frame rest`, one chop per 30-tick cycle.
 */
export const HARVEST_TICKS: Readonly<Record<number, number>> = {
  [HARVEST_ATOMIC]: 30, // wood     — viking_collector_harvest_tree
  [STONE_HARVEST_ATOMIC]: 29, // stone — viking_collector_harvest_stone
  [CLAY_HARVEST_ATOMIC]: 23, // clay/mud — viking_collector_harvest_mud
  // Iron/gold: the logic length is 23 but their gfx frame list is the shared 29-entry stonecrushing
  // strike, and 23 cut the swing off mid-follow-through — so the list length wins (a named approximation:
  // gfx over logic, +0.3 s per swing).
  [IRON_HARVEST_ATOMIC]: 29, // iron  — viking_collector_harvest_iron (logic 23, gfx list 29)
  [GOLD_HARVEST_ATOMIC]: 29, // gold  — viking_collector_harvest_gold (logic 23, gfx list 29)
  // Mushroom: the pick plays the pluck list MUSHROOM_PLUCKS_PER_PICK times (repeated at sheet build,
  // sprite-sheet/characters.ts) and the atomic covers every bend plus a ready-stance breather — the logic
  // length 35 assumed the original's looping playback (observed pace, gfx over logic).
  [MUSHROOM_HARVEST_ATOMIC]: MUSHROOM_PLUCK_FRAMES * MUSHROOM_PLUCKS_PER_PICK + MUSHROOM_PLUCK_BREATHER_TICKS,
};
/**
 * The other atomic ids the sim issues, transcribed from the sim's planners (`ai.ts` eat 10 / sleep 8 /
 * pray 12 — themselves pinned to the original's `setatomic` table). Kept here rather than imported from sim
 * because they are the animation table's `byAtomic` keys — the same numeric contract the original's
 * `tribetypes` uses. The store-exchange pair (22/23) lives in the shared `catalog/atomics.ts` instead.
 */
export const EAT_ATOMIC = 10;
export const SLEEP_ATOMIC = 8;
export const PRAY_ATOMIC = 12;
