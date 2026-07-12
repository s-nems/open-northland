/**
 * `[GfxHouse]` structural overlays keyed by building `typeId`: construction (build-material) costs, max
 * hitpoints, and ground footprints. All three read the graphics twin of the logic table and collapse
 * their genuinely multi-valued source to one flat value per typeId ({@link existingGfxHouseWins}).
 */
import type { BuildingFootprint, FootprintCell } from '@vinland/data';
import { findProps, getInt, type RuleSection } from '../grammar.js';
import { existingGfxHouseWins, logicTypeByLevel, splitGfxHouseRecords } from './shared.js';

/**
 * Extracts each building's **build-material cost** from the graphics table's `[GfxHouse]` records (the
 * readable `DataCnmd/budynki12/houses/houses.ini`), keyed by the building `typeId` for an overlay onto
 * the `[logichousetype]`-extracted {@link BuildingType}s ({@link import('../types/buildings.js').extractBuildings}
 * reads the *logic* table; the construction cost lives only in the *graphics* twin — a separate file the
 * pipeline did not read until now). A `[GfxHouse]` record is a render record carrying a few `Logic*` keys,
 * three of which matter here:
 *   - `LogicTribeType <id>` — the owning tribe. The cost is genuinely keyed by **(tribe, typeId)**: the
 *     same logic `typeId` (homes 2..6 are shared across civilizations) carries a DIFFERENT cost per
 *     tribe — viking/frank/byzantine model a home as an *upgrade chain* (level 4 = `27 27`, ornaments
 *     only), while egypt/saracen model the same typeId as a *standalone full build* (the cumulative
 *     list). To keep a single flat {@link BuildingType.construction} field we collapse to the
 *     **lowest-tribeType** record (the deterministic "reference tribe" convention `fillBuildingRecipes`
 *     already uses); the per-tribe divergence is recorded in source basis.
 *   - `LogicType <sizeIdx> <typeId>` — the building `typeId` at that size level (a home spans several:
 *     `home level 00..04` are five distinct typeIds, one per `sizeIdx`), joined to the cost by `sizeIdx`.
 *   - `LogicConstructionGoods <sizeIdx> <good> <good> …` — the goods to build that level, a flat id
 *     list where a **repeat encodes quantity** (`3 3 26` = 2× stone + pillar), exactly like
 *     `goodtypes.productionInputGoods`.
 * A level with a `LogicType` but no matching `LogicConstructionGoods` (the headquarters/wonder records)
 * is omitted — that building has no construction cost. Returns an empty map if the file carries no
 * `[GfxHouse]` records (e.g. the logic-only sources every other extractor reads).
 *
 * Two collisions are resolved DETERMINISTICALLY ({@link existingGfxHouseWins}): cross-tribe, the lowest
 * `LogicTribeType` wins; within a record a `typeId` mapped at several `sizeIdx` keeps the lowest
 * `sizeIdx` cost (the base build stage). Both collapses are recorded as approximations in source basis.
 */
