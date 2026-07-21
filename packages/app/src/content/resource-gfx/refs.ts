import type { LayeredBobRef } from '@open-northland/render';
import { TREE_ATLAS } from '../building-gfx/index.js';
import { GENERIC_GOOD_ICON, type GoodIconMap } from '../goods-gfx.js';
import { servedAtlasStem } from '../ir/joins.js';
import type { ContentIr, GatheringPipelineRow, GatheringStageRow, LandscapeGfxRow } from '../ir/rows.js';
import type { GoodRef } from '../settler-gfx/index.js';

/**
 * The gathering-economy draw resolution: reduce the Step-1 `gatheringPipeline` join (good → its
 * `landscapeTo{Harvest,Pickup,Store}` stage → the `[GfxLandscape]` records that place it) to the per-good
 * {@link GatheringRefs} the renderer bindings consume — independent of which atlases actually loaded. The
 * bindings themselves live in `./bindings.ts`; the stump + berry-bush resource kinds in `./stump.ts` /
 * `./berry-bush.ts`.
 */

/** The `ls_goods.bmd` served-atlas stem prefix — a good's recoloured pile atlas is `ls_goods.<palette>`
 *  (the pipeline's per-palette variant), so the goods-manifest `{frame, palette}` maps straight to a
 *  {@link GatheringPileRef} whose stem is `${GOODS_PILE_BMD_STEM}.${palette}`. */
const GOODS_PILE_BMD_STEM = 'ls_goods';

/**
 * The default resource atlas family — the shared `ls_trees.tree_yew01` layer drawn as the renderer's
 * {@link import('@open-northland/render').SpriteSheet.kindLayers}'s `resource`. A good whose node record
 * lives in this family binds a bare bob id (drawn from that layer, no `families` entry); every other good
 * binds a layer-qualified ref into its own loaded `families` atlas. {@link TREE_BOB} backs a good with no node.
 */
export const DEFAULT_RESOURCE_STEM = TREE_ATLAS;

/**
 * The delivery-flag `[GfxLandscape]` record's `EditName` — the plain player-coloured "work extern" flag in
 * `ls_temp.bmd` (`"player01 work extern 01"`, bob 76): the simple flag-on-a-pole the original plants on
 * the ground to mark an external work / collection point, which is what a gatherer's loose ground pile is.
 * Deliberately not the `"… sign"` record (a building-occupancy emblem that marks a staffed building, not a
 * ground collection point) nor the `residence`/`construction`/`soldier` markers. v1 is the player-01
 * colour; a per-player palette swap (players 02–16 have their own `human_playerNN` records) is a deferred
 * follow-up — see source basis "Gathering-economy graphics".
 */
export const FLAG_EDIT_NAME = 'player01 work extern 01';

/**
 * A bare fallback bob for a stockpile slot with no real frame (the flag atlas failed to load, or a held
 * pile's good has no bound heap). A stockpile has no `kindLayers` layer of its own, so a bare ref draws
 * the placeholder heap rather than a wrong atlas frame — the value is irrelevant, only its bare-ness is.
 */
export const STOCKPILE_PLACEHOLDER_BOB = 0;

/** A resolved standing-node draw: which served atlas stem + bob id (before the loaded/default decision). */
export interface GatheringNodeRef {
  readonly stem: string;
  readonly bob: number;
}

/** A resolved standing-node draw with its per-level bobs (a mined deposit's empty→full fill states; a
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
   * Standing-node ref per harvest-stage `[GfxLandscape]` record index — one entry per species variant
   * ("yew 01" … "cedar 02", every stone/mine decal) across every resolved good, same per-level frame
   * shape as {@link nodesByGood}. A decoded-map node carries its own variant index
   * (`Resource.gfxIndex` → `DrawItem.gfxIndex`), and this table is what lets it draw the
   * exact original object instead of collapsing every node of a good to one representative species.
   */
  readonly nodesByGfxIndex: Readonly<Record<number, GatheringNodeLevelsRef>>;
  /**
   * Freshly-dropped, not-yet-collected pile ref per scene `goodType` — the good's `landscapeToPickup`
   * record (wood's "trunk" stage: a felled log lying on the ground, distinct from the tidy delivered
   * heap). A loose {@link import('@open-northland/sim').GroundDrop} draws this; the original uses a different
   * graphic for the on-the-ground harvest than for the stored pile (`tree → trunk(pickup) → wood(store)`).
   * Carries the record's full fewest→most state ladder (the clay/iron/gold ore and wheat pickup records
   * author 5 states, state ≡ units; stone's authors a single state, so a stone drop keeps one look at any
   * count) so the drop is drawn by its actual unit count — one chipped ore draws the single-piece frame,
   * never the full 5-piece heap.
   */
  readonly trunksByGood: Readonly<Record<number, GatheringNodeLevelsRef>>;
  /** Ground-pile ref per scene `goodType` (its `landscapeToStore` record's per-fill heap frames). */
  readonly pilesByGood: Readonly<Record<number, GatheringPileRef>>;
  /** The delivery-flag ref (`ls_temp` player-01 sign), when the record is present in the IR. */
  readonly flag?: GatheringNodeRef;
}

/**
 * The representative full-grown bob of a node record: its highest-state frame list's first bob. States
 * count up with growth/valency (a tree's `s3` is the full tree, `s1` a sapling; a mine's `s5` is the full
 * deposit), so the top state is the fresh, undepleted node — the frame a static/full node draws (a felled
 * trunk, a flag, a stump; the shrink-by-level pick for a live mined deposit is {@link firstBobsByStateAscending}).
 * `undefined` when the record has no frames.
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

/** A landscape gfx record → its {@link GatheringNodeRef} (served atlas stem + representative full-grown
 *  bob), or `undefined` when it names no drawable atlas/frame. The shared resolution behind the flag,
 *  stump and berry-bush draws. */
