import type { LayeredBobRef, ResourceTypeBinding, StockpileBinding } from '@vinland/render';
import { TREE_ATLAS, TREE_BOB } from './building-gfx.js';
import { GENERIC_GOOD_ICON, type GoodIconMap } from './goods-gfx.js';
import type { ContentIr, GatheringPipelineRow, GatheringStageRow, LandscapeGfxRow } from './ir.js';
import { BUSH_WITH_FRUITS_LOGIC_TYPE } from './map-resources.js';
import type { GoodRef } from './settler-gfx.js';

/** The `ls_goods.bmd` served-atlas stem prefix — a good's recoloured pile atlas is `ls_goods.<palette>`
 *  (the pipeline's per-palette variant), so the goods-manifest `{frame, palette}` maps straight to a
 *  {@link GatheringPileRef} whose stem is `${GOODS_PILE_BMD_STEM}.${palette}`. */
const GOODS_PILE_BMD_STEM = 'ls_goods';

/**
 * The gathering-economy render binding: reduce the Step-1 `gatheringPipeline` join (good → its
 * `landscapeTo{Harvest,Store}` stage → the `[GfxLandscape]` records that place it) to the renderer's
 * per-good {@link ResourceTypeBinding} (standing resource nodes) + {@link StockpileBinding} (dropped
 * ground piles + a delivery flag). Each good's node draws ITS own decoded object — a tree for wood, a
 * rock for stone, a mine decal for iron/gold/clay, a mushroom — and each pile draws that good's own
 * `ls_goods` heap growing with its contents, replacing the one hardcoded yew bob every resource used to
 * draw (docs/plans/rung-2 "Resource nodes by goodType" + "Loose ground piles + flags rendering").
 *
 * The join is keyed by the good's id-SLUG, not its typeId: the render binds against the REAL decoded
 * `content/ir.json` (the tree/mine/pile atlases), while the sim runs a scene/slice's OWN content whose
 * goodType NUMBERS differ — so, like the per-good carry looks ({@link import('./settler-gfx.js').carryAnimsByGood}),
 * each scene good is matched to its real pipeline record by `goodId === good.id` and bound under the
 * scene's typeId. The pure reducers here are unit-tested without a browser; the atlas byte loading +
 * family registration live in {@link import('./sprite-sheet.js')}.
 */

/**
 * The default resource atlas family — the shared `ls_trees.tree_yew01` layer drawn as the renderer's
 * {@link import('@vinland/render').SpriteSheet.kindLayers}'s `resource` (already loaded for the legacy
 * single-tree path). A good whose node record lives in THIS family binds a bare bob id (drawn from that
 * layer, no `families` entry — the way the yew tree drew before); every other good binds a
 * layer-qualified ref into its own loaded `families` atlas. {@link TREE_BOB} backs a good with no node.
 */
export const DEFAULT_RESOURCE_STEM = TREE_ATLAS;

/**
 * The delivery-flag `[GfxLandscape]` record's `EditName` — the plain player-coloured **"work extern"**
 * flag in `ls_temp.bmd` (`"player01 work extern 01"`, bob 76): the simple flag-on-a-pole the original
 * plants on the ground to mark an external work / collection point, which is exactly what a gatherer's
 * loose ground pile IS. Deliberately NOT the `"… sign"` record (a building-occupancy emblem that marks a
 * STAFFED building, not a ground collection point) nor the `residence`/`construction`/`soldier` markers.
 * A bare (empty) stockpile draws this as its flag. v1 is the player-01 colour; a per-PLAYER palette swap
 * (players 02–16 have their own `human_playerNN` records) is a deferred follow-up — see source basis
 * "Gathering-economy graphics".
 */
export const FLAG_EDIT_NAME = 'player01 work extern 01';

/**
 * A bare fallback bob for a stockpile slot with no real frame (the flag atlas failed to load, or a held
 * pile's good has no bound heap). A stockpile has no `kindLayers` layer of its own, so a bare ref draws
 * the placeholder heap rather than a wrong atlas frame — the value is irrelevant, only its bare-ness is.
 */
