import type {
  BuildingBobRef,
  CarryingBinding,
  ConstructionLayerRef,
  DirectionalAnim,
  FrameListAnim,
  ResourceTypeBinding,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteBindings,
  SpriteFrameRef,
  StockpileBinding,
} from '@vinland/render';
import {
  ATTACK_ATOMIC,
  BUILD_HOUSE_ATOMIC,
  CLAY_HARVEST_ATOMIC,
  CULTIVATE_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  PLANT_ATOMIC,
  STONE_HARVEST_ATOMIC,
  STORE_PICKUP_ATOMIC,
  STORE_PILEUP_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../catalog/atomics.js';
import { CIVILIST_JOB_HEADS } from '../catalog/roster.js';
import { HOUSE_BOB, TREE_BOB, VIKING_HOUSE01_BOBS } from './building-gfx.js';
import type { BobSeqRow } from './ir.js';

/**
 * The settler render binding: turn one body's decoded `[bobseq]` ranges into the directional, tick-animated
 * state bindings the renderer plays (walk / idle / chop / carry), and hold the per-job character roster
 * (the `[jobbasegraphics]` join). A settler is composed of two layered bob sets — a **body**
 * (`CR_Hum_Body_*`) and a **head** (`CR_Hum_Head_*`), the head drawn on top at the same bob id — exactly
 * as the original's `jobgraphics` (`gfxbobmanagerbody` + `gfxbobmanagerhead`) compose a human. Every
 * reducer here is pure + unit-tested without a browser; the byte loading + sheet assembly live in
 * {@link import('./sprite-sheet.js')}.
 *
 * The frame RANGES (start + length) are read from the IR's `bobSequences` (the `extractBobSequences`
 * pipeline leg) by sequence name and turned into a {@link DirectionalAnim} via {@link directionalAnimFromSeq}
 * (`stride = length / DIRS`). What stays in code is the render-taste tuning the data does not carry: which
 * sequence drives which state, the `phaseStart` windup offset, and the single-frame idle hold.
 */
const DIRS = 8;
const WALK_SEQ = 'human_man_generic_walk';
// The standing IDLE loop — the settler breathing/shifting weight while it has nothing to do. The original
// plays this (not a frozen frame) whenever a settler stands, so a settler is NEVER a still image. Bound to
// the `idle` state so every standing settler animates; replaces the earlier frame-0 hold of the walk seq.
const WAIT_SEQ = 'human_man_generic_wait';
const CHOP_SEQ = 'human_man_woodcutter_work_woodcutting';
// The other authored gathering work clips on the generic man body (`cr_hum_body_00`) — the collector job's
// per-good motions. The original binds the collector's harvest atomics to `viking_collector_harvest_*`, but
// those are LOGIC atomic-animation names (timing + events), never body bobseqs; the man body actually authors
// one clip per trade, which is what the render must play (source basis "Gathering work animations").
// Unlike the ×8 chop these are NOT clean 8-direction strips, so {@link characterBinding} plays them
// facing-locked (the digger faces its pit) — the whole strip on the atomic's clock.
const SHOVEL_SEQ = 'human_man_clayworker_work_shovel'; // clay/mud — the shovel dig (soft ground)
// The stone-crushing swing IS the original's shared MINING motion (a pickaxe-like strike): the collector
// job maps stone AND iron AND gold to this one clip (`gfxanimatomic`: action 25/27/28 all →
// `stonecrushing`; there is no authored miner/pickaxe sequence on the man body). So the three hard
// minerals dig alike, exactly as the base game wires them (source basis "Gathering work animations").
const STONECRUSH_SEQ = 'human_man_stonecrusher_work_stonecrushing'; // stone + iron + gold (the mining strike)
// The builder's HAMMER swing on the generic man body (`cr_hum_body_00`) — the `constructionworker` trade's
// authored work clip (the render twin of the logic `viking_builder_build_house` atomic). Bound to
// BUILD_HOUSE_ATOMIC so a settler raising a foundation visibly swings a hammer, exactly as the woodcutter
// swings the axe for the chop (source basis "Gathering/construction work animations"). Not a clean ×8 strip,
// so {@link characterBinding} plays it facing-locked (the builder faces the wall it hammers).
const HAMMER_SEQ = 'human_man_constructionworker_Work_Hammer';
// The FARMER's three authored field clips on the generic man body — the render side of the original's
// `setatomic 18 29/34/35` farm loop. None is a clean ×8 strip cut (reap 66 / sow 120 / water 96 frames,
// but the per-direction cuts are the `[gfxanimatomic]` job-18 frame LISTS: 24/23/29 frames per dir), so
// they bind through {@link CharacterSpec.dirListAtomics} as directional FrameListAnims — the same
// extracted-frame-list path the attack swings use (source basis "Gathering work animations").
const REAP_SEQ = 'human_man_farmer_work_reap_grain'; // the scythe sweep (wheat harvest, atomic 29)
const SOW_SEQ = 'human_man_farmer_work_sow'; // the seed-scatter (plant, atomic 34)
const WATER_SEQ = 'human_man_farmer_work_water'; // the watering can (cultivate, atomic 35)
const PICKUP_SEQ = 'human_man_generic_pick_up'; // the bend-and-pick; mushroom's pluck + the carry pickup/deposit
// The LOADED gait — the settler walking while hauling a log. Same directional layout as the empty walk;
// the frames simply carry the wood. Bound to the settler's `carrying` override so a woodcutter walking
// its harvest back to the store plays this instead of the empty walk; its first frame holds a still
// loaded pose while it deposits.
const WALK_WOOD_SEQ = 'human_man_generic_walk_wood';

// The known-good ranges (verified against an owned copy: walk 1988/96, chop 5106/120, walk_wood 4580/96)
// kept as the FALLBACK when the manifest is absent (a checkout without content/, or an IR predating
// bobSequences) so the real-graphics path still degrades to the right cycles instead of drawing a wrong range.
const FALLBACK_WALK: DirectionalAnim = { start: 1988, dirs: DIRS, stride: 12 };
// FALLBACK-path chop tuning (used when the IR carries no `[gfxanimatomic]` frame lists — the primary
// binding is the collector's authored per-direction lists via `dirListAtomics` below, one swing with
// its holds per cycle). The 15-frame woodcut bobseq is a continuous loop. Verified by rendering every frame to a filmstrip:
// frames 0..8 are the axe coming DOWN to the tree (the strike, impact ~frame 8) and 9..14 are the axe
// RISING (the windup). So we play the FULL cycle but START at the windup (CHOP_PHASE_START): it plays
// 9..14 (raise the axe) then 0..8 (swing down, impact) — a complete chop that *begins* with the windup
// and *ends* on the strike landing in the tree. Tick-locked cadence (one frame/tick) on the atomic's
// `elapsed`, same speed as every other animation.
const CHOP_PHASE_START = 9;
/** Frames per facing in the woodcut swing (verified 5106/120 = 15 across the 8 dirs). Wood's duration in
 *  {@link HARVEST_TICKS} (30 — the faithful `atomicanimations.ini` length, an independent pin) happens to
 *  be exactly TWO full swings of this stride, so the chop clip never cuts off mid-swing. NOTE for a future
 *  bare one-swing binding: the render clock is `elapsed - 1` and the completion tick removes the atomic
 *  before its frame draws, so one clean swing needs `CHOP_STRIDE + 1` sim ticks — a shorter duration
 *  replays only the windup (the visible restart glitch). */
const CHOP_STRIDE = 15;
const FALLBACK_CHOP: DirectionalAnim = {
  start: 5106,
  dirs: DIRS,
  stride: CHOP_STRIDE,
  phaseStart: CHOP_PHASE_START,
};
const FALLBACK_WALK_WOOD: DirectionalAnim = { start: 4580, dirs: DIRS, stride: 12 };
// The idle/wait loop (verified against an owned copy: 1931/57). 57 isn't a clean ×8, so wait is NOT a
// directional cycle — it's a SINGLE-direction animation (`dirs: 1`, the whole 57-frame strip), the same
// way the gallery's `clipDirs` classifies a non-×8 length (see source basis). Playing the full loop
// (not a facing-sliced 1/8 excerpt) is what makes a standing settler breathe rather than freeze.
const FALLBACK_WAIT: DirectionalAnim = { start: 1931, dirs: 1, stride: 57 };

// The per-good harvest atomic ids live in the committed catalog (`catalog/atomics.ts`) — the ONE
// app-side declaration of these semantic ids; this module only binds each id to its authored work
// clip in {@link CHARACTER_SPECS} below (stone/iron/gold→the shared mining strike, clay→shovel-dig,
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
  // MUSHROOM_PLUCKS_PER_PICK times (the list is repeated at sheet build, sprite-sheet.ts) and the
  // atomic covers every bend plus a ready-stance breather (observed pace, gfx over logic).
  [MUSHROOM_HARVEST_ATOMIC]: MUSHROOM_PLUCK_FRAMES * MUSHROOM_PLUCKS_PER_PICK + MUSHROOM_PLUCK_BREATHER_TICKS,
};
/**
 * The other atomic ids the SIM issues today, transcribed from the sim's planners (`ai.ts` eat 10 /
 * sleep 8 / pray 12 — themselves pinned to the original's `setatomic` table): the `byAtomic` join
 * keys the character specs bind body animations to. Kept here (not imported from sim) because they
 * are the ANIMATION table's keys — the same numeric contract the original's `tribetypes` uses,
 * stable across both packages. The store-exchange pair (22/23) is the shared catalog vocabulary
 * (`catalog/atomics.ts` STORE_PICKUP/PILEUP_ATOMIC), imported above.
 */
