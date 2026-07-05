import type { LayeredBobRef, ResourceTypeBinding, StockpileBinding } from '@vinland/render';
import { TREE_ATLAS, TREE_BOB } from './building-gfx.js';
import type { GatheringPipelineRow, GatheringStageRow, LandscapeGfxRow, RenderIr } from './ir.js';
import type { GoodRef } from './settler-gfx.js';

/**
 * The gathering-economy render binding: reduce the Step-1 `gatheringPipeline` join (good → its
 * `landscapeTo{Harvest,Store}` stage → the `[GfxLandscape]` records that place it) to the renderer's
 * per-good {@link ResourceTypeBinding} (standing resource nodes) + {@link StockpileBinding} (dropped
 * ground piles + a delivery flag). Each good's node draws ITS own decoded object — a tree for wood, a
 * rock for stone, a mine decal for iron/gold/clay, a mushroom — and each pile draws that good's own
 * `ls_goods` heap growing with its contents, replacing the one hardcoded yew bob every resource used to
 * draw (docs/ROADMAP.md rung-2 "Resource nodes by goodType" + "Loose ground piles + flags rendering").
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
 * (players 02–16 have their own `human_playerNN` records) is a deferred follow-up — see docs/FIDELITY.md
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
   * Freshly-dropped, NOT-yet-collected pile ref per scene `goodType` — the good's `landscapeToPickup`
   * record (wood's "trunk" stage: a felled LOG lying on the ground, distinct from the tidy delivered
   * heap). A loose {@link import('@vinland/sim').GroundDrop} draws this; the original uses a different
   * graphic for the on-the-ground harvest than for the stored pile (`tree → trunk(pickup) → wood(store)`).
   * A single representative frame — a felled log reads the same regardless of exact units.
   */
  readonly trunksByGood: Readonly<Record<number, GatheringNodeRef>>;
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
export function resolveGatheringRefs(goods: readonly GoodRef[], ir: RenderIr | null): GatheringRefs {
  const pipeline = ir?.gatheringPipeline ?? [];
  const gfx = ir?.landscapeGfx ?? [];
  const byIndex = new Map<number, LandscapeGfxRow>(gfx.map((g) => [g.index, g]));
  const byGoodId = new Map<string, GatheringPipelineRow>(pipeline.map((p) => [p.goodId, p]));

  const nodesByGood: Record<number, GatheringNodeLevelsRef> = {};
  const trunksByGood: Record<number, GatheringNodeRef> = {};
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
    // The freshly-dropped trunk (the `landscapeToPickup` stage), drawn by a loose GroundDrop before it is
    // carried off — a single representative frame, the felled log. Only bind it for a good that actually
    // has a distinct pickup stage; a good without one (its harvest === pickup) falls back to the pile.
    const trunkRecord = representativeRecord(p.pickup, byIndex);
    if (trunkRecord !== undefined) {
      const stem = servedStem(trunkRecord);
      const bob = nodeBob(trunkRecord);
      if (stem !== undefined && bob !== undefined) trunksByGood[good.typeId] = { stem, bob };
    }
    const pileRecord = representativeRecord(p.store, byIndex);
    if (pileRecord !== undefined) {
      const stem = servedStem(pileRecord);
      const fillBobs = pileFillBobs(pileRecord);
      if (stem !== undefined && fillBobs !== undefined) pilesByGood[good.typeId] = { stem, fillBobs };
    }
  }

  const flagRecord = gfx.find((g) => g.editName === FLAG_EDIT_NAME);
  const flagStem = flagRecord !== undefined ? servedStem(flagRecord) : undefined;
  const flagBob = flagRecord !== undefined ? nodeBob(flagRecord) : undefined;
  const flag = flagStem !== undefined && flagBob !== undefined ? { stem: flagStem, bob: flagBob } : undefined;

  return { nodesByGood, trunksByGood, pilesByGood, ...(flag !== undefined ? { flag } : {}) };
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
 * mid-fall frame — that transition is the Step-7 falling-animation polish, docs/FIDELITY.md).
 */
export const STUMP_EDIT_NAME = 'tree debris medium';

/** Resolve the stump/debris draw (served atlas stem + bob) from the IR's landscape gfx, matched by
 *  {@link STUMP_EDIT_NAME}, or `undefined` when the record/atlas is absent (a checkout without the
 *  dead-tree atlas, or an older `content/` — the stump then falls back to the placeholder). Mirrors the
 *  flag resolution in {@link resolveGatheringRefs}. Pure. */
export function resolveStumpRef(ir: RenderIr | null): GatheringNodeRef | undefined {
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

/**
 * Reduce the resolved node refs to the renderer's per-good {@link ResourceTypeBinding}: each good whose
 * node stem is the default family OR a LOADED named family binds its own node bob; a good whose family
 * failed to load is dropped (it falls back to the {@link TREE_BOB} default rather than borrowing a wrong
 * bob from the tree atlas — the same no-wrong-borrow rule the building families use). Pure + unit-tested.
 */
export function buildResourceBinding(refs: GatheringRefs, loaded: ReadonlySet<string>): ResourceTypeBinding {
  const byGood: Record<number, readonly LayeredBobRef[]> = {};
  for (const [good, node] of Object.entries(refs.nodesByGood)) {
    if (node.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(node.stem)) continue; // unloaded family → drop
    // Per-level frames (empty→full) — the renderer indexes them by a mined deposit's shrink-by-level fill;
    // a non-mined node has a single-frame list, drawn at any level.
    byGood[Number(good)] = node.bobs.map((bob) => bobRef(node.stem, bob));
  }
  return { byGood, default: TREE_BOB };
}

/**
 * Reduce the resolved trunk refs (the `landscapeToPickup` stage) to the renderer's per-good
 * {@link ResourceTypeBinding} — the graphic a loose {@link import('@vinland/sim').GroundDrop} draws while
 * its felled wood lies on the ground waiting to be carried off. Same shape + load-then-drop-unloaded rule
 * as {@link buildResourceBinding}; the `TREE_BOB` default is a visible fallback for a good with no bound
 * trunk (dropped before Step 4 gives the mined goods their own pickup graphics). Pure + unit-tested.
 */
export function buildTrunkBinding(refs: GatheringRefs, loaded: ReadonlySet<string>): ResourceTypeBinding {
  const byGood: Record<number, readonly LayeredBobRef[]> = {};
  for (const [good, trunk] of Object.entries(refs.trunksByGood)) {
    if (trunk.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(trunk.stem)) continue; // unloaded family → drop
    // A single representative log frame (a felled trunk / ore pile reads the same at any amount) — a
    // one-element level list, so the level-indexing resolver always draws it (a drop carries no level).
    byGood[Number(good)] = [bobRef(trunk.stem, trunk.bob)];
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