const STOCKPILE_PLACEHOLDER_BOB = 0;

/** A resolved standing-node draw: which served atlas stem + bob id (before the loaded/default decision). */
export interface GatheringNodeRef {
  readonly stem: string;
  readonly bob: number;
}

/** A resolved standing-node draw with its per-LEVEL bobs (a mined deposit's empty→full fill states; a
 *  non-mined node has one). The renderer indexes them by the node's shrink-by-level fill. */
export interface GatheringNodeLevelsRef {
  readonly stem: string;
  readonly bobs: readonly number[];
}

/** A resolved ground-pile draw: its served atlas stem + the per-fill bob ids, ordered fewest→most units. */
export interface GatheringPileRef {
  readonly stem: string;
  readonly fillBobs: readonly number[];
}

/** The per-good gathering draws resolved from the pipeline join (independent of which atlases loaded). */
export interface GatheringRefs {
  /** Standing-node ref per scene `goodType` (its `landscapeToHarvest` record's per-level fill frames,
   *  empty→full — a mined deposit shrinks through them, a non-mined node has just its full state). */
  readonly nodesByGood: Readonly<Record<number, GatheringNodeLevelsRef>>;
  /**
   * Standing-node ref per harvest-stage `[GfxLandscape]` record INDEX — one entry per species variant
   * ("yew 01" … "cedar 02", every stone/mine decal) across every resolved good, same per-level frame
   * shape as {@link nodesByGood}. A decoded-map node carries its own variant index
   * (`Resource.gfxIndex` → `DrawItem.gfxIndex`), and this table is what lets it draw the
   * exact original object instead of collapsing every node of a good to one representative species.
   */
  readonly nodesByGfxIndex: Readonly<Record<number, GatheringNodeLevelsRef>>;
  /**
   * Freshly-dropped, NOT-yet-collected pile ref per scene `goodType` — the good's `landscapeToPickup`
   * record (wood's "trunk" stage: a felled LOG lying on the ground, distinct from the tidy delivered
   * heap). A loose {@link import('@vinland/sim').GroundDrop} draws this; the original uses a different
   * graphic for the on-the-ground harvest than for the stored pile (`tree → trunk(pickup) → wood(store)`).
   * Carries the record's FULL fewest→most state ladder (the clay/iron/gold ore and wheat pickup
   * records author 5 states, state ≡ units; STONE's authors a single state, so a stone drop keeps
   * one look at any count) so the drop is drawn by its actual unit count — one chipped ore draws
   * the single-piece frame, never the full 5-piece heap (the reported bug).
   */
  readonly trunksByGood: Readonly<Record<number, GatheringNodeLevelsRef>>;
  /** Ground-pile ref per scene `goodType` (its `landscapeToStore` record's per-fill heap frames). */
  readonly pilesByGood: Readonly<Record<number, GatheringPileRef>>;
  /** The delivery-flag ref (`ls_temp` player-01 sign), when the record is present in the IR. */
  readonly flag?: GatheringNodeRef;
}

/** The trailing `<name>.bmd` of a normalized asset path — `data/.../ls_ground.bmd` → `ls_ground`. */
function bmdStem(bmd: string): string {
  const base = bmd.slice(bmd.lastIndexOf('/') + 1);
  return base.endsWith('.bmd') ? base.slice(0, -'.bmd'.length) : base;
}

/** The served atlas stem (`<bmd-stem>.<palette>`) of a landscape gfx record, or `undefined` when it names
 *  no body bob or palette (a pure-logic record with no drawable atlas). */
export function servedStem(record: LandscapeGfxRow): string | undefined {
  if (record.bmd === undefined || record.bmd.trim() === '') return undefined;
  if (record.paletteName === undefined || record.paletteName.trim() === '') return undefined;
  return `${bmdStem(record.bmd)}.${record.paletteName}`;
}