const EAT_ATOMIC = 10;
const SLEEP_ATOMIC = 8;
const PRAY_ATOMIC = 12;

/**
 * Build a {@link DirectionalAnim} from a decoded `[bobseq]` sequence: `start` is the run's first bob id,
 * `stride = length / DIRS` (the per-direction frame count). Returns {@link fallback} verbatim when the
 * named sequence is missing from the manifest (a partial/old IR), so the render keeps the known-good
 * range rather than computing a bogus one. The render-taste overrides (`frames` for a single-frame idle
 * hold, `phaseStart` for the chop windup) are applied on top of the extracted range. Pure + exported so
 * the seq→frame math is unit-tested without a browser.
 */
export function directionalAnimFromSeq(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  name: string,
  extra: { readonly frames?: number; readonly phaseStart?: number },
  fallback: DirectionalAnim,
): DirectionalAnim {
  const seq = seqByName.get(name);
  if (seq === undefined || seq.length <= 0) return fallback;
  return {
    start: seq.start,
    dirs: DIRS,
    stride: Math.floor(seq.length / DIRS),
    // exactOptionalPropertyTypes: only set an optional key when it has a value.
    ...(extra.frames !== undefined ? { frames: extra.frames } : {}),
    ...(extra.phaseStart !== undefined ? { phaseStart: extra.phaseStart } : {}),
  };
}

/**
 * The demo binding into the human atlases — the render twin of the global sandbox content.
 * The settler's walk/chop ranges are derived from `seqByName` (the extracted `bobSequences` for
 * `cr_hum_body_00.bmd`), so there are no hard-coded frame ids left here; an absent manifest falls back to
 * the known-good `FALLBACK_*` ranges. The building's per-type bobs **overlay** the extracted
 * `houseBobsByType` (the `buildingBobs` join, see {@link import('./building-gfx.js').buildingBobRefsByType})
 * onto the transcribed {@link VIKING_HOUSE01_BOBS} **per type**: real data wins where present, the constant
 * covers any of its five known types the data is missing (so a partial/absent IR degrades gracefully
 * type-by-type instead of dropping a whole family to the generic box). A `houseBobsByType` value may be
 * layer-qualified (a `{ layer, bob }` {@link BuildingBobRef} into a named
 * {@link import('@vinland/render').SpriteSheet.families} atlas — the HQ's viking4 family); the constant's
 * values are bare ids drawn from the default `building` layer. `building`/`resource` resolve in their own
 * per-kind layers (see {@link import('./sprite-sheet.js').loadHumanSpriteSheet}'s `kindLayers`), so their
 * ids index the house/tree bobs, not the body's.
 */