export function extractConstructionCosts(
  sections: readonly RuleSection[],
): Map<number, { goodType: number; amount: number }[]> {
  // typeId -> the winning record, ranked by (tribeType asc, sizeIdx asc) so the lowest-tribe / lowest-
  // size cost deterministically wins regardless of file/parse order (see JSDoc collisions).
  const winner = new Map<
    number,
    { tribeType: number; sizeIdx: number; cost: { goodType: number; amount: number }[] }
  >();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    const tribeType = getInt(sec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY;
    // sizeIdx -> typeId. A typeId may appear at several sizeIdx; each (sizeIdx -> typeId) is kept so
    // the construction-goods loop below can pair each cost line to its level's typeId.
    const typeByLevel = logicTypeByLevel(sec);
    for (const p of findProps(sec, 'LogicConstructionGoods')) {
      const sizeIdx = Number.parseInt(p.values[0] ?? '', 10);
      if (Number.isNaN(sizeIdx)) continue;
      const typeId = typeByLevel.get(sizeIdx);
      if (typeId === undefined) continue;
      if (existingGfxHouseWins(winner.get(typeId), tribeType, sizeIdx)) continue;
      const counts = new Map<number, number>();
      for (const raw of p.values.slice(1)) {
        const id = Number.parseInt(raw, 10);
        if (Number.isNaN(id)) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      winner.set(typeId, {
        tribeType,
        sizeIdx,
        cost: [...counts].map(([goodType, amount]) => ({ goodType, amount })),
      });
    }
  }
  return new Map([...winner].map(([typeId, { cost }]) => [typeId, cost]));
}

/**
 * Extracts each building type's **max hitpoints** from the graphics table's `[GfxHouse]` records
 * (`DataCnmd/budynki12/houses/houses.ini`), keyed by `typeId` for the same overlay as
 * {@link extractConstructionCosts}. Each record carries a `logichitpoints <sizeIdx> <value>` line per
 * size level, joined to a `typeId` through the record's `LogicType <sizeIdx> <typeId>` table
 * ({@link logicTypeByLevel}) — so a home's level chain (typeIds 2..6) resolves each tier's own HP
 * (30000 / 40000 / 60000 / 70000 / 80000), a wall 100000, a small workplace ~25000. Collisions resolve
 * DETERMINISTICALLY exactly like the construction cost ({@link existingGfxHouseWins}). A level with a
 * `LogicType` but no `logichitpoints` is absent — that type carries no HP. Returns an empty map for a
 * source with no `[GfxHouse]` records.
 *
 * source-basis: the readable `logichitpoints` param (`houses.ini` `[GfxHouse]`) — faithful per-tier
 * HP; the single-value collapse across (tribe, sizeIdx) is the same named approximation the cost
 * overlay records.
 */
export function extractHouseHitpoints(sections: readonly RuleSection[]): Map<number, number> {
  // typeId -> the winning record, ranked by (tribeType asc, sizeIdx asc) so the choice is independent
  // of file/parse order (mirrors extractConstructionCosts' collision resolution).
  const winner = new Map<number, { tribeType: number; sizeIdx: number; hitpoints: number }>();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    const tribeType = getInt(sec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY;
    const typeByLevel = logicTypeByLevel(sec);
    for (const p of findProps(sec, 'logichitpoints')) {
      const sizeIdx = Number.parseInt(p.values[0] ?? '', 10);
      const hitpoints = Number.parseInt(p.values[1] ?? '', 10);
      if (Number.isNaN(sizeIdx) || Number.isNaN(hitpoints) || hitpoints <= 0) continue;
      const typeId = typeByLevel.get(sizeIdx);
      if (typeId === undefined) continue;
      if (existingGfxHouseWins(winner.get(typeId), tribeType, sizeIdx)) continue;
      winner.set(typeId, { tribeType, sizeIdx, hitpoints });
    }
  }
  return new Map([...winner].map(([typeId, { hitpoints }]) => [typeId, hitpoints]));
}

/**
 * Expands one footprint-area source line (`<x> <y> <run>` after any leading level index) into its
 * cells: `run` cells starting at `(x, y)`, extending along +x — the row encoding every
 * `Logic*BlockArea` key uses. Non-numeric / non-positive runs yield no cells (malformed line).
 */
function expandAreaRun(x: number, y: number, run: number): FootprintCell[] {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(run) || run <= 0) return [];
  const cells: FootprintCell[] = [];
  for (let i = 0; i < run; i++) cells.push({ dx: x + i, dy: y });
  return cells;
}

/** Canonical footprint-cell order (ascending y, then x) + exact-duplicate removal, so the emitted IR
 *  is byte-stable regardless of source line order. */
function canonicalCells(cells: Iterable<FootprintCell>): FootprintCell[] {
  const byKey = new Map<string, FootprintCell>();
  for (const c of cells) byKey.set(`${c.dx},${c.dy}`, c);
  return [...byKey.values()].sort((a, b) => a.dy - b.dy || a.dx - b.dx);
}

