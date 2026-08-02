import type { TerrainObjects } from '@open-northland/data';
import type { ContentIr, LandscapeGfxRow } from './ir/rows.js';
import { forEachPlacement } from './map-placements.js';

/**
 * The decoded-map → sim resource join: which placed landscape objects are harvestable, and the good each
 * yields. A decoded map ships its trees/ore/stone as pure render decor (`map.objects`, drawn by the static
 * map-object layer); this module is the reverse lookup that lets the `?map=` entry also spawn them as real
 * `Resource` sim nodes so a gatherer can actually work them. Without it a map's trees are drawn but carry
 * no `Resource`, so hovering shows nothing and gatherers idle - only an admin-spawned node (a real sim
 * entity) was ever harvestable.
 *
 * The join is data-driven off the real `ir.json`, not hardcoded: each good's gathering pipeline lists the
 * `landscapeGfx` indices of its standing harvest-stage forms (every tree variant for wood, every ore
 * outcrop for iron, …); inverting that index list → EditName → goodId names exactly the objects the
 * original treats as harvestable. Decor (grass, ferns, waves) appears in no harvest stage, so it is absent
 * from the map and never spawned. The pipeline's `goodId` string is the bridge across the two good-number
 * spaces - the IR's original numbering (`wood` = 5) and the app's hand-authored numbering (`GOOD_WOOD` = 1) -
 * so the caller resolves the returned id against `GATHERERS` by `id`.
 */

/** What one harvestable object `EditName` resolves to: the good it yields and its own harvest-stage
 *  `[GfxLandscape]` record index (the species variant - "pine 02", not the good's representative). */
export interface HarvestObjectRef {
  readonly goodId: string;
  readonly gfxIndex: number;
  /** The record's authored frame-list count, the denominator the static object layer buckets a
   *  placement's `objects.levels` entry against ({@link import('./objects.js').stateIndexForLevel}).
   *  NOT the record's valency ceiling: `LogicMaximumValency` can be larger (`tree_dead 01` authors one
   *  frame list for a max valency of 3), so a level above this count reads as out of range. 0 when the
   *  record authors no frames. */
  readonly states: number;
  /** The record's `LogicMaximumValency` - how many units a placement of it holds, which sizes a spawned
   *  mineral deposit ({@link import('../game/sandbox/map-spawn.js').spawnMapResources}). Absent on an
   *  older `ir.json` with no `maxValency` lane; the spawn then falls back to the catalog constant. */
  readonly maxValency?: number;
}

/**
 * Map each placed landscape-object `EditName` (e.g. `"yew 01"`, `"iron mine 03"`) to the `goodId` string it
 * yields when harvested and its own `[GfxLandscape]` record index, from the IR gathering pipeline's harvest
 * stage. Pure - one pass over the pipeline and the `landscapeGfx` index↔name table. An object in no harvest
 * stage is absent (a decor object stays decor). Degrades to an empty map when either lane is missing (an
 * older `ir.json`). The `gfxIndex` rides the spawn onto `Resource.gfxIndex` - an opaque render-variant tag
 * (app numbering) the snapshot carries into `DrawItem.gfxIndex`, so a pool-drawn node keeps its exact
 * original graphic instead of collapsing to one species per good. It never reaches the sim's footprint
 * resolution: collision stays the good's own record in the sim's content set (an unrelated number space).
 */
export function harvestGoodByObjectName(ir: ContentIr): ReadonlyMap<string, HarvestObjectRef> {
  const recordByIndex = new Map<number, LandscapeGfxRow>();
  for (const g of ir.landscapeGfx ?? []) {
    if (g.editName !== undefined) recordByIndex.set(g.index, g);
  }
  const out = new Map<string, HarvestObjectRef>();
  for (const p of ir.gatheringPipeline ?? []) {
    for (const idx of p.harvest?.gfxIndices ?? []) {
      const record = recordByIndex.get(idx);
      if (record?.editName === undefined) continue;
      out.set(record.editName, {
        goodId: p.goodId,
        gfxIndex: idx,
        states: (record.frames ?? []).length,
        // A 0 capacity would size an empty deposit, so it reads as absent and the spawn falls back.
        ...(record.maxValency !== undefined && record.maxValency > 0
          ? { maxValency: record.maxValency }
          : {}),
      });
    }
  }
  return out;
}

/** One harvestable node a decoded map defines: the `goodId` it yields, its variant `gfxIndex`, at a
 *  half-cell anchor `(hx, hy)` (the `map.objects` lattice is the sim's 2W×2H node grid verbatim - the
 *  same lane `collision.ts` reads). `placement` is the placement ordinal (triplet index) in
 *  `objects.placements` - the join key back to the static layer's drawn sprite for the same placement
 *  (the `?map=` entry's static→dynamic handover). */
export interface MapResourceSpawn {
  readonly goodId: string;
  readonly gfxIndex: number;
  readonly hx: number;
  readonly hy: number;
  readonly placement: number;
  /**
   * The placement's authored growth state: its 1-based `objects.levels` (`lmlv`) entry and the record's
   * state count it counts up to (`level === states` is full-grown / a full deposit). Absent for a map
   * with no `levels` lane and for an out-of-range entry, matching the fall-back-to-full rule of the
   * static object layer's {@link import('./objects.js').stateIndexForLevel}.
   */
  readonly growth?: { readonly level: number; readonly states: number };
  /** The source record's {@link HarvestObjectRef.maxValency} - the units a full placement of it holds. */
  readonly maxValency?: number;
}