export function buildHumanBindings(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  houseBobsByType?: Readonly<Record<number, BuildingBobRef>>,
  constructionByType?: Readonly<Record<number, readonly ConstructionLayerRef[]>>,
  resourceBinding?: ResourceTypeBinding,
  stockpileBinding?: StockpileBinding,
  stumpBinding?: ResourceTypeBinding,
  trunkBinding?: ResourceTypeBinding,
  berryBushBinding?: ResourceTypeBinding,
): SpriteBindings {
  const walk = directionalAnimFromSeq(seqByName, WALK_SEQ, {}, FALLBACK_WALK);
  // Idle is the WAIT animation played as ONE direction (its length isn't a clean ×8, so it isn't a
  // directional cycle — the original plays it locked to a facing; source basis). The FULL loop, so a
  // standing settler breathes — not a frozen frame, and not a truncated facing-sliced 1/8 excerpt.
  const wait: DirectionalAnim = singleDirAnim(seqByName.get(WAIT_SEQ)) ?? FALLBACK_WAIT;
  const chop = directionalAnimFromSeq(seqByName, CHOP_SEQ, { phaseStart: CHOP_PHASE_START }, FALLBACK_CHOP);
  const walkWood = directionalAnimFromSeq(seqByName, WALK_WOOD_SEQ, {}, FALLBACK_WALK_WOOD);
  const standWood = directionalAnimFromSeq(
    seqByName,
    WALK_WOOD_SEQ,
    { frames: 1 },
    { ...FALLBACK_WALK_WOOD, frames: 1 },
  );
  return {
    // CHOP is bound ONLY to the harvest atomic. There is intentionally no generic `acting` swing: an
    // unmapped action (a carrier/woodcutter depositing or picking up — atomics 22/23) falls back to a
    // STANDING pose, NOT a borrowed woodcut swing. Borrowing it made a 4-tick deposit replay the 15-frame
    // axe swing at ~4× speed (a fast, truncated chop) — the very glitch this binding removes.
    //
    // `carrying` is the loaded-gait override: once the woodcutter picks up its wood it walks the loaded
    // gait instead of the empty walk, and stands a loaded pose while it deposits. The chop still wins
    // while harvesting because a settler only carries *after* the harvest.
    settler: {
      idle: wait,
      moving: walk,
      byAtomic: { [HARVEST_ATOMIC]: chop },
      // Loaded-idle stays a still standing pose: the data has no loaded WAIT loop (hands full), and a
      // carrier only stands loaded for the brief deposit transient, so a hold reads fine here.
      carrying: { idle: standWood, moving: walkWood },
    },
    // Each viking building type draws its own house bob (the `[GfxHouse]` `LogicType` → `GfxBobId` join),
    // data-driven from the extracted `buildingBobs` IR overlaid onto the transcribed VIKING_HOUSE01_BOBS:
    // real data wins per type, the constant backs its five known types when the IR is partial/absent
    // ({...undefined} / {...{}} spread to nothing → just the constant). A type in NEITHER falls back to
    // the representative HOUSE_BOB via BuildingTypeBinding.default.
    building: {
      byType: { ...VIKING_HOUSE01_BOBS, ...houseBobsByType },
      default: HOUSE_BOB,
      // Construction-stage layers per type (the `GfxBobConstructionLayer` join) — an under-construction
      // building draws its progress-gated stage stack instead of the finished body. Absent/empty when
      // the IR is missing (`{...undefined}` spreads to nothing → no table → body draw at every progress).
      ...(constructionByType !== undefined && Object.keys(constructionByType).length > 0
        ? { constructionByType }
        : {}),
    },
    // Each gathered good draws its own standing node (the `landscapeToHarvest` join, built from the
    // Step-1 gathering pipeline — a tree for wood, a rock for stone, a mine for iron/gold/clay, a
    // mushroom), overlaid onto the yew fallback. Absent (a checkout without the join) → the plain
    // TREE_BOB every resource used to draw. See resource-gfx.ts.
    resource: resourceBinding ?? TREE_BOB,
    // Dropped ground piles draw their good's own `ls_goods` heap (growing with the pile's contents) and a
    // bare/empty pile draws the delivery flag. Omitted (no join) → a stockpile draws the placeholder heap.
    ...(stockpileBinding !== undefined ? { stockpile: stockpileBinding } : {}),
    // A felled tree's stump draws the dead-tree/debris frame (`ls_trees_dead`). Omitted (no join) → the
    // stump draws the placeholder. See resource-gfx.ts (resolveStumpRef).
    ...(stumpBinding !== undefined ? { stump: stumpBinding } : {}),
    // A freshly-felled trunk on the ground (a GroundDrop) draws its good's `landscapeToPickup` log —
    // distinct from the tidy delivered heap. Omitted (no join) → the drop draws the placeholder.
    ...(trunkBinding !== undefined ? { trunk: trunkBinding } : {}),
    // A wild berry bush draws its fruited/bare frame (the `bush with fruits`/`bush naked` records) by
    // `DrawItem.level` (2 = ripe, 1 = bare). Omitted (no join) → the bush draws the placeholder.
    ...(berryBushBinding !== undefined ? { berrybush: berryBushBinding } : {}),
  };
}

// ─── per-job settler characters (the `[jobbasegraphics]` join) ─────────────────────────────────────

/**
 * A good the loaded content set defines — the `(typeId, id-slug)` pair the per-good carry join keys on.
 * Passed by the entry that KNOWS which content the sim runs (the live slice's demo goods, a scene's own
 * goods), since the render binding is per-`goodType` NUMBER and those ids are content-relative.
 */
export interface GoodRef {
  readonly typeId: number;
  readonly id: string;
}

