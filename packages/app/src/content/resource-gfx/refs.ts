import type { LayeredBobRef } from '@open-northland/render';
import { TREE_ATLAS } from '../building-gfx/index.js';
import { GENERIC_GOOD_ICON, type GoodIconMap } from '../goods-gfx.js';
import { servedAtlasStem } from '../ir/joins.js';
import type { ContentIr, GatheringPipelineRow, GatheringStageRow, LandscapeGfxRow } from '../ir/rows.js';
import type { GoodRef } from '../settler-gfx/index.js';

/** The `.bmd` half of a good's recoloured pile stem, `ls_goods.<palette>`. */
const GOODS_PILE_BMD_STEM = 'ls_goods';

export const DEFAULT_RESOURCE_STEM = TREE_ATLAS;

/**
 * The delivery-flag `[GfxLandscape]` record's `EditName` - the player-coloured "work extern" flag in
 * `ls_temp.bmd` (bob 76). Deliberately not the `"… sign"` record (a building-occupancy emblem) nor the
 * `residence`/`construction`/`soldier` markers. Player-01 colour only (source basis "Gathering-economy
 * graphics").
 */
export const FLAG_EDIT_NAME = 'player01 work extern 01';

/** A bare fallback bob for a stockpile slot with no real frame. A stockpile has no `kindLayers` layer of
 *  its own, so only the ref's bare-ness matters, not the value. */
export const STOCKPILE_PLACEHOLDER_BOB = 0;

/** A resolved standing-node draw, before the loaded-vs-default family decision. */
export interface GatheringNodeRef {
  readonly stem: string;
  readonly bob: number;
}

/** A standing-node draw with its per-level bobs, ordered empty→full; a non-mined node has one. */
export interface GatheringNodeLevelsRef {
  readonly stem: string;
  readonly bobs: readonly number[];
}

/** A resolved ground-pile draw: its per-fill bob ids, ordered fewest→most units. */
export interface GatheringPileRef {
  readonly stem: string;
  readonly fillBobs: readonly number[];
}

/** The per-good gathering draws resolved from the pipeline join (independent of which atlases loaded). */
export interface GatheringRefs {
  /** Standing-node ref per scene `goodType`, from its `landscapeToHarvest` record. */
  readonly nodesByGood: Readonly<Record<number, GatheringNodeLevelsRef>>;
  /**
   * Standing-node ref per harvest-stage `[GfxLandscape]` record index - one entry per species variant
   * ("yew 01" … "cedar 02", every stone/mine decal). A decoded-map node carries its own variant index
   * (`Resource.gfxIndex` → `DrawItem.gfxIndex`), so this table lets it draw the exact original object
   * instead of one representative species per good.
   */
  readonly nodesByGfxIndex: Readonly<Record<number, GatheringNodeLevelsRef>>;
  /**
   * Freshly-dropped, not-yet-collected pile ref per scene `goodType`, from the good's `landscapeToPickup`
   * record (`tree → trunk(pickup) → wood(store)`, a felled log distinct from the tidy delivered heap).
   * State ≡ units, so a drop draws by its actual unit count; records authoring a single state (stone,
   * leather, mushroom, meat) draw that one frame at any count.
   */
  readonly trunksByGood: Readonly<Record<number, GatheringNodeLevelsRef>>;
  /** Ground-pile ref per scene `goodType` (its `landscapeToStore` record's per-fill heap frames). */
  readonly pilesByGood: Readonly<Record<number, GatheringPileRef>>;
  /** The delivery-flag ref (`ls_temp` player-01 sign), when the record is present in the IR. */
  readonly flag?: GatheringNodeRef;
}

/**
 * The representative full-grown bob of a node record: its highest-state frame list's first bob. States count
 * up with growth or valency (a tree's `s3` is the full tree, `s1` a sapling), so the top state is the fresh,
 * undepleted node.
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

/** A landscape gfx record → its served atlas stem + representative full-grown bob, or `undefined` when it
 *  names no drawable atlas or frame. */
