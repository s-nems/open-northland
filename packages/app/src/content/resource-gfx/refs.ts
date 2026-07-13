import type { LayeredBobRef } from '@vinland/render';
import { TREE_ATLAS } from '../building-gfx/index.js';
import { GENERIC_GOOD_ICON, type GoodIconMap } from '../goods-gfx.js';
import type { ContentIr, GatheringPipelineRow, GatheringStageRow, LandscapeGfxRow } from '../ir.js';
import type { GoodRef } from '../settler-gfx/index.js';

/**
 * The gathering-economy draw RESOLUTION: reduce the Step-1 `gatheringPipeline` join (good → its
 * `landscapeTo{Harvest,Pickup,Store}` stage → the `[GfxLandscape]` records that place it) to the per-good
 * {@link GatheringRefs} the renderer bindings consume — independent of which atlases actually loaded. The
 * bindings themselves live in `./bindings.ts`; the stump + berry-bush resource kinds in `./stump.ts` /
 * `./berry-bush.ts`. The pure reducers here are unit-tested without a browser.
 */

/** The `ls_goods` served-atlas stem prefix — a good's recoloured pile atlas is `ls_goods.<palette>`. */
const GOODS_PILE_BMD_STEM = 'ls_goods';

/**
 * The default resource atlas family — the shared `ls_trees.tree_yew01` layer drawn as the renderer's
 * {@link import('@vinland/render').SpriteSheet.kindLayers}'s `resource`. A good whose node record lives in
 * THIS family binds a bare bob id (no `families` entry); every other good binds a layer-qualified ref into
 * its own loaded `families` atlas.
 */
export const DEFAULT_RESOURCE_STEM = TREE_ATLAS;

/** The delivery-flag `[GfxLandscape]` record's `EditName` — the plain player-coloured "work extern" sign. */
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

/** A landscape gfx record → its {@link GatheringNodeRef} (served atlas stem + representative full-grown
 *  bob), or `undefined` when it names no drawable atlas/frame. The shared resolution behind the flag,
 *  stump and berry-bush draws. Pure. */
export function nodeRefFrom(record: LandscapeGfxRow): GatheringNodeRef | undefined {
  const stem = servedStem(record);
  const bob = nodeBob(record);
  return stem !== undefined && bob !== undefined ? { stem, bob } : undefined;
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
 * loaded/default decision is {@link import('./bindings.js').buildResourceBinding}/
 * {@link import('./bindings.js').buildStockpileBinding}'s. Pure.
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
  const flag = flagRecord !== undefined ? nodeRefFrom(flagRecord) : undefined;

  return { nodesByGood, nodesByGfxIndex, trunksByGood, pilesByGood, ...(flag !== undefined ? { flag } : {}) };
}

/**
 * The set of NON-default served atlas stems the gathering draws reference — every node stem that isn't the
 * default resource family, every pile stem, and the flag stem. This is exactly the atlases
 * {@link import('../sprite-sheet.js')} must load into `families` for the layer-qualified refs to draw;
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
export function bobRef(stem: string, bob: number): LayeredBobRef {
  return stem === DEFAULT_RESOURCE_STEM ? bob : { layer: stem, bob };
}