/**
 * Good id-slug → carry-walk sequence SUFFIX, where the slug itself isn't the suffix. The body bob sets
 * name their loaded gaits `<body>_walk_<suffix>` (walk_wood, walk_stone, walk_iron_gold, …); most real
 * IR good slugs match their suffix verbatim (wood/stone/mud/flour/bread/…), and this table maps the
 * rest onto the CLOSEST authored carry look (several goods share one: every potion → `potion`, iron and
 * gold share the `iron_gold` ingot walk). There is NO readable good→carry-animation table in the mod
 * (the base binding is encrypted `.cif`), so this name join is an approximation — source basis
 * "Carry look per good". A slug in neither the sequences nor this table falls back to the character's
 * generic loaded gait (the wood log), then to its plain walk.
 */
const CARRY_SEQ_SUFFIX: Readonly<Record<string, string>> = {
  wheat: 'grain',
  iron: 'iron_gold',
  gold: 'iron_gold',
  coin: 'iron_gold',
  food_simple: 'food',
  food_extra: 'food',
  fruit: 'food',
  sausage: 'meat',
  tool_wooden: 'tools',
  tool_iron: 'tools',
  bow_short: 'shortbow',
  bow_long: 'longbow',
  spear_wooden: 'spear',
  spear_iron: 'spear',
  sword_shord: 'sword', // the real IR's slug (sic) for the short sword
  sword_long: 'broadsword',
  holy_oil: 'incense',
  potion_food_small: 'potion',
  potion_food_big: 'potion',
  potion_stamina_small: 'potion',
  potion_stamina_big: 'potion',
  potion_heal_small: 'potion',
  potion_heal_big: 'potion',
  plank: 'wood', // the demo slice's sawn plank — hauled like the log it came from
};

/**
 * A named ×8 `[bobseq]` row as a {@link DirectionalAnim}, or `undefined` when the row is missing,
 * empty, or not a clean ×8 strip — the one guard every per-character animation slot shares, so a
 * malformed/partial IR can never become a bogus frame range. The null-on-miss twin of
 * {@link directionalAnimFromSeq} (which serves the legacy binding's fallback-required contract). Pure.
 */
function eightDirAnim(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  name: string | undefined,
): DirectionalAnim | undefined {
  if (name === undefined) return undefined;
  const row = seqByName.get(name);
  if (row === undefined || row.length <= 0 || row.length % DIRS !== 0) return undefined;
  return { start: row.start, dirs: DIRS, stride: row.length / DIRS };
}

/**
 * A `[bobseq]` row as a FACING-LOCKED clip (`dirs: 1`, the whole strip played on one facing) — the
 * `clipDirs` reading for a non-×8 strip (a wait/idle, the aggressive ready stance). `undefined` for a
 * missing/empty row so a caller can chain a fallback. The single-direction twin of {@link eightDirAnim};
 * takes the row directly since its callers already hold it. Pure.
 */
function singleDirAnim(row: BobSeqRow | undefined): DirectionalAnim | undefined {
  if (row === undefined || row.length <= 0) return undefined;
  return { start: row.start, dirs: 1, stride: row.length };
}

/**
 * `gfxanimframelistdir <dir>` index → the render FACING (the `CR_Hum_Body` strip-block order
 * `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N` — source basis "Settler facing"). The source's `<dir>`
 * space is the engine's movement-direction ring: the staggered-lattice hex neighbours clockwise from
 * screen-east (`0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE`) plus the two row-crossing verticals (`6 N, 7 S`).
 * DATA-PINNED, not guessed: across every extracted HUMAN character-body `[gfxanimatomic]` record whose
 * strip is a uniform ×8 block layout (`human_*`, the bodies these warrior bindings actually draw), each
 * dir-`d` frame list indexes exclusively into strip block `GFX_DIR_TO_BLOCK[d]` — ZERO dissent among the
 * human bodies. The animal and vehicle libs carry their own block orders (e.g. `animal_bear_fight`,
 * `animal_bull_wait`, `vehicles_bullcart_wait` each differ) — irrelevant here, since the remap is applied
 * only to human warrior bodies. Indexing frame lists by facing WITHOUT this remap draws the NW swing on
 * an east-facing attacker.
 */
const GFX_DIR_TO_BLOCK = [4, 5, 0, 1, 2, 3, 7, 6] as const;

/**
 * Reorder a `[gfxanimatomic]` per-`<dir>` frame-list table into the render's per-FACING order (a
 * {@link FrameListAnim}'s `frameLists` is indexed by facing). A single-list table is facing-locked
 * (a bare `gfxanimframelist`) and plays verbatim on every facing. ANY multi-list table lives in the
 * `<dir>` space and is remapped — including a partial one (dirs authored sparsely): each authored dir
 * lands on its facing, and an unauthored slot stays an empty list (`frameOf` then holds the pool's
 * first frame for that facing rather than borrowing a neighbour's — or worse, an unremapped — swing). Pure.
 */
function frameListsByFacing(dirLists: readonly (readonly number[])[]): readonly (readonly number[])[] {
  if (dirLists.length === 1) return dirLists; // facing-locked single list — no direction table to remap
  const byFacing: (readonly number[])[] = new Array(DIRS).fill([]);
  GFX_DIR_TO_BLOCK.forEach((facing, dir) => {
    byFacing[facing] = dirLists[dir] ?? [];
  });
  return byFacing;
}

/**
 * Build the per-`goodType` loaded-gait table for one body: for each content good, resolve its carry
 * sequence `<prefix><suffix>` (suffix = the slug, via {@link CARRY_SEQ_SUFFIX} when aliased) and bind
 * `moving` to the full ×8 cycle + `idle` to its first-frame hold (the still loaded pose a depositor
 * stands in). A good whose sequence is missing (or not a clean ×8 strip) is simply omitted — the
 * generic carrying slots back it. Pure + exported for unit tests.
 */