/**
 * The representative full-grown bob of a node record: its HIGHEST-state frame list's first bob. States
 * count up with growth/valency (a tree's `s3` is the full tree, `s1` a sapling; a mine's `s5` is the full
 * deposit), so the top state is the fresh, undepleted node — the frame a static/full node draws (a felled
 * trunk, a flag, a stump; the shrink-by-level pick for a live mined DEPOSIT is {@link nodeLevelBobs}).
 * `undefined` when the record has no frames. Pure.
 */
export function nodeBob(record: LandscapeGfxRow): number | undefined {
  let best: { state: number; bob: number } | undefined;
  for (const f of record.frames ?? []) {
    const bob = f.bobIds[0];
    if (bob === undefined) continue;
    if (best === undefined || f.state > best.state) best = { state: f.state, bob };
  }
  return best?.bob;
}

/**
 * The first bob of each of a record's frame states, ordered by ASCENDING state (`state 1` → index 0). The
 * shared basis for both a pile's fewest→most heap frames and a mine deposit's empty→full level frames — a
 * higher state is always MORE (more units in a pile, a fuller deposit), so a `fill`/`level` (1-based,
 * highest = most) indexes `[value - 1]`. `undefined` when the record has no frames. Pure.
 */
function firstBobsByStateAscending(record: LandscapeGfxRow): readonly number[] | undefined {
  const byState = [...(record.frames ?? [])]
    .filter((f) => f.bobIds[0] !== undefined)
    .sort((a, b) => a.state - b.state);
  if (byState.length === 0) return undefined;
  return byState.map((f) => f.bobIds[0] as number);
}

/**
 * The per-fill heap bobs of a pile record, ordered FEWEST→MOST units: state `1`'s first bob, then `2`,
 * … up to the record's max state (`ls_goods` piles carry 5 fill states). The
 * {@link StockpileBinding.byGood} table indexes these by a pile's fill amount, so the heap grows with its
 * contents. `undefined` when the record has no frames. Pure.
 */
export function pileFillBobs(record: LandscapeGfxRow): readonly number[] | undefined {
  return firstBobsByStateAscending(record);
}

/**
 * The per-LEVEL node bobs of a resource record, ordered EMPTY→FULL: `state 1`'s first bob (the dregs),
 * then `2`, … up to the record's full state (the `ls_ground` clay/iron/gold mines carry 5 fill states).
 * The {@link ResourceTypeBinding.byGood} table indexes these by a mined deposit's shrink-by-level fill, so
 * the drawn mine SHRINKS as it empties. A non-mined node (a tree/mushroom — one state) yields a one-frame
 * list, drawn at any level. `undefined` when the record has no frames. Pure.
 *
 * NAMED APPROXIMATION: each state contributes only its FIRST bob, drawn as a still — the original
 * loops the state's whole frame list (e.g. "wheat mine 01" carries 16 frames per growth state,
 * `loopAnimation true`), so a growing field that sways in the original stands still here until the
 * resource lane learns to tick through a state's frames.
 */
export function nodeLevelBobs(record: LandscapeGfxRow): readonly number[] | undefined {
  return firstBobsByStateAscending(record);
}

/** Pick the representative (lowest-index) placeable gfx record of a pipeline stage, or `undefined`. */
function representativeRecord(
  stage: GatheringStageRow | undefined,
  byIndex: ReadonlyMap<number, LandscapeGfxRow>,
): LandscapeGfxRow | undefined {
  if (stage === undefined) return undefined;
  // gfxIndices are ascending, so the first that resolves is the lowest-index ("01") variant —
  // deterministic and typically the canonical species/decal (wood → "yew 01", stone → "stones 01").
  for (const idx of stage.gfxIndices) {
    const record = byIndex.get(idx);
    if (record !== undefined) return record;
  }
  return undefined;
}

