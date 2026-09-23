import type { TerrainObjects } from '@open-northland/data';
import { CHEST_KINDS, CHEST_LANDSCAPE_SLUG, type ChestKind } from '@open-northland/sim';
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

/** A placed growing field's valency is its current stage, not a stored good amount. */
export interface MapFieldSpawn {
  readonly goodId: string;
  readonly gfxIndex: number;
  readonly hx: number;
  readonly hy: number;
  readonly stage: number;
  readonly placement: number;
}

export function mapFieldSpawns(
  objects: TerrainObjects,
  ir: ContentIr,
  farmedGoodIds: ReadonlySet<string>,
): MapFieldSpawn[] {
  const byIndex = new Map((ir.landscapeGfx ?? []).map((row) => [row.index, row]));
  const byName = new Map<string, { goodId: string; gfxIndex: number; stages: number }>();
  for (const good of ir.gatheringPipeline ?? []) {
    if (!farmedGoodIds.has(good.goodId)) continue;
    for (const index of good.harvest?.gfxIndices ?? []) {
      const row = byIndex.get(index);
      if (row?.editName !== undefined && row.frames !== undefined) {
        byName.set(row.editName, { goodId: good.goodId, gfxIndex: index, stages: row.frames.length });
      }
    }
  }
  const out: MapFieldSpawn[] = [];
  forEachPlacement(objects.placements, (hx, hy, typeIndex, placement) => {
    const name = objects.types[typeIndex];
    const field = name === undefined ? undefined : byName.get(name);
    const stage = objects.levels?.[placement];
    if (field === undefined || stage === undefined || stage < 1 || stage > field.stages) return;
    out.push({ goodId: field.goodId, gfxIndex: field.gfxIndex, hx, hy, stage, placement });
  });
  return out;
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

/** The chest kind of each `[GfxLandscape].logicType`, through the landscape slugs the sim names the two
 *  chest kinds by. Degrades to empty on an `ir.json` without the landscape table. */
export function chestKindByLogicType(ir: ContentIr): ReadonlyMap<number, ChestKind> {
  const out = new Map<number, ChestKind>();
  for (const row of ir.landscape ?? []) {
    if (row.typeId === undefined) continue;
    for (const kind of CHEST_KINDS) {
      if (row.id === CHEST_LANDSCAPE_SLUG[kind]) out.set(row.typeId, kind);
    }
  }
  return out;
}

/** One chest a decoded map defines: its record index and kind at half-cell `(hx, hy)`, the chest type its
 *  `objects.levels` (`lmlv`) entry authors, plus the placement ordinal. */
export interface MapChestSpawn {
  readonly kind: ChestKind;
  readonly gfxIndex: number;
  readonly hx: number;
  readonly hy: number;
  readonly contents: number;
  readonly placement: number;
}

/** Every chest `landscapeGfx` record keyed by `EditName`. Degrades to empty on an `ir.json` with none. */
function chestRecordByName(ir: ContentIr): ReadonlyMap<string, { kind: ChestKind; gfxIndex: number }> {
  const kindByLogicType = chestKindByLogicType(ir);
  const out = new Map<string, { kind: ChestKind; gfxIndex: number }>();
  for (const g of ir.landscapeGfx ?? []) {
    const kind = kindByLogicType.get(g.logicType);
    if (g.editName !== undefined && kind !== undefined) out.set(g.editName, { kind, gfxIndex: g.index });
  }
  return out;
}

/**
 * The closed chests a decoded map's placed objects define. A placement with no `levels` entry authors an
 * empty chest (type 0, which the contents table does not know). Deterministic: one pass over
 * `map.objects.placements` in native row-major order, so the caller mints entity ids in a fixed order.
 */
export function mapChestSpawns(objects: TerrainObjects, ir: ContentIr): MapChestSpawn[] {
  const byName = chestRecordByName(ir);
  const { types, placements } = objects;
  const out: MapChestSpawn[] = [];
  forEachPlacement(placements, (hx, hy, typeIndex, placement) => {
    const name = types[typeIndex];
    const record = name !== undefined ? byName.get(name) : undefined;
    if (record === undefined) return;
    out.push({ ...record, hx, hy, contents: objects.levels?.[placement] ?? 0, placement });
  });
  return out;
}

/**
 * The `goodId` each ground-goods object `EditName` lays down, through the good's `landscapeType` and the
 * `landscapeGfx` records of that logic type. Source basis: in the original a good on the ground is a
 * landscape object of the good's own `landscapetype`, the form the map editor places and a settler's
 * drop leaves. Goods naming the void type (livestock, vehicles, the chest) never lie on the ground and
 * are skipped, so every decor object of the void type stays decor. Degrades to empty on an older
 * `ir.json` without the goods' `landscapeType`.
 */
export function groundGoodByObjectName(ir: ContentIr): ReadonlyMap<string, string> {
  const voidTypes = new Set<number>();
  for (const row of ir.landscape ?? []) {
    if (row.typeId !== undefined && row.allowedOnEverything === true) voidTypes.add(row.typeId);
  }
  const goodByLogicType = new Map<number, string>();
  for (const good of ir.goods ?? []) {
    if (good.landscapeType === undefined || voidTypes.has(good.landscapeType)) continue;
    if (!goodByLogicType.has(good.landscapeType)) goodByLogicType.set(good.landscapeType, good.id);
  }
  const out = new Map<string, string>();
  for (const g of ir.landscapeGfx ?? []) {
    const goodId = goodByLogicType.get(g.logicType);
    if (g.editName !== undefined && goodId !== undefined) out.set(g.editName, goodId);
  }
  return out;
}

/** One ground heap a decoded map defines: the good and its unit count at half-cell `(hx, hy)`, plus the
 *  placement ordinal. */
export interface MapGroundGoodsSpawn {
  readonly goodId: string;
  readonly hx: number;
  readonly hy: number;
  /** The placement's `objects.levels` (`lmlv`) entry, the pile's unit count; a map without the lane lays
   *  single units. */
  readonly amount: number;
  readonly placement: number;
}

/**
 * The ground heaps a decoded map's placed goods objects define. Deterministic: one pass over
 * `map.objects.placements` in native row-major order, so the caller mints entity ids in a fixed order.
 */
export function mapGroundGoodsSpawns(objects: TerrainObjects, ir: ContentIr): MapGroundGoodsSpawn[] {
  const byName = groundGoodByObjectName(ir);
  const { types, placements } = objects;
  const out: MapGroundGoodsSpawn[] = [];
  forEachPlacement(placements, (hx, hy, typeIndex, placement) => {
    const name = types[typeIndex];
    const goodId = name !== undefined ? byName.get(name) : undefined;
    if (goodId === undefined) return;
    out.push({ goodId, hx, hy, amount: objects.levels?.[placement] ?? 1, placement });
  });
  return out;
}

/**
 * The object `EditName`s whose placements become sim entities carrying their own footprint - resource
 * nodes and chests. The static collision join must skip these: their blocking lives in the sim's dynamic
 * resource-footprint overlay, stamped at spawn and unstamped when the node is felled, depleted or opened.
 */
export function simResourceObjectNames(ir: ContentIr, spawnableGoodIds: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const [name, ref] of harvestGoodByObjectName(ir)) {
    if (spawnableGoodIds.has(ref.goodId)) out.add(name);
  }
  for (const name of chestRecordByName(ir).keys()) out.add(name);
  return out;
}