export function carryAnimsByGood(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  prefix: string,
  goods: readonly GoodRef[],
): NonNullable<CarryingBinding['byGood']> {
  const out: Record<number, { idle: SpriteFrameRef; moving: SpriteFrameRef }> = {};
  for (const good of goods) {
    const suffix = CARRY_SEQ_SUFFIX[good.id] ?? good.id;
    const moving = eightDirAnim(seqByName, prefix + suffix);
    if (moving === undefined) continue;
    out[good.typeId] = { moving, idle: { ...moving, frames: 1 } };
  }
  return out;
}

/**
 * One in-game settler LOOK to build — which roster body/heads it composes and which of that body's
 * `[bobseq]` names animate each state. Transcribed per body from the decoded sequence lists (the names
 * differ per body: the man walks `human_man_generic_walk`, the unarmed soldier
 * `human_man_warrior_empty_walk`, each armed soldier its weapon's own `..._<Weapon>_walk`). Sequence
 * names are matched VERBATIM (the source casing is mixed — `Warrior_Sword_Walk` vs `warrior_empty_walk`).
 */
export interface CharacterSpec {
  /** Key into {@link import('../catalog/roster.js').VIKING_CHARACTERS} for the body + default head stems. */
  readonly rosterId: string;
  /** Head look stems override (WITHOUT palette); defaults to the roster entry's full head list. The
   *  civilian narrows to the civilist-job heads 00..03 (the roster also carries the scout/druid looks). */
  readonly headBmds?: readonly string[];
  /** The ×8 locomotion cycle; absent (the baby) → the character stands its wait even while moving. */
  readonly walkSeq?: string;
  /**
   * The standing-idle `[bobseq]`, played WHOLE as a single-direction breathing loop — no wait strip is
   * a clean ×8 (the generic waits 57/35/39, the weapon waits 22..29), and the established `clipDirs`
   * rule reads a non-×8 strip as facing-locked, exactly how the original plays them (source basis
   * "Character animation gallery"). So an armed soldier BREATHES holding his weapon, like everyone
   * else. Absent (or missing from the IR), idle falls back to holding the walk's first frame per
   * facing — a directional still, the never-crash floor.
   */
  readonly waitSeq?: string;
  /** Prefix of this body's per-good carry cycles (`<prefix><good>`), when the body has any. */
  readonly carryPrefix?: string;
  /** Atomic id → its action sequence on this body (the `setatomic` join, e.g. the woodcut swing). */
  readonly atomics?: Readonly<Record<number, { readonly seq: string; readonly phaseStart?: number }>>;
  /**
   * Atomic id → the action sequence whose DIRECTIONAL layout comes from the extracted `[gfxanimatomic]`
   * per-`<dir>` frame lists (the farmer's field clips) — for a clip that is neither a clean ×8 strip nor
   * a facing-locked one-off, the frame lists ARE the per-facing cut. {@link characterBinding} builds a
   * render `FrameListAnim` from the per-ATOMIC lists table (`actionFrameLists`), exactly the attack
   * swing's mechanism generalized beyond action 81. A seq that resolves here overrides any plain
   * {@link atomics} fallback entry for the same id; missing data leaves the fallback in place.
   */
  readonly dirListAtomics?: Readonly<Record<number, string>>;
  /**
   * The combat attack swing bobseq NAME (the `[gfxanimatomic]` action-81 `gfxbobseqbody` for this look's
   * viking job), bound to {@link ATTACK_ATOMIC}. Unlike {@link atomics}, its directional layout comes
   * from the per-facing frame lists (a melee swing pool is not a clean ×8 strip), so
   * {@link characterBinding} builds a render `FrameListAnim` from the extracted gfxAtomics table keyed by
   * this name — the name must be BOTH a `[bobseq]` on this body AND a viking gfxAtomics record.
   */
  readonly attack?: string;
  /**
   * The combat-engaged gait bobseq names (`..._walk_agressive` / `..._wait_agressive`) — the readied
   * walk/stand a soldier plays while advancing on or squaring up to an enemy. Bound to
   * {@link import('@vinland/render').SettlerStateBinding.engaged}; absent for looks with no aggressive
   * variant (the unarmed body, civilians). The walk is a clean ×8 cycle, the wait a facing-locked strip
   * (like the relaxed wait).
   */
  readonly engaged?: { readonly moving?: string; readonly idle?: string };
}

/** Specs for every in-game look, keyed by the id the job tables below reference. Declared with
 *  `satisfies` (not a widened `Record<string, …>`) so the keys stay literal and a typo'd spec id in a
 *  job table is a COMPILE error, not a silent fall-to-default. */