/**
 * Resolve the per-good gathering draws from the Step-1 pipeline join for the goods a scene/slice runs —
 * the node (its `landscapeToHarvest` record, falling back to `landscapeToPickup` for a good with no
 * standing stage like the mushroom's direct pickup) and the pile (its `landscapeToStore` record), matched
 * to each scene good by `goodId === good.id` and keyed under the scene's `typeId`. The flag is resolved
 * once from the {@link FLAG_EDIT_NAME} record. Independent of which atlases actually load — the
 * loaded/default decision is {@link buildResourceBinding}/{@link buildStockpileBinding}'s. Pure.
 */
export function resolveGatheringRefs(
  goods: readonly GoodRef[],
  ir: ContentIr | null,
  goodIcons?: GoodIconMap | null,
): GatheringRefs {
  const pipeline = ir?.gatheringPipeline ?? [];
  const gfx = ir?.landscapeGfx ?? [];
  const byIndex = new Map<number, LandscapeGfxRow>(gfx.map((g) => [g.index, g]));
  const byGoodId = new Map<string, GatheringPipelineRow>(pipeline.map((p) => [p.goodId, p]));

  const nodesByGood: Record<number, GatheringNodeLevelsRef> = {};
  const nodesByGfxIndex: Record<number, GatheringNodeLevelsRef> = {};
  const trunksByGood: Record<number, GatheringNodeLevelsRef> = {};
  const pilesByGood: Record<number, GatheringPileRef> = {};
  for (const good of goods) {
    const p = byGoodId.get(good.id);
    if (p === undefined) continue;
    const nodeRecord = representativeRecord(p.harvest ?? p.pickup, byIndex);
    if (nodeRecord !== undefined) {
      const stem = servedStem(nodeRecord);
      const bobs = nodeLevelBobs(nodeRecord); // empty→full fill states — a mined deposit shrinks through them
      if (stem !== undefined && bobs !== undefined) nodesByGood[good.typeId] = { stem, bobs };
    }
    // EVERY harvest-stage variant of the good ("yew 01" … "cedar 02"), keyed by its gfx record index —
    // the table a decoded-map node's own `gfxIndex` picks its exact original species/decal from.
    for (const idx of (p.harvest ?? p.pickup)?.gfxIndices ?? []) {
      const record = byIndex.get(idx);
      if (record === undefined) continue;
      const stem = servedStem(record);
      const bobs = nodeLevelBobs(record);
      if (stem !== undefined && bobs !== undefined) nodesByGfxIndex[idx] = { stem, bobs };
    }
    // The freshly-dropped trunk (the `landscapeToPickup` stage), drawn by a loose GroundDrop before it is
    // carried off — the record's whole fewest→most state ladder, indexed by the drop's unit count (the
    // original picks the state whose number equals the remaining valency). Only bind it for a good that
    // actually has a distinct pickup stage; a good without one (harvest === pickup) falls back to the pile.
    const trunkRecord = representativeRecord(p.pickup, byIndex);
    if (trunkRecord !== undefined) {
      const stem = servedStem(trunkRecord);
      const bobs = nodeLevelBobs(trunkRecord);
      if (stem !== undefined && bobs !== undefined) trunksByGood[good.typeId] = { stem, bobs };
    }
    const pileRecord = representativeRecord(p.store, byIndex);
    if (pileRecord !== undefined) {
      const stem = servedStem(pileRecord);
      const fillBobs = pileFillBobs(pileRecord);
      if (stem !== undefined && fillBobs !== undefined) pilesByGood[good.typeId] = { stem, fillBobs };
    }
  }

  // The synthetic `plank` (the joinery slice's output — no gathering pipeline, no `ls_goods` art of its own)
  // draws as the felled LOG: `wood`'s pickup-stage trunk (the `test_piles` "tree trunk" bob), so a dropped
  // plank reads as sawn timber lying on the ground, visually distinct from the wood PILE rather than the
  // neutral heap it would otherwise share with wood. Mirrors settler-gfx's `plank: 'wood'` carry alias.
  // Applied BEFORE the goodIcons fallback so the log wins over the generic heap; its atlas is already loaded
  // because wood references the same trunk stem.
  const woodTrunk = trunksByGood[goods.find((g) => g.id === 'wood')?.typeId ?? -1];
  const plankType = goods.find((g) => g.id === 'plank')?.typeId;
  if (woodTrunk !== undefined && plankType !== undefined) {
    trunksByGood[plankType] = woodTrunk;
    pilesByGood[plankType] = { stem: woodTrunk.stem, fillBobs: woodTrunk.bobs };
  }

  // Every OTHER good (not gathered, so absent from the pipeline) gets its on-the-ground graphic from the
  // goods-icon manifest — its recoloured `ls_goods` heap by (palette, growth states). This is why a dropped
  // brick, sword, or loaf draws its own pile on the ground and grows with its contents, not the bare
  // placeholder marker. Only the goods with no manifest icon at all — the animal/vehicle/special tokens that
  // share `landscapeType 1` (prey, sheep, cattle, the carts/ships, catapult, chest, anything) — fall back to
  // the neutral generic heap; the potions/amulets/fruit DO bind (via the `goods all` record). BOTH the
  // pile and the trunk bind the manifest's full `fillFrames` (fewest→most): a player-dropped bare
  // stockpile grows through the 5 pile states, and a `GroundDrop` of the good draws the frame matching
  // its unit count (one unit → the single-item frame).
  if (goodIcons != null) {
    for (const good of goods) {
      const icon = goodIcons.get(good.id) ?? GENERIC_GOOD_ICON;
      const stem = `${GOODS_PILE_BMD_STEM}.${icon.palette}`;
      const fillBobs = icon.fillFrames.length > 0 ? icon.fillFrames : [icon.frame];
      if (pilesByGood[good.typeId] === undefined) pilesByGood[good.typeId] = { stem, fillBobs };
      if (trunksByGood[good.typeId] === undefined) trunksByGood[good.typeId] = { stem, bobs: fillBobs };
    }
  }

  const flagRecord = gfx.find((g) => g.editName === FLAG_EDIT_NAME);
  const flagStem = flagRecord !== undefined ? servedStem(flagRecord) : undefined;
  const flagBob = flagRecord !== undefined ? nodeBob(flagRecord) : undefined;
  const flag = flagStem !== undefined && flagBob !== undefined ? { stem: flagStem, bob: flagBob } : undefined;

  return { nodesByGood, nodesByGfxIndex, trunksByGood, pilesByGood, ...(flag !== undefined ? { flag } : {}) };
}

