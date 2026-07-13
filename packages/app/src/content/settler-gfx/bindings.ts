import type {
  BuildingBobRef,
  BuildingOverlayRef,
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
import { ATTACK_ATOMIC, HARVEST_ATOMIC } from '../../catalog/atomics.js';
import { HOUSE_BOB, TREE_BOB, VIKING_HOUSE01_BOBS } from '../building-gfx/index.js';
import type { BobSeqRow } from '../ir.js';
import type { CharacterSpec } from './character-specs.js';
import {
  CHOP_PHASE_START,
  CHOP_SEQ,
  DIRS,
  FALLBACK_CHOP,
  FALLBACK_WAIT,
  FALLBACK_WALK,
  FALLBACK_WALK_WOOD,
  WAIT_SEQ,
  WALK_SEQ,
  WALK_WOOD_SEQ,
} from './sequences.js';

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
 * `houseBobsByType` (the `buildingBobs` join, see {@link import('../building-gfx/index.js').buildingBobRefsByType})
 * onto the transcribed {@link VIKING_HOUSE01_BOBS} **per type**: real data wins where present, the constant
 * covers any of its five known types the data is missing (so a partial/absent IR degrades gracefully
 * type-by-type instead of dropping a whole family to the generic box). A `houseBobsByType` value may be
 * layer-qualified (a `{ layer, bob }` {@link BuildingBobRef} into a named
 * {@link import('@vinland/render').SpriteSheet.families} atlas — the HQ's viking4 family); the constant's
 * values are bare ids drawn from the default `building` layer. `building`/`resource` resolve in their own
 * per-kind layers (see {@link import('../sprite-sheet.js').loadHumanSpriteSheet}'s `kindLayers`), so their
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
  overlayByType?: Readonly<Record<number, BuildingOverlayRef>>,
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
      // Animated state overlays per type (the type-4 `GfxOverlay` join) — the mill's rotor drawn on
      // top of its bladeless body: still while idle, spinning while the mill produces. Absent/empty
      // when the IR predates the `buildingOverlays` lane (no overlay — the body draws as before).
      ...(overlayByType !== undefined && Object.keys(overlayByType).length > 0 ? { overlayByType } : {}),
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