export const CHARACTER_SPECS = {
  civilian: {
    rosterId: 'civilian',
    headBmds: CIVILIST_JOB_HEADS,
    walkSeq: 'human_man_generic_walk',
    waitSeq: 'human_man_generic_wait',
    carryPrefix: 'human_man_generic_walk_',
    // The civilist brawls with fists when it fights (job 6 — the viking action-81 join); the same
    // generic man body every civilian trade shares, so any civilian that runs an attack atomic punches.
    attack: 'human_man_Civilian_Fight_punch',
    // Every atomic the sim issues that this body authors a sequence for. The pick-up bend serves both
    // pickup AND deposit (the body authors no separate put-down; the same stoop reads as either — and
    // a bound atomic wins over the carry override, so the depositor stoops as its load leaves).
    atomics: {
      // Each raw-good harvest plays that good's OWN authored work clip — the collector's per-good motion.
      [HARVEST_ATOMIC]: { seq: CHOP_SEQ, phaseStart: CHOP_PHASE_START }, // wood — the woodcut axe swing
      [STONE_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ }, // stone — the shared mining strike
      [CLAY_HARVEST_ATOMIC]: { seq: SHOVEL_SEQ }, // clay/mud — the clayworker's shovel dig (soft ground)
      [IRON_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ }, // iron — the shared mining strike (faithful job→clip map)
      [GOLD_HARVEST_ATOMIC]: { seq: STONECRUSH_SEQ }, // gold — the shared mining strike (faithful job→clip map)
      [MUSHROOM_HARVEST_ATOMIC]: { seq: PICKUP_SEQ }, // mushroom — a bend-and-pluck (observed)
      [BUILD_HOUSE_ATOMIC]: { seq: HAMMER_SEQ }, // builder — the construction hammer swing
      [EAT_ATOMIC]: { seq: 'human_man_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_man_generic_pray' },
      [STORE_PICKUP_ATOMIC]: { seq: PICKUP_SEQ },
      [STORE_PILEUP_ATOMIC]: { seq: PICKUP_SEQ },
    },
    // The COLLECTOR's harvest clips + the farmer's field clips draw through the extracted
    // `[gfxanimatomic]` per-direction frame lists (job 8 / job 18), overriding the plain `atomics`
    // fallbacks above whenever the IR carries them. The lists ARE the original's authored work cycle —
    // one swing per atomic with the impact hold and trailing idle pad baked into the repeated entries
    // (woodcutting 30/dir, stonecrushing 29/dir, shovel 23/dir; the pluck is a single facing-locked
    // 19-frame list) — so a chop reads as ONE strike with its pauses, not the raw strip looped, and the
    // swing faces the way the gatherer stands (source basis "Gathering work animations").
    dirListAtomics: {
      [HARVEST_ATOMIC]: CHOP_SEQ,
      [STONE_HARVEST_ATOMIC]: STONECRUSH_SEQ,
      [CLAY_HARVEST_ATOMIC]: SHOVEL_SEQ,
      [IRON_HARVEST_ATOMIC]: STONECRUSH_SEQ,
      [GOLD_HARVEST_ATOMIC]: STONECRUSH_SEQ,
      [MUSHROOM_HARVEST_ATOMIC]: PICKUP_SEQ,
      [WHEAT_HARVEST_ATOMIC]: REAP_SEQ,
      [PLANT_ATOMIC]: SOW_SEQ,
      [CULTIVATE_ATOMIC]: WATER_SEQ,
    },
  },
  woman: {
    rosterId: 'woman',
    walkSeq: 'human_woman_generic_walk',
    waitSeq: 'human_woman_generic_wait',
    carryPrefix: 'human_woman_generic_walk_',
    // The woman's fist brawl (job 5 viking action-81) on her own body (cr_hum_body_10).
    attack: 'human_woman_Civilian_Fight_woman_punch',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_woman_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_woman_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_woman_generic_pray' },
      [STORE_PICKUP_ATOMIC]: { seq: 'human_woman_generic_pick_up' },
      [STORE_PILEUP_ATOMIC]: { seq: 'human_woman_generic_pick_up' },
    },
  },
  boy: {
    rosterId: 'boy',
    walkSeq: 'human_child_boy_generic_walk',
    waitSeq: 'human_child_boy_generic_wait',
  },
  girl: {
    rosterId: 'girl',
    walkSeq: 'human_child_girl_generic_walk',
    waitSeq: 'human_child_girl_generic_wait_1',
  },
  baby: {
    rosterId: 'baby',
    waitSeq: 'human_child_baby_generic_wait',
  },
  // Attack + aggressive-gait bindings are the VIKING (`logicdefines.inc` TRIBE_TYPE_HUMAN_VIKING = 1)
  // `[gfxanimatomic]` action-81 joins — transcribed, NOT guessed: short sword swings Sword_Attack_2,
  // long sword the Broadsword swing, the longbow the Longbow swing (the per-direction frame counts match
  // the viking atomicanimation lengths: spear 27, sword_long 29, bows 12/28). The unarmed body authors
  // no `_agressive` gait, so 'warrior' omits `engaged` (it uses its relaxed walk/wait when engaged).
  warrior: {
    rosterId: 'warrior',
    walkSeq: 'human_man_warrior_empty_walk',
    waitSeq: 'human_man_warrior_empty_wait',
    attack: 'human_man_warrior_empty_punch',
  },
  'warrior-spear': {
    rosterId: 'warrior',
    walkSeq: 'human_man_Warrior_spear_walk',
    waitSeq: 'human_man_Warrior_spear_wait',
    attack: 'human_man_Warrior_spear_attack',
    engaged: {
      moving: 'human_man_Warrior_spear_walk_agressive',
      idle: 'human_man_Warrior_spear_wait_agressive',
    },
  },
  'warrior-sword': {
    rosterId: 'warrior',
    walkSeq: 'human_man_Warrior_Sword_Walk',
    waitSeq: 'human_man_Warrior_Sword_Wait',
    attack: 'human_man_Warrior_Sword_Attack_2',
    engaged: {
      moving: 'human_man_Warrior_Sword_Walk_agressive',
      idle: 'human_man_Warrior_Sword_Wait_agressive',
    },
  },
  'warrior-broadsword': {
    rosterId: 'warrior',
    walkSeq: 'human_man_Warrior_Broadsword_walk',
    waitSeq: 'human_man_Warrior_Broadsword_wait',
    attack: 'human_man_Warrior_Broadsword_attack',
    engaged: {
      moving: 'human_man_Warrior_Broadsword_walk_agressive',
      idle: 'human_man_Warrior_Broadsword_wait_agressive',
    },
  },
  'warrior-shortbow': {
    rosterId: 'warrior',
    walkSeq: 'human_man_Warrior_Shortbow_walk',
    waitSeq: 'human_man_Warrior_Shortbow_wait',
    attack: 'human_man_Warrior_Shortbow_attack',
    engaged: {
      moving: 'human_man_Warrior_Shortbow_walk_agressive',
      idle: 'human_man_Warrior_Shortbow_wait_agressive',
    },
  },
  'warrior-longbow': {
    rosterId: 'warrior',
    walkSeq: 'human_man_Warrior_Longbow_walk',
    waitSeq: 'human_man_Warrior_Longbow_wait',
    attack: 'human_man_Warrior_Longbow_attack',
    engaged: {
      moving: 'human_man_Warrior_Longbow_walk_agressive',
      idle: 'human_man_Warrior_Longbow_wait_agressive',
    },
  },
} satisfies Readonly<Record<string, CharacterSpec>>;