/**
 * The set of NON-default served atlas stems the gathering draws reference — every node stem that isn't the
 * default resource family, every pile stem, and the flag stem. This is exactly the atlases
 * {@link import('./sprite-sheet.js')} must load into `families` for the layer-qualified refs to draw;
 * the default-family node stem (the yew) is excluded since it is already the `kindLayers.resource` layer.
 */
export function gatheringAtlasStems(refs: GatheringRefs): Set<string> {
  const stems = new Set<string>();
  for (const node of Object.values(refs.nodesByGood)) {
    if (node.stem !== DEFAULT_RESOURCE_STEM) stems.add(node.stem);
  }
  for (const node of Object.values(refs.nodesByGfxIndex)) {
    if (node.stem !== DEFAULT_RESOURCE_STEM) stems.add(node.stem);
  }
  for (const trunk of Object.values(refs.trunksByGood)) {
    if (trunk.stem !== DEFAULT_RESOURCE_STEM) stems.add(trunk.stem);
  }
  for (const pile of Object.values(refs.pilesByGood)) stems.add(pile.stem);
  if (refs.flag !== undefined) stems.add(refs.flag.stem);
  return stems;
}

/** A node/pile bob → {@link LayeredBobRef}: bare when it draws from the default resource layer (the yew
 *  tree), layer-qualified into its own loaded family otherwise. */
function bobRef(stem: string, bob: number): LayeredBobRef {
  return stem === DEFAULT_RESOURCE_STEM ? bob : { layer: stem, bob };
}