export function nodeRefFrom(record: LandscapeGfxRow): GatheringNodeRef | undefined {
  const stem = servedAtlasStem(record);
  const bob = nodeBob(record);
  return stem !== undefined && bob !== undefined ? { stem, bob } : undefined;
}

/**
 * The first bob of each of a record's frame states, ordered by ascending state (`state 1` → index 0). The
 * one ladder behind both a pile's fewest→most heap frames and a mined deposit's empty→full level frames —
 * a higher state is always more (more units in a pile, a fuller deposit), so a `fill`/`level` (1-based,
 * highest = most) indexes `[value - 1]`. The `ls_goods` piles and the `ls_ground` clay/iron/gold mines
 * carry 5 states; a non-mined node (a tree/mushroom) has one, drawn at any level. `undefined` when the
 * record has no frames.
 *
 * Named approximation: each state contributes only its first bob, drawn as a still — the original loops
 * the state's whole frame list (e.g. "wheat mine 01" carries 16 frames per growth state,
 * `loopAnimation true`), so a growing field that sways in the original stands still here until the
 * resource lane learns to tick through a state's frames.
 */
export function firstBobsByStateAscending(record: LandscapeGfxRow): readonly number[] | undefined {
  const byState = [...(record.frames ?? [])]
    .sort((a, b) => a.state - b.state)
    .flatMap((f) => (f.bobIds[0] !== undefined ? [f.bobIds[0]] : []));
  return byState.length === 0 ? undefined : byState;
}

/** A landscape gfx record → its {@link GatheringNodeLevelsRef} (served atlas stem + the per-state bob
 *  ladder), or `undefined` when it names no drawable atlas/frames. The levels twin of
 *  {@link nodeRefFrom}, shared by the node, per-variant, trunk and pile resolutions. */
export function levelsRefFrom(record: LandscapeGfxRow): GatheringNodeLevelsRef | undefined {
  const stem = servedAtlasStem(record);
  const bobs = firstBobsByStateAscending(record);
  return stem !== undefined && bobs !== undefined ? { stem, bobs } : undefined;
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
 * loaded/default decision is {@link import('./bindings.js').buildResourceBinding}/
 * {@link import('./bindings.js').buildStockpileBinding}'s.
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
    const nodeRef = nodeRecord !== undefined ? levelsRefFrom(nodeRecord) : undefined;
    if (nodeRef !== undefined) nodesByGood[good.typeId] = nodeRef;
    for (const idx of (p.harvest ?? p.pickup)?.gfxIndices ?? []) {
      const record = byIndex.get(idx);
      if (record === undefined) continue;
      const ref = levelsRefFrom(record);
      if (ref !== undefined) nodesByGfxIndex[idx] = ref;
    }
    // The freshly-dropped trunk (the `landscapeToPickup` stage), bound only for a good that has one; a good
    // without a distinct pickup stage falls back to the pile.
    const trunkRecord = representativeRecord(p.pickup, byIndex);
    const trunkRef = trunkRecord !== undefined ? levelsRefFrom(trunkRecord) : undefined;
    if (trunkRef !== undefined) trunksByGood[good.typeId] = trunkRef;
    const pileRecord = representativeRecord(p.store, byIndex);
    const pileRef = pileRecord !== undefined ? levelsRefFrom(pileRecord) : undefined;
    if (pileRef !== undefined) pilesByGood[good.typeId] = { stem: pileRef.stem, fillBobs: pileRef.bobs };
  }

  // The synthetic `plank` (the joinery slice's output — no gathering pipeline, no `ls_goods` art of its own)
  // draws as `wood`'s pickup-stage trunk (the `test_piles` "tree trunk" bob), so a dropped plank reads as
  // sawn timber rather than sharing wood's neutral heap. Applied before the goodIcons fallback so the log
  // wins over the generic heap; its atlas is already loaded because wood references the same trunk stem.
  const woodTrunk = trunksByGood[goods.find((g) => g.id === 'wood')?.typeId ?? -1];
  const plankType = goods.find((g) => g.id === 'plank')?.typeId;
  if (woodTrunk !== undefined && plankType !== undefined) {
    trunksByGood[plankType] = woodTrunk;
    pilesByGood[plankType] = { stem: woodTrunk.stem, fillBobs: woodTrunk.bobs };
  }

  // Every other good (not gathered, so absent from the pipeline) gets its on-the-ground graphic from the
  // goods-icon manifest — its recoloured `ls_goods` heap by (palette, growth states), pile and trunk both on
  // the manifest's full fewest→most `fillFrames`. Only the goods with no manifest icon at all — the
  // animal/vehicle/special tokens that share `landscapeType 1` (prey, sheep, cattle, the carts/ships,
  // catapult, chest) — fall back to the neutral generic heap; the potions/amulets/fruit do bind (via the
  // `goods all` record).
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
  const flag = flagRecord !== undefined ? nodeRefFrom(flagRecord) : undefined;

  return { nodesByGood, nodesByGfxIndex, trunksByGood, pilesByGood, ...(flag !== undefined ? { flag } : {}) };
}

/**
 * The non-default served atlas stems the gathering draws reference — exactly the atlases
 * {@link import('../sprite-sheet/index.js')} must load into `families` for the layer-qualified refs to draw.
 * The default-family node stem (the yew) is excluded since it is already the `kindLayers.resource` layer.
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
export function bobRef(stem: string, bob: number): LayeredBobRef {
  return stem === DEFAULT_RESOURCE_STEM ? bob : { layer: stem, bob };
}
