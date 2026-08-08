import type { TerrainObjects } from '@open-northland/data';
import type { ContentIr, LandscapeGfxRow } from './ir/rows.js';
import { forEachPlacement } from './map-placements.js';

/**
 * The decoded-map → sim resource join: which placed landscape objects are harvestable, and the good each
 * yields. Each good's gathering pipeline lists the `landscapeGfx` indices of its standing harvest-stage
 * forms, so inverting that list (index → EditName → goodId) names the objects the original treats as
 * harvestable, and decor is absent by construction. The pipeline's `goodId` string bridges the IR's
 * original good numbering and the app's hand-authored one.
 */

/** What one harvestable object `EditName` resolves to: the good it yields and its own harvest-stage
 *  `[GfxLandscape]` record index (the species variant, not the good's representative). */
export interface HarvestObjectRef {
  readonly goodId: string;
  readonly gfxIndex: number;
  /** The record's authored frame-list count, the denominator a placement's `objects.levels` entry is read
   *  against, not the record's valency ceiling: `LogicMaximumValency` can be larger, so a level above this
   *  count reads as out of range. 0 when the record authors no frames. */
  readonly states: number;
  /** The record's `LogicMaximumValency`: how many units a placement of it holds, which sizes a spawned
   *  mineral deposit. Absent on an older `ir.json`, and the spawn falls back to the catalog constant. */
  readonly maxValency?: number;
}

/**
 * Map each placed landscape-object `EditName` to the `goodId` it yields and its own `[GfxLandscape]`
 * record index, from the IR gathering pipeline's harvest stage. Degrades to an empty map when either lane
 * is missing. The `gfxIndex` rides the spawn onto `Resource.gfxIndex`, an opaque render-variant tag that
 * keeps a pool-drawn node on its exact original graphic.
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

/** One harvestable node a decoded map defines, anchored at half-cell `(hx, hy)`: the `map.objects` lattice
 *  is the sim's 2W×2H node grid verbatim. `placement` is its ordinal in `objects.placements`. */
export interface MapResourceSpawn {
  readonly goodId: string;
  readonly gfxIndex: number;
  readonly hx: number;
  readonly hy: number;
  readonly placement: number;
  /**
   * The placement's authored growth state: its 1-based `objects.levels` (`lmlv`) entry and the record's
   * state count it counts up to (`level === states` is full-grown). Absent for a map with no `levels`
   * lane and for an out-of-range entry.
   */
  readonly growth?: { readonly level: number; readonly states: number };
  /** The units a full placement of the source record holds. */
  readonly maxValency?: number;
}

/**
 * The harvestable resource nodes a decoded map's placed objects define, for every placement whose EditName
 * maps to a good with a real gatherer trade; a good without one stays decor rather than spawning an
 * unworkable node. Deterministic: one pass over `map.objects.placements` in its native row-major order, so
 * the caller mints entity ids in a fixed order.
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
 * The `[GfxLandscape].logicType` of a fruited bush (`bush with fruits`, `landscapetypes.ini` type 11): the
 * source-pinned marker that a placed bush object currently holds fruit. The `bush`, `bush naked` and
 * `bush flowering` states (types 8/9/10) stay decor.
 */
export const BUSH_WITH_FRUITS_LOGIC_TYPE = 11;

/** One berry bush a decoded map defines: its fruited-bush record index at half-cell `(hx, hy)`, plus the
 *  placement ordinal. */
export interface MapBerryBushSpawn {
  readonly gfxIndex: number;
  readonly hx: number;
  readonly hy: number;
  readonly placement: number;
}

/** Every `landscapeGfx` record whose `logicType` is {@link BUSH_WITH_FRUITS_LOGIC_TYPE}, keyed by
 *  `EditName` to its record index. Degrades to empty on an older `ir.json` with no `landscapeGfx`. */
function fruitedBushRecordByName(ir: ContentIr): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const g of ir.landscapeGfx ?? []) {
    if (g.editName !== undefined && g.logicType === BUSH_WITH_FRUITS_LOGIC_TYPE) out.set(g.editName, g.index);
  }
  return out;
}

/**
 * The forageable berry bushes a decoded map's placed objects define. Deterministic: one pass over
 * `map.objects.placements` in native row-major order, so the caller mints entity ids in a fixed order.
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
 * The object `EditName`s whose placements become sim `Resource` entities. The static collision join must
 * skip these: their blocking lives in the sim's dynamic resource-footprint overlay, stamped at spawn and
 * unstamped when the node is felled or depleted.
 */
export function simResourceObjectNames(ir: ContentIr, spawnableGoodIds: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const [name, ref] of harvestGoodByObjectName(ir)) {
    if (spawnableGoodIds.has(ref.goodId)) out.add(name);
  }
  return out;
}