/**
 * The debris `[GfxLandscape]` record left where a tree is FELLED — `"tree debris medium"` in
 * `ls_trees_dead.bmd` (logicType 1 = pure decor), the stump/remnant a chopped tree leaves behind (the
 * multi-hit harvest's `Stump` decor entity draws it). Deliberately the debris, not the standing
 * `tree_dead` (logicType 4, an undisturbed dead tree) nor the `tree_dead falling` (logicType 5, the
 * mid-fall frame — that transition is the Step-7 falling-animation polish, source basis).
 */
export const STUMP_EDIT_NAME = 'tree debris medium';

/** Resolve the stump/debris draw (served atlas stem + bob) from the IR's landscape gfx, matched by
 *  {@link STUMP_EDIT_NAME}, or `undefined` when the record/atlas is absent (a checkout without the
 *  dead-tree atlas, or an older `content/` — the stump then falls back to the placeholder). Mirrors the
 *  flag resolution in {@link resolveGatheringRefs}. Pure. */
export function resolveStumpRef(ir: ContentIr | null): GatheringNodeRef | undefined {
  const record = (ir?.landscapeGfx ?? []).find((g) => g.editName === STUMP_EDIT_NAME);
  if (record === undefined) return undefined;
  const stem = servedStem(record);
  const bob = nodeBob(record);
  return stem !== undefined && bob !== undefined ? { stem, bob } : undefined;
}

/**
 * Reduce the resolved stump ref to the renderer's per-good {@link ResourceTypeBinding} (the same shape a
 * resource node uses — a stump draws like a static node, from the dead-tree family): a single `default`
 * debris frame, since the only fellable resource in this step is the tree (Step 4 adds per-good drops).
 * Returns `undefined` when the debris atlas did not load, so the binding is omitted and the stump falls
 * back to the placeholder rather than borrowing a wrong frame. Pure + unit-tested.
 */
export function buildStumpBinding(
  stump: GatheringNodeRef | undefined,
  loaded: ReadonlySet<string>,
): ResourceTypeBinding | undefined {
  if (stump === undefined || !loaded.has(stump.stem)) return undefined;
  return { byGood: {}, default: { layer: stump.stem, bob: stump.bob } };
}

/** A resolved berry-bush draw: the fruited-record INDEX (the {@link import('@vinland/sim').BerryBush.gfxIndex}
 *  → {@link import('@vinland/render').DrawItem.gfxIndex} join key) and its two render states — `ripe`
 *  (holds fruit) and `bare` (foraged, regrowing), each a served atlas stem + bob. */
export interface BerryBushRef {
  readonly gfxIndex: number;
  readonly ripe: GatheringNodeRef;
  readonly bare: GatheringNodeRef;
}

/**
 * Resolve every forageable berry bush's ripe+bare draw from the IR landscape gfx: each fruited-bush record
 * (`logicType === bush with fruits`) paired with its bare twin — the same species' "… empty" record
 * (`bush naked`), matched by editName ("bush 01 fruits" → "bush 01 empty", "bush snow 02 fruits" → "bush
 * snow 02 empty"). A bush with no matching empty record reuses its fruited frame for the bare state
 * (degraded, still drawn). Keyed by the fruited record index. Pure; degrades to empty on an older ir.json.
 */
export function resolveBerryBushRefs(ir: ContentIr | null): BerryBushRef[] {
  const records = ir?.landscapeGfx ?? [];
  const byName = new Map<string, LandscapeGfxRow>();
  for (const g of records) if (g.editName !== undefined) byName.set(g.editName, g);
  const out: BerryBushRef[] = [];
  for (const rec of records) {
    if (rec.logicType !== BUSH_WITH_FRUITS_LOGIC_TYPE || rec.editName === undefined) continue;
    const ripeStem = servedStem(rec);
    const ripeBob = nodeBob(rec);
    if (ripeStem === undefined || ripeBob === undefined) continue;
    const ripe: GatheringNodeRef = { stem: ripeStem, bob: ripeBob };
    // The bare twin: the same species' "… empty" record (bush naked). Fall back to the ripe frame when
    // absent, so a bush with no decoded empty state still draws (just always fruited).
    const emptyRec = byName.get(rec.editName.replace(/fruits?$/i, 'empty'));
    let bare = ripe;
    if (emptyRec !== undefined) {
      const bareStem = servedStem(emptyRec);
      const bareBob = nodeBob(emptyRec);
      if (bareStem !== undefined && bareBob !== undefined) bare = { stem: bareStem, bob: bareBob };
    }
    out.push({ gfxIndex: rec.index, ripe, bare });
  }
  return out;
}