export function nodeRefFrom(record: LandscapeGfxRow): GatheringNodeRef | undefined {
  const stem = servedAtlasStem(record);
  const bob = nodeBob(record);
  return stem !== undefined && bob !== undefined ? { stem, bob } : undefined;
}

/**
 * The first bob of each of a record's frame states, ordered by ascending state (`state 1` → index 0). A
 * higher state is always more (more units in a pile, a fuller deposit), so a 1-based `fill`/`level` indexes
 * `[value - 1]`. The `ls_goods` piles and the `ls_ground` clay/iron/gold mines carry 5 states; a non-mined
 * node has one, drawn at any level.
 *
 * Named approximation: each state contributes only its first bob, drawn as a still. The original loops the
 * state's whole frame list (e.g. "wheat mine 01" carries 16 frames per growth state, `loopAnimation true`),
 * so a field that sways in the original stands still here.
 */
export function firstBobsByStateAscending(record: LandscapeGfxRow): readonly number[] | undefined {
  const byState = [...(record.frames ?? [])]
    .sort((a, b) => a.state - b.state)
    .flatMap((f) => (f.bobIds[0] !== undefined ? [f.bobIds[0]] : []));
  return byState.length === 0 ? undefined : byState;
}

/** The levels twin of {@link nodeRefFrom}: the served atlas stem plus the per-state bob ladder. */
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
  // gfxIndices are ascending, so the first that resolves is the "01" variant (wood → "yew 01").
  for (const idx of stage.gfxIndices) {
    const record = byIndex.get(idx);
    if (record !== undefined) return record;
  }
  return undefined;
}

/**
 * Resolve the per-good gathering draws from the pipeline join, matched by `goodId === good.id` and keyed
 * under the scene's `typeId`. The node comes from the `landscapeToHarvest` record, falling back to
 * `landscapeToPickup` for a good with no standing stage (honey's direct pickup).
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
    const trunkRecord = representativeRecord(p.pickup, byIndex);
    const trunkRef = trunkRecord !== undefined ? levelsRefFrom(trunkRecord) : undefined;
    if (trunkRef !== undefined) trunksByGood[good.typeId] = trunkRef;
    const pileRecord = representativeRecord(p.store, byIndex);
    const pileRef = pileRecord !== undefined ? levelsRefFrom(pileRecord) : undefined;
    if (pileRef !== undefined) pilesByGood[good.typeId] = { stem: pileRef.stem, fillBobs: pileRef.bobs };
  }

  // The synthetic `plank` has no gathering pipeline and no `ls_goods` art of its own, so it draws as
  // `wood`'s pickup-stage trunk, whose atlas wood already loads. Applied before the goodIcons fallback so
  // the log wins over the generic heap.
  const woodTrunk = trunksByGood[goods.find((g) => g.id === 'wood')?.typeId ?? -1];
  const plankType = goods.find((g) => g.id === 'plank')?.typeId;
  if (woodTrunk !== undefined && plankType !== undefined) {
    trunksByGood[plankType] = woodTrunk;
    pilesByGood[plankType] = { stem: woodTrunk.stem, fillBobs: woodTrunk.bobs };
  }

  // Every other good (not gathered, so absent from the pipeline) draws its recoloured `ls_goods` heap from
  // the goods-icon manifest; one with no manifest icon (the animal/vehicle/special tokens sharing
  // `landscapeType 1`) falls back to the neutral generic heap.
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
 * The non-default served atlas stems the gathering draws reference - the atlases the sheet loader must
 * register in `families` for the layer-qualified refs to draw. The yew is excluded because it is already
 * the `kindLayers.resource` layer.
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

/** A node/pile bob as a bare ref when it draws from the default resource layer, layer-qualified into its
 *  own loaded family otherwise. */
export function bobRef(stem: string, bob: number): LayeredBobRef {
  return stem === DEFAULT_RESOURCE_STEM ? bob : { layer: stem, bob };
}
