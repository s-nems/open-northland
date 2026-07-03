import type {
  BuildingBobRef,
  CarryingBinding,
  ConstructionLayerRef,
  DirectionalAnim,
  ResourceTypeBinding,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteBindings,
  SpriteFrameRef,
  StockpileBinding,
} from '@vinland/render';
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
// The LOADED gait — the settler walking while hauling a log. Same directional layout as the empty walk;
// the frames simply carry the wood. Bound to the settler's `carrying` override so a woodcutter walking
// its harvest back to the store plays this instead of the empty walk; its first frame holds a still
// loaded pose while it deposits.
const WALK_WOOD_SEQ = 'human_man_generic_walk_wood';

// The known-good ranges (verified against an owned copy: walk 1988/96, chop 5106/120, walk_wood 4580/96)
// kept as the FALLBACK when the manifest is absent (a checkout without content/, or an IR predating
// bobSequences) so the real-graphics path still degrades to the right cycles instead of drawing a wrong range.
const FALLBACK_WALK: DirectionalAnim = { start: 1988, dirs: DIRS, stride: 12 };
// The 15-frame woodcut bobseq is a continuous loop. Verified by rendering every frame to a filmstrip:
// frames 0..8 are the axe coming DOWN to the tree (the strike, impact ~frame 8) and 9..14 are the axe
// RISING (the windup). So we play the FULL cycle but START at the windup (CHOP_PHASE_START): it plays
// 9..14 (raise the axe) then 0..8 (swing down, impact) — a complete chop that *begins* with the windup
// and *ends* on the strike landing in the tree. Tick-locked cadence (one frame/tick) on the atomic's
// `elapsed`, same speed as every other animation.
const CHOP_PHASE_START = 9;
/** Frames per facing in the woodcut swing (verified 5106/120 = 15 across the 8 dirs). The ONE source of
 *  truth for the swing length — both the render cycle below and the sim-side {@link HARVEST_SWING_LENGTH}
 *  derive from it, so a scene can't pick a chop duration that mismatches the animation the render plays. */
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
// way the gallery's `clipDirs` classifies a non-×8 length (see docs/FIDELITY.md). Playing the full loop
// (not a facing-sliced 1/8 excerpt) is what makes a standing settler breathe rather than freeze.
const FALLBACK_WAIT: DirectionalAnim = { start: 1931, dirs: 1, stride: 57 };

/** The chop atomic id (the original's `harvest`), mapped to the woodcutting swing. Exported as the
 *  ONE app-side declaration of this semantic id (the slice + scenes reuse it). */
export const HARVEST_ATOMIC = 24;

/**
 * The sim-side DURATION (in ticks) a harvest/chop atomic must run so the render plays exactly ONE full
 * woodcut swing — windup→impact — without cutting off and restarting. Every scene/slice that binds a
 * harvest swing (all of them replay the one {@link CHOP_SEQ} motion) MUST use this as its
 * `atomicAnimations` length; the ONE source of truth so a chop can't be mistuned per scene.
 *
 * It is {@link CHOP_STRIDE} + 1: the swing is `CHOP_STRIDE` frames at one frame/tick, but the render
 * clock is `elapsed - 1` and the *completion* tick removes the atomic before that frame is drawn — so a
 * full swing (last drawn frame = the impact at tick `CHOP_STRIDE`) needs `CHOP_STRIDE + 1` sim ticks.
 * A shorter value (e.g. 6) replays only the windup frames and restarts every atomic — the visible glitch.
 */
export const HARVEST_SWING_LENGTH = CHOP_STRIDE + 1;
/**
 * The harvest atomics for the OTHER raw goods (stone 25, clay 26, iron 27 — the original's per-good
 * `atomicForHarvesting` ids for ore/rock/mud). They all replay the one authored harvest swing on the
 * generic man ({@link CHOP_SEQ}): the mod ships a single generic harvest motion for the man body, so a
 * miner/stonemason/clay-digger swings the same as the woodcutter until per-resource swings are decoded
 * (docs/FIDELITY.md). Without this a settler running one of these atomics would STAND (no `byAtomic`
 * match) instead of visibly digging — the craft-chain scene's stonemason/miner/clay-digger.
 */
const HARVEST_ATOMICS_OTHER = [25, 26, 27] as const;
/**
 * The other atomic ids the SIM issues today, transcribed from the sim's planners (`ai.ts` eat 10 /
 * sleep 8 / pray 12, `atomic.ts` pickup 22 / deposit 23 — themselves pinned to the original's
 * `setatomic` table): the `byAtomic` join keys the character specs bind body animations to. Kept here
 * (not imported from sim) because they are the ANIMATION table's keys — the same numeric contract the
 * original's `tribetypes` uses, stable across both packages.
 */