/** Atlas stems a set of {@link BerryBushRef}s draw from (both ripe + bare states) — folded into the loaded
 *  gathering families so the live pool can draw a bush in either state after its static→live handover. */
export function berryBushAtlasStems(refs: readonly BerryBushRef[]): Set<string> {
  const out = new Set<string>();
  for (const r of refs) {
    out.add(r.ripe.stem);
    out.add(r.bare.stem);
  }
  return out;
}

/**
 * Reduce resolved berry-bush refs to a {@link ResourceTypeBinding}: each bush keyed under its fruited
 * `gfxIndex` with a TWO-frame level list — level 1 (bare) → the empty frame, level 2 (ripe) → the fruited
 * frame (the same empty→full order {@link buildResourceBinding} uses, so `DrawItem.level` picks straight).
 * A bare frame whose atlas family did not load reuses the ripe frame (the bush still draws, just always
 * fruited); a bush whose RIPE family did not load is dropped (it falls back to the placeholder). `default`
 * is the first bush's ripe frame — what a bush with no matching `gfxIndex` draws. Undefined when nothing
 * loaded. Pure + unit-tested.
 */
export function buildBerryBushBinding(
  refs: readonly BerryBushRef[],
  loaded: ReadonlySet<string>,
): ResourceTypeBinding | undefined {
  const byGfxIndex: Record<number, readonly LayeredBobRef[]> = {};
  let fallback: LayeredBobRef | undefined;
  for (const r of refs) {
    if (!loaded.has(r.ripe.stem)) continue; // no fruited atlas — drop it (placeholder)
    const ripeRef: LayeredBobRef = { layer: r.ripe.stem, bob: r.ripe.bob };
    const bareRef: LayeredBobRef = loaded.has(r.bare.stem)
      ? { layer: r.bare.stem, bob: r.bare.bob }
      : ripeRef; // no empty atlas — reuse the fruited frame for the bare state
    byGfxIndex[r.gfxIndex] = [bareRef, ripeRef]; // level 1 = bare, level 2 = ripe
    fallback ??= ripeRef;
  }
  if (fallback === undefined) return undefined;
  return { byGood: {}, byGfxIndex, default: fallback };
}

/**
 * Reduce the resolved node refs to the renderer's per-good {@link ResourceTypeBinding}: each good whose
 * node stem is the default family OR a LOADED named family binds its own node bob; a good whose family
 * failed to load is dropped (it falls back to the {@link TREE_BOB} default rather than borrowing a wrong
 * bob from the tree atlas — the same no-wrong-borrow rule the building families use). Pure + unit-tested.
 *
 * `familyFrames` (stem → the frame ids its LOADED atlas actually holds) marks data-pinned INVISIBLE
 * levels: when a record's level names a bob its own atlas doesn't have while its OTHER levels do, that
 * level binds `null` — the renderer then draws NOTHING for it. This is the original's freshly-sown wheat
 * (`wheat mine 01` state 1 → bob 4000, an out-of-atlas sentinel; states 2–5 are real frames). A good
 * whose levels are ALL missing keeps its refs instead — that is a genuinely broken binding and should
 * surface as the placeholder, not vanish.
 */
