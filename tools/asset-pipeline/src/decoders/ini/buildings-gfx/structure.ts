/**
 * `[GfxHouse]` structural overlays keyed by building `typeId`, read from the mod's readable
 * `DataCnmd/budynki12/houses/houses.ini`. Each collapses a source that is genuinely multi-valued (per
 * tribe, per size level) to one flat value per typeId.
 */
import type { BuildingFootprint, FootprintCell } from '@open-northland/data';
import { findProps, getInt, type RuleSection, tallyIds } from '../grammar.js';
import { existingGfxHouseWins, logicTypeByLevel, splitGfxHouseRecords } from './shared.js';

/**
 * Shared skeleton for the per-typeId overlays that collapse to a single flat value: pair each `key` line
 * to its level's `typeId` through the record's own `LogicType <sizeIdx> <typeId>` table, then keep the
 * deterministic winner. `readValue` returns `undefined` to reject a line, which then never mutates the
 * map.
 */
function collectGfxHouseWinner<T>(
  sections: readonly RuleSection[],
  key: string,
  readValue: (values: readonly string[]) => T | undefined,
): Map<number, T> {
  const winner = new Map<number, { tribeType: number; sizeIdx: number; value: T }>();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const tribeType = getInt(rec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY;
      const typeByLevel = logicTypeByLevel(rec);
      for (const p of findProps(rec, key)) {
        const sizeIdx = Number.parseInt(p.values[0] ?? '', 10);
        if (Number.isNaN(sizeIdx)) continue;
        const typeId = typeByLevel.get(sizeIdx);
        if (typeId === undefined) continue;
        if (existingGfxHouseWins(winner.get(typeId), tribeType, sizeIdx)) continue;
        const value = readValue(p.values);
        if (value === undefined) continue;
        winner.set(typeId, { tribeType, sizeIdx, value });
      }
    }
  }
  return new Map([...winner].map(([typeId, { value }]) => [typeId, value]));
}

/**
 * Extracts each building's build-material cost, `LogicConstructionGoods <sizeIdx> <good> <good> …`: a
 * flat id list where a repeat encodes quantity (`3 3 26` = 2× stone + pillar), like
 * `goodtypes.productionInputGoods`.
 *
 * The cost is genuinely keyed by `(tribe, typeId)` - viking/frank/byzantine model a home as an upgrade
 * chain, egypt/saracen model the same typeId as a standalone full build - so collapsing to one record
 * per typeId is an approximation.
 */
export function extractConstructionCosts(
  sections: readonly RuleSection[],
): Map<number, { goodType: number; amount: number }[]> {
  // Never rejects a line: an empty goods list is a valid zero cost.
  return collectGfxHouseWinner(sections, 'LogicConstructionGoods', (values) => {
    const ids = values
      .slice(1)
      .map((v) => Number.parseInt(v, 10))
      .filter((n) => !Number.isNaN(n));
    return tallyIds(ids);
  });
}

/**
 * Extracts each building type's max hitpoints, `logichitpoints <sizeIdx> <value>`, joined to a `typeId`
 * through the record's `LogicType <sizeIdx> <typeId>` table.
 */
export function extractHouseHitpoints(sections: readonly RuleSection[]): Map<number, number> {
  // Reject a non-positive/malformed HP so it never wins a typeId.
  return collectGfxHouseWinner(sections, 'logichitpoints', (values) => {
    const hitpoints = Number.parseInt(values[1] ?? '', 10);
    return Number.isNaN(hitpoints) || hitpoints <= 0 ? undefined : hitpoints;
  });
}

/**
 * Extracts each building type's upgrade target from the record's `LogicType <sizeIdx> <typeId>` table:
 * the type at `sizeIdx` upgrades into the type at `sizeIdx + 1`.
 */
export function extractUpgradeTargets(sections: readonly RuleSection[]): Map<number, number> {
  const winner = new Map<number, { tribeType: number; sizeIdx: number; value: number }>();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const tribeType = getInt(rec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY;
      const typeByLevel = logicTypeByLevel(rec);
      for (const [sizeIdx, typeId] of typeByLevel) {
        const target = typeByLevel.get(sizeIdx + 1);
        if (target === undefined || target === typeId) continue; // top level, or a degenerate self-link
        if (existingGfxHouseWins(winner.get(typeId), tribeType, sizeIdx)) continue;
        winner.set(typeId, { tribeType, sizeIdx, value: target });
      }
    }
  }
  return new Map([...winner].map(([typeId, { value }]) => [typeId, value]));
}

/**
 * Expands one footprint-area line (`<x> <y> <run>` after any leading level index) into `run` cells from
 * `(x, y)` along +x, the row encoding every `Logic*BlockArea` key uses.
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
 * Extracts each building type's ground footprint from three key families joined by the record's
 * `LogicType <sizeIdx> <typeId>` table: `LogicWalkBlockArea <sizeIdx> <x> <y> <run>`,
 * `LogicDoorPoint <sizeIdx> <x> <y>`, and `LogicBuildBlockArea <x> <y> <run>`, which is defined once per
 * record with no level index, so every level's typeId gets the same build-exclusion zone.
 *
 * Footprints genuinely differ per tribe skin, so the cross-tribe collapse is an approximation.
 */
export function extractBuildingFootprints(sections: readonly RuleSection[]): Map<number, BuildingFootprint> {
  const winner = new Map<number, { tribeType: number; sizeIdx: number; footprint: BuildingFootprint }>();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const tribeType = getInt(rec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY;
      const typeByLevel = logicTypeByLevel(rec);
      if (typeByLevel.size === 0) continue;

      const buildZone: FootprintCell[] = [];
      for (const p of findProps(rec, 'LogicBuildBlockArea')) {
        const [x, y, run] = p.values.map((v) => Number.parseInt(v, 10));
        buildZone.push(...expandAreaRun(x ?? Number.NaN, y ?? Number.NaN, run ?? Number.NaN));
      }
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
      // An all-empty footprint would look footprinted yet validate every placement, so gate on the
      // expanded cells rather than on the raw line or level count.
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
