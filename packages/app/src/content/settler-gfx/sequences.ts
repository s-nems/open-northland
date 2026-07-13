import type { DirectionalAnim } from '@vinland/render';
import {
  CLAY_HARVEST_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  STONE_HARVEST_ATOMIC,
} from '../../catalog/atomics.js';

/**
 * The settler body's named `[bobseq]` clips, their known-good FALLBACK ranges, and the per-good harvest
 * DURATIONS — the "which authored clip, how long" data the {@link import('./bindings.js')} reducers and
 * the {@link import('./character-specs.js')} roster read. Frame RANGES themselves come from the decoded
 * `bobSequences` at load; what lives here is the render-taste the data doesn't carry (which sequence
 * drives which state, the windup offset) plus the faithful/observed harvest lengths.
 */
export const DIRS = 8;
export const WALK_SEQ = 'human_man_generic_walk';
// The standing IDLE loop — the settler breathing/shifting weight while it has nothing to do. The original
// plays this (not a frozen frame) whenever a settler stands, so a settler is NEVER a still image. Bound to
// the `idle` state so every standing settler animates; replaces the earlier frame-0 hold of the walk seq.
export const WAIT_SEQ = 'human_man_generic_wait';
export const CHOP_SEQ = 'human_man_woodcutter_work_woodcutting';
// The other authored gathering work clips on the generic man body (`cr_hum_body_00`) — the collector job's
// per-good motions. The original binds the collector's harvest atomics to `viking_collector_harvest_*`, but
// those are LOGIC atomic-animation names (timing + events), never body bobseqs; the man body actually authors
// one clip per trade, which is what the render must play (source basis "Gathering work animations").
// Unlike the ×8 chop these are NOT clean 8-direction strips, so {@link characterBinding} plays them
// facing-locked (the digger faces its pit) — the whole strip on the atomic's clock.
export const SHOVEL_SEQ = 'human_man_clayworker_work_shovel'; // clay/mud — the shovel dig (soft ground)
// The stone-crushing swing IS the original's shared MINING motion (a pickaxe-like strike): the collector
// job maps stone AND iron AND gold to this one clip (`gfxanimatomic`: action 25/27/28 all →
// `stonecrushing`; there is no authored miner/pickaxe sequence on the man body). So the three hard
// minerals dig alike, exactly as the base game wires them (source basis "Gathering work animations").
export const STONECRUSH_SEQ = 'human_man_stonecrusher_work_stonecrushing'; // stone + iron + gold (the mining strike)
// The builder's HAMMER swing on the generic man body (`cr_hum_body_00`) — the `constructionworker` trade's
// authored work clip (the render twin of the logic `viking_builder_build_house` atomic). Bound to
// BUILD_HOUSE_ATOMIC so a settler raising a foundation visibly swings a hammer, exactly as the woodcutter
// swings the axe for the chop (source basis "Gathering/construction work animations"). Not a clean ×8 strip,
// so {@link characterBinding} plays it facing-locked (the builder faces the wall it hammers).
export const HAMMER_SEQ = 'human_man_constructionworker_Work_Hammer';
// The FARMER's three authored field clips on the generic man body — the render side of the original's
// `setatomic 18 29/34/35` farm loop. None is a clean ×8 strip cut (reap 66 / sow 120 / water 96 frames,
// but the per-direction cuts are the `[gfxanimatomic]` job-18 frame LISTS: 24/23/29 frames per dir), so
// they bind through {@link CharacterSpec.dirListAtomics} as directional FrameListAnims — the same
// extracted-frame-list path the attack swings use (source basis "Gathering work animations").
export const REAP_SEQ = 'human_man_farmer_work_reap_grain'; // the scythe sweep (wheat harvest, atomic 29)
export const SOW_SEQ = 'human_man_farmer_work_sow'; // the seed-scatter (plant, atomic 34)
export const WATER_SEQ = 'human_man_farmer_work_water'; // the watering can (cultivate, atomic 35)
export const PICKUP_SEQ = 'human_man_generic_pick_up'; // the bend-and-pick; mushroom's pluck + the carry pickup/deposit
// The LOADED gait — the settler walking while hauling a log. Same directional layout as the empty walk;
// the frames simply carry the wood. Bound to the settler's `carrying` override so a woodcutter walking
// its harvest back to the store plays this instead of the empty walk; its first frame holds a still
// loaded pose while it deposits.
export const WALK_WOOD_SEQ = 'human_man_generic_walk_wood';

// The known-good ranges (verified against an owned copy: walk 1988/96, chop 5106/120, walk_wood 4580/96)
// kept as the FALLBACK when the manifest is absent (a checkout without content/, or an IR predating
// bobSequences) so the real-graphics path still degrades to the right cycles instead of drawing a wrong range.
export const FALLBACK_WALK: DirectionalAnim = { start: 1988, dirs: DIRS, stride: 12 };
// FALLBACK-path chop tuning (used when the IR carries no `[gfxanimatomic]` frame lists — the primary
// binding is the collector's authored per-direction lists via `dirListAtomics` below, one swing with
// its holds per cycle). The 15-frame woodcut bobseq is a continuous loop. Verified by rendering every frame to a filmstrip:
// frames 0..8 are the axe coming DOWN to the tree (the strike, impact ~frame 8) and 9..14 are the axe
// RISING (the windup). So we play the FULL cycle but START at the windup (CHOP_PHASE_START): it plays
// 9..14 (raise the axe) then 0..8 (swing down, impact) — a complete chop that *begins* with the windup
// and *ends* on the strike landing in the tree. Tick-locked cadence (one frame/tick) on the atomic's
// `elapsed`, same speed as every other animation.
export const CHOP_PHASE_START = 9;
/** Frames per facing in the woodcut swing (verified 5106/120 = 15 across the 8 dirs). Wood's duration in
 *  {@link HARVEST_TICKS} (30 — the faithful `atomicanimations.ini` length, an independent pin) happens to
 *  be exactly TWO full swings of this stride, so the chop clip never cuts off mid-swing. NOTE for a future
 *  bare one-swing binding: the render clock is `elapsed - 1` and the completion tick removes the atomic
 *  before its frame draws, so one clean swing needs `CHOP_STRIDE + 1` sim ticks — a shorter duration
 *  replays only the windup (the visible restart glitch). */