export function buildResourceBinding(
  refs: GatheringRefs,
  loaded: ReadonlySet<string>,
  familyFrames?: ReadonlyMap<string, ReadonlySet<number>>,
): ResourceTypeBinding {
  const byGood: Record<number, readonly (LayeredBobRef | null)[]> = {};
  for (const [good, node] of Object.entries(refs.nodesByGood)) {
    if (node.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(node.stem)) continue; // unloaded family → drop
    // Per-level frames (empty→full) — the renderer indexes them by a mined deposit's shrink-by-level fill;
    // a non-mined node has a single-frame list, drawn at any level.
    const atlasFrames = familyFrames?.get(node.stem);
    const anyPresent = atlasFrames !== undefined && node.bobs.some((bob) => atlasFrames.has(bob));
    byGood[Number(good)] = node.bobs.map((bob) =>
      anyPresent && !(atlasFrames?.has(bob) ?? true) ? null : bobRef(node.stem, bob),
    );
  }
  // The per-VARIANT table (a decoded-map node's own species/decal) — same load-then-drop-unloaded rule,
  // so a variant whose family atlas failed to load falls back to the per-good representative, never a
  // wrong frame.
  const byGfxIndex: Record<number, readonly LayeredBobRef[]> = {};
  for (const [idx, node] of Object.entries(refs.nodesByGfxIndex)) {
    if (node.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(node.stem)) continue;
    byGfxIndex[Number(idx)] = node.bobs.map((bob) => bobRef(node.stem, bob));
  }
  return { byGood, byGfxIndex, default: TREE_BOB };
}

/**
 * Reduce the resolved trunk refs (the `landscapeToPickup` stage) to the renderer's per-good
 * {@link ResourceTypeBinding} — the graphic a loose {@link import('@vinland/sim').GroundDrop} draws while
 * its felled wood / chipped ore lies on the ground waiting to be carried off. Binds the record's whole
 * fewest→most state ladder: the resolver indexes it by the drop's unit count (`DrawItem.fill`), so one
 * dug ore draws the single-piece frame and a stacked drop grows — the original's state ≡ remaining-units
 * read. Same load-then-drop-unloaded rule as {@link buildResourceBinding}; the `TREE_BOB` default is a
 * visible fallback for a good with no bound trunk. Pure + unit-tested.
 */
export function buildTrunkBinding(refs: GatheringRefs, loaded: ReadonlySet<string>): ResourceTypeBinding {
  const byGood: Record<number, readonly LayeredBobRef[]> = {};
  for (const [good, trunk] of Object.entries(refs.trunksByGood)) {
    if (trunk.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(trunk.stem)) continue; // unloaded family → drop
    byGood[Number(good)] = trunk.bobs.map((bob) => bobRef(trunk.stem, bob));
  }
  return { byGood, default: TREE_BOB };
}

/**
 * Reduce the resolved pile + flag refs to the renderer's {@link StockpileBinding}: each good whose pile
 * atlas LOADED binds its per-fill heap frames; the flag binds the loaded `ls_temp` sign. A good whose pile
 * atlas failed to load is dropped, and an unloaded flag / a held pile with no frames falls back to the
 * placeholder heap (a bare ref, which the renderer draws as the sandy marker — never a wrong atlas frame).
 * Pure + unit-tested.
 */
export function buildStockpileBinding(refs: GatheringRefs, loaded: ReadonlySet<string>): StockpileBinding {
  const byGood: Record<number, readonly LayeredBobRef[]> = {};
  for (const [good, pile] of Object.entries(refs.pilesByGood)) {
    if (!loaded.has(pile.stem)) continue; // unloaded pile family → drop (falls to the placeholder heap)
    byGood[Number(good)] = pile.fillBobs.map((bob) => ({ layer: pile.stem, bob }));
  }
  const flag: LayeredBobRef =
    refs.flag !== undefined && loaded.has(refs.flag.stem)
      ? { layer: refs.flag.stem, bob: refs.flag.bob }
      : STOCKPILE_PLACEHOLDER_BOB;
  return { byGood, flag, default: STOCKPILE_PLACEHOLDER_BOB };
}