const EAT_ATOMIC = 10;
const SLEEP_ATOMIC = 8;
const PRAY_ATOMIC = 12;
const PICKUP_ATOMIC = 22;
const DEPOSIT_ATOMIC = 23;

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
 * The demo binding into the human atlases — the render twin of `slice/vertical-slice.ts`'s `demoContent`.
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
): SpriteBindings {
  const walk = directionalAnimFromSeq(seqByName, WALK_SEQ, {}, FALLBACK_WALK);
  // Idle is the WAIT animation played as ONE direction (its length isn't a clean ×8, so it isn't a
  // directional cycle — the original plays it locked to a facing; docs/FIDELITY.md). The FULL loop, so a
  // standing settler breathes — not a frozen frame, and not a truncated facing-sliced 1/8 excerpt.
  const waitRow = seqByName.get(WAIT_SEQ);
  const wait: DirectionalAnim =
    waitRow !== undefined && waitRow.length > 0
      ? { start: waitRow.start, dirs: 1, stride: waitRow.length }
      : FALLBACK_WAIT;
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
 * (the base binding is encrypted `.cif`), so this name join is an approximation — docs/FIDELITY.md
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
   * rule reads a non-×8 strip as facing-locked, exactly how the original plays them (docs/FIDELITY.md
   * "Character animation gallery"). So an armed soldier BREATHES holding his weapon, like everyone
   * else. Absent (or missing from the IR), idle falls back to holding the walk's first frame per
   * facing — a directional still, the never-crash floor.
   */
  readonly waitSeq?: string;
  /** Prefix of this body's per-good carry cycles (`<prefix><good>`), when the body has any. */
  readonly carryPrefix?: string;
  /** Atomic id → its action sequence on this body (the `setatomic` join, e.g. the woodcut swing). */
  readonly atomics?: Readonly<Record<number, { readonly seq: string; readonly phaseStart?: number }>>;
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
    // Every atomic the sim issues that this body authors a sequence for. The pick-up bend serves both
    // pickup AND deposit (the body authors no separate put-down; the same stoop reads as either — and
    // a bound atomic wins over the carry override, so the depositor stoops as its load leaves).
    atomics: {
      [HARVEST_ATOMIC]: { seq: CHOP_SEQ, phaseStart: CHOP_PHASE_START },
      // The other raw-good harvests (stone/clay/iron) share the one authored harvest swing.
      ...Object.fromEntries(
        HARVEST_ATOMICS_OTHER.map((id) => [id, { seq: CHOP_SEQ, phaseStart: CHOP_PHASE_START }]),
      ),
      [EAT_ATOMIC]: { seq: 'human_man_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_man_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_man_generic_pray' },
      [PICKUP_ATOMIC]: { seq: 'human_man_generic_pick_up' },
      [DEPOSIT_ATOMIC]: { seq: 'human_man_generic_pick_up' },
    },
  },
  woman: {
    rosterId: 'woman',
    walkSeq: 'human_woman_generic_walk',
    waitSeq: 'human_woman_generic_wait',
    carryPrefix: 'human_woman_generic_walk_',
    atomics: {
      [EAT_ATOMIC]: { seq: 'human_woman_generic_eat' },
      [SLEEP_ATOMIC]: { seq: 'human_woman_generic_sleep' },
      [PRAY_ATOMIC]: { seq: 'human_woman_generic_pray' },
      [PICKUP_ATOMIC]: { seq: 'human_woman_generic_pick_up' },
      [DEPOSIT_ATOMIC]: { seq: 'human_woman_generic_pick_up' },
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
  warrior: {
    rosterId: 'warrior',
    walkSeq: 'human_man_warrior_empty_walk',
    waitSeq: 'human_man_warrior_empty_wait',
  },
  'warrior-spear': {
    rosterId: 'warrior',
    walkSeq: 'human_man_Warrior_spear_walk',
    waitSeq: 'human_man_Warrior_spear_wait',
  },
  'warrior-sword': {
    rosterId: 'warrior',
    walkSeq: 'human_man_Warrior_Sword_Walk',
    waitSeq: 'human_man_Warrior_Sword_Wait',
  },
  'warrior-broadsword': {
    rosterId: 'warrior',
    walkSeq: 'human_man_Warrior_Broadsword_walk',
    waitSeq: 'human_man_Warrior_Broadsword_wait',
  },
  'warrior-shortbow': {
    rosterId: 'warrior',
    walkSeq: 'human_man_Warrior_Shortbow_walk',
    waitSeq: 'human_man_Warrior_Shortbow_wait',
  },
  'warrior-longbow': {
    rosterId: 'warrior',
    walkSeq: 'human_man_Warrior_Longbow_walk',
    waitSeq: 'human_man_Warrior_Longbow_wait',
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
): SettlerStateBinding | null {
  const walk = eightDirAnim(seqByName, spec.walkSeq);
  const waitRow = spec.waitSeq !== undefined ? seqByName.get(spec.waitSeq) : undefined;
  // A loop wait plays its whole strip facing-locked (the strips aren't ×8); a walk-hold stands the
  // walk's first frame per facing. Whichever resolves becomes idle; neither → the character is unusable.
  const idle: SpriteFrameRef | null =
    waitRow !== undefined && waitRow.length > 0
      ? { start: waitRow.start, dirs: 1, stride: waitRow.length }
      : walk !== undefined
        ? { ...walk, frames: 1 }
        : null;
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
  };
}

/**
 * The HEAD-side twin of a per-good carry table: which anim the head overlay resolves through per good.
 * Most of the man's carry-walk variants ship **empty head bobs** (19 of 27 in the real decode — the
 * head is authored once, on the base walk), so a head drawn at the carry range's own ids would vanish:
 * a stone-hauler would walk HEADLESS. For each good this checks the head atlas at the carry cycle's
 * first frame — authored → the good keeps its own range; empty → the head **borrows the base walk** at
 * the same (facing, frame) offset, exactly the gallery's proven head-reuse rule (docs/FIDELITY.md
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