const CHOP_STRIDE = 15;
export const FALLBACK_CHOP: DirectionalAnim = {
  start: 5106,
  dirs: DIRS,
  stride: CHOP_STRIDE,
  phaseStart: CHOP_PHASE_START,
};
export const FALLBACK_WALK_WOOD: DirectionalAnim = { start: 4580, dirs: DIRS, stride: 12 };
// The idle/wait loop (verified against an owned copy: 1931/57). 57 isn't a clean ×8, so wait is NOT a
// directional cycle — it's a SINGLE-direction animation (`dirs: 1`, the whole 57-frame strip), the same
// way the gallery's `clipDirs` classifies a non-×8 length (see source basis). Playing the full loop
// (not a facing-sliced 1/8 excerpt) is what makes a standing settler breathe rather than freeze.
export const FALLBACK_WAIT: DirectionalAnim = { start: 1931, dirs: 1, stride: 57 };

// The per-good harvest atomic ids live in the committed catalog (`catalog/atomics.ts`) — the ONE
// app-side declaration of these semantic ids; this module only binds each id to its authored work
// clip in {@link CHARACTER_SPECS} (stone/iron/gold→the shared mining strike, clay→shovel-dig,
// mushroom→pluck), not the shared woodcut swing — so a clay-digger visibly SHOVELS and a miner
// STRIKES, neither chops (source basis).

/**
 * How many times ONE mushroom pick plays the authored `pick_up` pluck list back-to-back — the
 * original's 35-tick logic cycle looped the 19-frame list (~two bends per pick); with one-shot list
 * playback a single bend read visibly too fast (reported), so the sheet builder repeats the list
 * this many times and {@link HARVEST_TICKS} sizes the atomic to fit. Observed-pace approximation.
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
 * Per-good harvest DURATIONS (ticks) — the ONE global source so gathering pace can't drift per scene.
 * The FAITHFUL `atomicanimations.ini` lengths of the collector's harvest atomics
 * (`viking_collector_harvest_*`, content/ir.json), except iron/gold where the gfx frame-list length
 * wins (see the entries). A cycle is ONE authored work motion with its pauses
 * baked in: the collector clips play their `[gfxanimatomic]` per-direction frame LISTS (the
 * `dirListAtomics` binding below), whose entries carry the impact hold and the trailing idle pad — the
 * woodcut list is `windup → strike → 4-frame impact hold → follow-through → 4-frame rest`, one chop per
 * 30-tick cycle, exactly the original's cadence. (The former 60-tick "observed" mined pace compensated
 * for playing only the OPENING of the raw 174-frame stonecrusher strip; with the authored lists that
 * divergence is retired.) A scene declares each harvest atomic's `atomicAnimations` length from here.
 */
export const HARVEST_TICKS: Readonly<Record<number, number>> = {
  [HARVEST_ATOMIC]: 30, // wood     — viking_collector_harvest_tree
  [STONE_HARVEST_ATOMIC]: 29, // stone — viking_collector_harvest_stone
  [CLAY_HARVEST_ATOMIC]: 23, // clay/mud — viking_collector_harvest_mud
  // Iron/gold: the logic length is 23 but their gfx frame LIST is the shared 29-entry stonecrushing
  // strike — 23 cut the swing off mid-follow-through (the reported "ucięta" glitch), so the list
  // length wins here (a named approximation: gfx over logic, +0.3 s per swing).
  [IRON_HARVEST_ATOMIC]: 29, // iron  — viking_collector_harvest_iron (logic 23, gfx list 29)
  [GOLD_HARVEST_ATOMIC]: 29, // gold  — viking_collector_harvest_gold (logic 23, gfx list 29)
  // Mushroom: the logic length 35 LOOPED the 19-frame pluck in the original (~two bends per pick);
  // our one-shot lists play it once, which read visibly too fast. The pick plays the pluck
  // MUSHROOM_PLUCKS_PER_PICK times (the list is repeated at sheet build, sprite-sheet/characters.ts) and the
  // atomic covers every bend plus a ready-stance breather (observed pace, gfx over logic).
  [MUSHROOM_HARVEST_ATOMIC]: MUSHROOM_PLUCK_FRAMES * MUSHROOM_PLUCKS_PER_PICK + MUSHROOM_PLUCK_BREATHER_TICKS,
};
/**
 * The other atomic ids the SIM issues today, transcribed from the sim's planners (`ai.ts` eat 10 /
 * sleep 8 / pray 12 — themselves pinned to the original's `setatomic` table): the `byAtomic` join
 * keys the character specs bind body animations to. Kept here (not imported from sim) because they
 * are the ANIMATION table's keys — the same numeric contract the original's `tribetypes` uses,
 * stable across both packages. The store-exchange pair (22/23) is the shared catalog vocabulary
 * (`catalog/atomics.ts` STORE_PICKUP/PILEUP_ATOMIC), imported by the character specs.
 */
export const EAT_ATOMIC = 10;
export const SLEEP_ATOMIC = 8;
export const PRAY_ATOMIC = 12;