/**
 * Extracts each building type's **ground footprint** from the graphics table's `[GfxHouse]` records —
 * the collision/placement model the logic table never carried (the same graphics-table overlay as
 * {@link extractConstructionCosts}, keyed by the `LogicType <sizeIdx> <typeId>` join):
 *
 *   - `LogicWalkBlockArea <sizeIdx> <x> <y> <run>` — the cells the standing building at that size
 *     level makes unwalkable (its body) → `blocked` for that level's `typeId`.
 *   - `LogicBuildBlockArea <x> <y> <run>` — defined ONCE per record with **no level index**: the
 *     level-independent build-exclusion zone. Every level's typeId gets the same zone — which is
 *     exactly the original's "a level-0 hut reserves the space of its top level" behavior.
 *   - `LogicDoorPoint <sizeIdx> <x> <y>` — that level's entry cell → `door`.
 *
 * Emitted per typeId: `blocked` (this level), `familyBody` (the union of every level's `blocked` —
 * the largest body the upgrade chain reaches), and `reserved` (`familyBody` ∪ the build-exclusion
 * zone; the union matters because a few real records — walls' gate cells, two frank/byzantine houses
 * — have walk-block cells the build area does not cover). Cells are canonically ordered (ascending
 * y, then x) and de-duplicated so the IR is byte-stable.
 *
 * Collisions resolve exactly like {@link extractConstructionCosts} ({@link existingGfxHouseWins}):
 * cross-tribe the lowest `LogicTribeType` wins (footprints genuinely differ per tribe skin; source
 * basis); within a record the lowest `sizeIdx` wins for a typeId mapped at several sizes. Returns an
 * empty map for sources with no `[GfxHouse]` records.
 */
export function extractBuildingFootprints(sections: readonly RuleSection[]): Map<number, BuildingFootprint> {
  const winner = new Map<number, { tribeType: number; sizeIdx: number; footprint: BuildingFootprint }>();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const tribeType = getInt(rec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY;
      const typeByLevel = logicTypeByLevel(rec);
      if (typeByLevel.size === 0) continue;

      // The record-wide (level-independent) build-exclusion zone.
      const buildZone: FootprintCell[] = [];
      for (const p of findProps(rec, 'LogicBuildBlockArea')) {
        const [x, y, run] = p.values.map((v) => Number.parseInt(v, 10));
        buildZone.push(...expandAreaRun(x ?? Number.NaN, y ?? Number.NaN, run ?? Number.NaN));
      }
      // Per-level walk-block bodies + door points.
      const blockedByLevel = new Map<number, FootprintCell[]>();
      for (const p of findProps(rec, 'LogicWalkBlockArea')) {
        const [sizeIdx, x, y, run] = p.values.map((v) => Number.parseInt(v, 10));
        if (sizeIdx === undefined || Number.isNaN(sizeIdx)) continue;
        const cells = blockedByLevel.get(sizeIdx) ?? [];
        cells.push(...expandAreaRun(x ?? Number.NaN, y ?? Number.NaN, run ?? Number.NaN));
        blockedByLevel.set(sizeIdx, cells);
      }
      const doorByLevel = new Map<number, FootprintCell>();
      for (const p of findProps(rec, 'LogicDoorPoint')) {
        const [sizeIdx, x, y] = p.values.map((v) => Number.parseInt(v, 10));
        if (sizeIdx === undefined || Number.isNaN(sizeIdx)) continue;
        if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) continue;
        if (!doorByLevel.has(sizeIdx)) doorByLevel.set(sizeIdx, { dx: x, dy: y });
      }

      const familyBody = canonicalCells([...blockedByLevel.values()].flat());
      const reserved = canonicalCells([...familyBody, ...buildZone]);
      // A record with no collision CELLS at all (the vehicle/cart records; a record whose only area
      // lines are malformed) contributes nothing — an all-empty footprint would look footprinted yet
      // validate every placement. Gate on the expanded cells, not on the raw line/level count.
      if (reserved.length === 0) continue;

      for (const [sizeIdx, typeId] of typeByLevel) {
        if (existingGfxHouseWins(winner.get(typeId), tribeType, sizeIdx)) continue;
        winner.set(typeId, {
          tribeType,
          sizeIdx,
          footprint: {
            blocked: canonicalCells(blockedByLevel.get(sizeIdx) ?? []),
            familyBody,
            reserved,
            door: doorByLevel.get(sizeIdx),
          },
        });
      }
    }
  }
  return new Map([...winner].map(([typeId, { footprint }]) => [typeId, footprint]));
}