/**
 * The harvestable resource nodes a decoded map's placed objects define - each placement whose EditName maps
 * to a good with a real gatherer trade (`spawnableGoodIds`, the `GATHERERS` ids). Pure and deterministic:
 * one pass over `map.objects.placements` in its native row-major order, so the caller creates entities (and
 * mints ids) in a fixed order. A good that maps but has no gatherer trade yet (e.g. `wheat`, `leather`) is
 * left out so it stays decor rather than spawning an unworkable node.
 */
export function mapResourceSpawns(
  objects: TerrainObjects,
  ir: ContentIr,
  spawnableGoodIds: ReadonlySet<string>,
): MapResourceSpawn[] {
  const goodByName = harvestGoodByObjectName(ir);
  const { types, placements } = objects;
  const out: MapResourceSpawn[] = [];
  forEachPlacement(placements, (hx, hy, typeIndex, placement) => {
    const name = types[typeIndex];
    const ref = name !== undefined ? goodByName.get(name) : undefined;
    if (ref === undefined || !spawnableGoodIds.has(ref.goodId)) return;
    const level = objects.levels?.[placement];
    const growth =
      level !== undefined && level >= 1 && level <= ref.states ? { level, states: ref.states } : undefined;
    out.push({
      goodId: ref.goodId,
      gfxIndex: ref.gfxIndex,
      hx,
      hy,
      placement,
      ...(growth !== undefined ? { growth } : {}),
      ...(ref.maxValency !== undefined ? { maxValency: ref.maxValency } : {}),
    });
  });
  return out;
}

/**
 * The `[GfxLandscape].logicType` of a fruited bush (`bush with fruits`, `landscapetypes.ini` type 11) -
 * the source-pinned marker that a placed bush object currently holds fruit, so it becomes a forageable
 * {@link import('@open-northland/sim').BerryBush}. Bare/flowering/barren bush states (types 8/9/10) stay decor.
 * Exported as the single home for this constant - the render-side bush binding ({@link
 * import('./resource-gfx/index.js').resolveBerryBushRefs}) keys off the same value.
 */
export const BUSH_WITH_FRUITS_LOGIC_TYPE = 11;

/** One berry bush a decoded map defines: its render-variant `gfxIndex` (the fruited-bush record index) at
 *  a half-cell anchor `(hx, hy)`, and the placement ordinal (the static-layer handover join key). */
export interface MapBerryBushSpawn {
  readonly gfxIndex: number;
  readonly hx: number;
  readonly hy: number;
  readonly placement: number;
}

/** The fruited-bush object `EditName`s the map defines - every `landscapeGfx` record whose `logicType` is
 *  {@link BUSH_WITH_FRUITS_LOGIC_TYPE} (e.g. "bush 01 fruits", "bush snow 02 fruits"), keyed to its record
 *  index (the render-variant `gfxIndex`). Degrades to empty on an older `ir.json` with no `landscapeGfx`. */
function fruitedBushRecordByName(ir: ContentIr): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const g of ir.landscapeGfx ?? []) {
    if (g.editName !== undefined && g.logicType === BUSH_WITH_FRUITS_LOGIC_TYPE) out.set(g.editName, g.index);
  }
  return out;
}

/**
 * The forageable berry bushes a decoded map's placed objects define - each placement of a fruited-bush
 * object (`landscapeGfx.logicType === bush with fruits`). Pure and deterministic: one pass over
 * `map.objects.placements` in native row-major order, so the caller mints entity ids in a fixed order.
 * Bare/flowering bush placements are left out (they stay static decor rather than spawning ripe food).
 */
export function mapBerryBushSpawns(objects: TerrainObjects, ir: ContentIr): MapBerryBushSpawn[] {
  const byName = fruitedBushRecordByName(ir);
  const { types, placements } = objects;
  const out: MapBerryBushSpawn[] = [];
  forEachPlacement(placements, (hx, hy, typeIndex, placement) => {
    const name = types[typeIndex];
    const gfxIndex = name !== undefined ? byName.get(name) : undefined;
    if (gfxIndex !== undefined) out.push({ gfxIndex, hx, hy, placement });
  });
  return out;
}

/**
 * The object `EditName`s whose placements become sim `Resource` entities (their good has a gatherer
 * trade) - exactly the set {@link mapResourceSpawns} spawns. The static collision join must skip these
 * (`buildCollisionTerrain skipObjectNames`): their blocking lives in the sim's dynamic
 * resource-footprint overlay, stamped at spawn and unstamped when the node is felled/depleted. Pure.
 */
export function simResourceObjectNames(ir: ContentIr, spawnableGoodIds: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const [name, ref] of harvestGoodByObjectName(ir)) {
    if (spawnableGoodIds.has(ref.goodId)) out.add(name);
  }
  return out;
}