/** A key of {@link CHARACTER_SPECS} — the literal spec-id union the job tables are typed by. */
export type CharacterSpecId = keyof typeof CHARACTER_SPECS;

/** The specs as `[id, spec]` pairs, WIDENED to the {@link CharacterSpec} interface — the literal value
 *  types differ per entry (that's what makes the ids literal), so iteration goes through this view. */
export const CHARACTER_SPEC_ENTRIES = Object.entries(CHARACTER_SPECS) as readonly (readonly [
  CharacterSpecId,
  CharacterSpec,
])[];

/**
 * Adult `jobType` → character spec id — the viking `[jobbasegraphics]` job → body join, transcribed
 * from the mod's `types/humanstype/jobgraphics.ini` (`logictribe 1`) + the real `jobtypes` soldier
 * family: woman 5 → the woman body; the soldier jobs 31..41 → the armoured `cr_hum_body_05`, each
 * weapon class animating ITS weapon's walk (the axe jobs 38/39 borrow the closest two-hander, the
 * broadsword — the body authors no axe set; the sabers 36/37 borrow the sword/broadsword one-handers).
 * Every unmapped job (all civilian trades — they share the generic man body in the original) falls to
 * the `civilian` default.
 */
export const ADULT_CHARACTER_BY_JOB: Readonly<Record<number, CharacterSpecId>> = {
  5: 'woman', // woman
  31: 'warrior', // soldier_unarmed
  32: 'warrior-spear', // soldier_spear_wooden
  33: 'warrior-spear', // soldier_spear_iron
  34: 'warrior-sword', // soldier_sword_short
  35: 'warrior-broadsword', // soldier_sword_long
  36: 'warrior-sword', // soldier_saber_short
  37: 'warrior-broadsword', // soldier_saber_long
  38: 'warrior-broadsword', // soldier_axe_small (no authored axe set — closest two-hander)
  39: 'warrior-broadsword', // soldier_axe_big
  40: 'warrior-shortbow', // soldier_bow_short
  41: 'warrior-longbow', // soldier_bow_long
};

/**
 * EQUIPPED weapon good → warrior character spec — the "a warrior is one profession; the weapon in hand
 * decides the look" join. A settler carrying one of these in its `Equipment.weapon` slot draws that
 * weapon's warrior body regardless of its jobType; a bare warrior (no weapon good) falls through to
 * {@link ADULT_CHARACTER_BY_JOB} (the unarmed body for `soldier_unarmed`). Each weapon class maps to the
 * same body variant its soldier job does (bows → the bow bodies, the two spears → the spear body, the long
 * sword → the two-handed broadsword body). Keys are the SANDBOX-SCOPED good ids (`goodtypes.ini` weapon
 * ids 37–42, carried by the global catalog at +100 → 137–142) so they match the `Equipment.weapon.goodType`.
 */
export const WARRIOR_SPEC_BY_WEAPON_GOOD: Readonly<Record<number, CharacterSpecId>> = {
  137: 'warrior-shortbow', // short bow
  138: 'warrior-longbow', // long bow
  139: 'warrior-spear', // wooden spear
  140: 'warrior-spear', // iron spear
  141: 'warrior-sword', // short sword
  142: 'warrior-broadsword', // long sword (the two-hander)
};

/**
 * Age-class `jobType` (1..4, a settler that CARRIES `Age`) → character spec id — the baby/child bodies
 * from the same `[jobbasegraphics]` table. Keyed only for young settlers so a synthetic fixture's adult
 * job id 1/2 can never draw a baby (the [dc3ef54] collision, disambiguated by the `Age` component).
 */
export const YOUNG_CHARACTER_BY_JOB: Readonly<Record<number, CharacterSpecId>> = {
  1: 'baby', // baby_female
  2: 'baby', // baby_male
  3: 'girl', // child_female
  4: 'boy', // child_male
};

/**
 * Build one character's {@link SettlerStateBinding} from its spec + its body's decoded `[bobseq]` rows:
 * walk → `moving`, the wait (loop or walk-hold) → `idle`, the spec's atomics → `byAtomic`, and the
 * per-good carry table (+ the wood-log generic fallback) → `carrying`. Returns `null` when neither the
 * walk nor a loop wait resolves (an IR predating this body's sequences) — the character is then dropped
 * and its jobs fall back to the default look, never a bogus frame range. Pure + exported for unit tests.
 */
export function characterBinding(
  spec: CharacterSpec,
  seqByName: ReadonlyMap<string, BobSeqRow>,
  goods: readonly GoodRef[],
  attackFrameLists?: ReadonlyMap<string, readonly (readonly number[])[]>,
  /** Per-ATOMIC `[gfxanimatomic]` frame-list tables (atomic id → seq name → per-`<dir>` lists) for the
   *  spec's {@link CharacterSpec.dirListAtomics} — the attack mechanism generalized (farmer clips). */
  actionFrameLists?: ReadonlyMap<number, ReadonlyMap<string, readonly (readonly number[])[]>>,
): SettlerStateBinding | null {
  const walk = eightDirAnim(seqByName, spec.walkSeq);
  // A loop wait plays its whole strip facing-locked (the strips aren't ×8); a walk-hold stands the
  // walk's first frame per facing. Whichever resolves becomes idle; neither → the character is unusable.
  const idle: SpriteFrameRef | null =
    singleDirAnim(spec.waitSeq !== undefined ? seqByName.get(spec.waitSeq) : undefined) ??
    (walk !== undefined ? { ...walk, frames: 1 } : null);
  if (idle === null) return null;

  const byAtomic: Record<number, SpriteFrameRef> = {};
  for (const [atomicId, action] of Object.entries(spec.atomics ?? {})) {
    const row = seqByName.get(action.seq);
    if (row === undefined || row.length <= 0) continue;
    // A clean ×8 action (the chop 120, the pray 120) is directional; a non-×8 one (eat 17, sleep 20,
    // pick_up 19) plays its WHOLE strip facing-locked — the same `clipDirs` reading the waits use.
    const anim: DirectionalAnim =
      row.length % DIRS === 0
        ? { start: row.start, dirs: DIRS, stride: row.length / DIRS }
        : { start: row.start, dirs: 1, stride: row.length };
    byAtomic[Number(atomicId)] = {
      ...anim,
      ...(action.phaseStart !== undefined ? { phaseStart: action.phaseStart } : {}),
    };
  }

  // The combat attack swing → a FrameListAnim on {@link ATTACK_ATOMIC}: the swing pool's `start` from the
  // `[bobseq]` row, its per-direction layout from the extracted viking `[gfxanimatomic]` frame lists
  // (keyed by the same seq name), REORDERED from the source's <dir> space into the render's facing order
  // ({@link frameListsByFacing}). Bound only when BOTH resolve — a body/IR missing either just has no
  // attack animation (the unit stands its ready pose mid-swing), never a bogus uniform slice.
  if (spec.attack !== undefined) {
    const row = seqByName.get(spec.attack);
    const dirLists = attackFrameLists?.get(spec.attack);
    if (row !== undefined && row.length > 0 && dirLists !== undefined && dirLists.length > 0) {
      const swing: FrameListAnim = { start: row.start, frameLists: frameListsByFacing(dirLists) };
      byAtomic[ATTACK_ATOMIC] = swing;
    }
  }

  // The frame-list actions beyond the attack (the farmer's field clips): each binds only when BOTH its
  // `[bobseq]` row and its per-atomic `[gfxanimatomic]` lists resolve, overriding any plain `atomics`
  // fallback for the same id — missing data leaves that fallback (or nothing) in place, never a bogus
  // uniform slice. Same reorder into facing space as the attack swing.
  for (const [atomicId, seqName] of Object.entries(spec.dirListAtomics ?? {})) {
    const row = seqByName.get(seqName);
    const dirLists = actionFrameLists?.get(Number(atomicId))?.get(seqName);
    if (row !== undefined && row.length > 0 && dirLists !== undefined && dirLists.length > 0) {
      byAtomic[Number(atomicId)] = { start: row.start, frameLists: frameListsByFacing(dirLists) };
    }
  }

  // The combat-engaged gait: the aggressive walk (a clean ×8 cycle) + the aggressive wait (a facing-locked
  // strip, like the relaxed wait). Each slot is bound only when its seq resolves; a look with no
  // aggressive variant (the unarmed body, civilians) yields no `engaged` and falls back to its relaxed
  // gait while engaged.
  const engagedMoving = eightDirAnim(seqByName, spec.engaged?.moving);
  const engagedIdle = singleDirAnim(
    spec.engaged?.idle !== undefined ? seqByName.get(spec.engaged.idle) : undefined,
  );
  const engaged =
    engagedMoving !== undefined || engagedIdle !== undefined
      ? {
          ...(engagedMoving !== undefined ? { moving: engagedMoving } : {}),
          ...(engagedIdle !== undefined ? { idle: engagedIdle } : {}),
        }
      : undefined;

  // The generic loaded gait: the body's wood-log walk (the one carry look every body that hauls at all
  // authors), backing any good without its own cycle. A body with no carry sequences (children, the
  // soldiers) hauls invisibly on its plain walk — faithful enough: those never carry in the original.
  const carryByGood =
    spec.carryPrefix !== undefined ? carryAnimsByGood(seqByName, spec.carryPrefix, goods) : {};
  const genericCarry =
    spec.carryPrefix !== undefined ? eightDirAnim(seqByName, `${spec.carryPrefix}wood`) : undefined;
  const carrying =
    genericCarry !== undefined || Object.keys(carryByGood).length > 0
      ? {
          ...(genericCarry !== undefined
            ? { moving: genericCarry, idle: { ...genericCarry, frames: 1 } }
            : {}),
          ...(Object.keys(carryByGood).length > 0 ? { byGood: carryByGood } : {}),
        }
      : undefined;

  return {
    idle,
    ...(walk !== undefined ? { moving: walk } : {}),
    ...(Object.keys(byAtomic).length > 0 ? { byAtomic } : {}),
    ...(carrying !== undefined ? { carrying } : {}),
    ...(engaged !== undefined ? { engaged } : {}),
  };
}

/**
 * The HEAD-side twin of a per-good carry table: which anim the head overlay resolves through per good.
 * Most of the man's carry-walk variants ship **empty head bobs** (19 of 27 in the real decode — the
 * head is authored once, on the base walk), so a head drawn at the carry range's own ids would vanish:
 * a stone-hauler would walk HEADLESS. For each good this checks the head atlas at the carry cycle's
 * first frame — authored → the good keeps its own range; empty → the head **borrows the base walk** at
 * the same (facing, frame) offset, exactly the gallery's proven head-reuse rule (source basis
 * "Character animation gallery"). Returns the INPUT table by identity when nothing borrows (no walk to
 * borrow, or every head is authored), so the caller can skip building a head binding at all. Pure +
 * exported for unit tests.
 */
export function carryHeadAnims(
  byGood: NonNullable<CarryingBinding['byGood']>,
  walk: DirectionalAnim | undefined,
  headAtlas: SpriteAtlas,
): NonNullable<CarryingBinding['byGood']> {
  if (walk === undefined) return byGood;
  const out: Record<number, { readonly idle?: SpriteFrameRef; readonly moving?: SpriteFrameRef }> = {};
  let borrowed = false;
  for (const [goodType, slot] of Object.entries(byGood)) {
    const moving = slot.moving;
    let headAuthored = true;
    if (typeof moving === 'object') {
      const frame = headAtlas.frames.get(moving.start);
      headAuthored = frame !== undefined && frame.width > 0 && frame.height > 0;
    }
    if (headAuthored) {
      out[Number(goodType)] = slot;
    } else {
      out[Number(goodType)] = { moving: walk, idle: { ...walk, frames: 1 } };
      borrowed = true;
    }
  }
  return borrowed ? out : byGood;
}
