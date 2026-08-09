/**
 * `[GfxHouse]` structural overlays keyed by building `typeId`, read from the mod's readable
 * `DataCnmd/budynki12/houses/houses.ini`. Each collapses a source that is genuinely multi-valued (per
 * tribe, per size level) to one flat value per typeId.
 */
import type { BuildingFootprint, FootprintCell } from '@open-northland/data';
import type { RuleSection } from '../grammar.js';
import { tallyIds } from '../ir-fields.js';
import { findProps } from '../props.js';
import { gfxHouseLogicRecords } from './shared.js';

/**
 * The one value each contested building `typeId` collapses to: the lowest `LogicTribeType` (the
 * reference-tribe convention) and, within a tribe, the lowest `sizeIdx` (the base build stage), so the
 * result is independent of file order. `read` runs only for a candidate that outranks the standing
 * winner, and a rejected candidate leaves that winner in place.
 */
class GfxHouseWinners<T> {
  private readonly byTypeId = new Map<
    number,
    { readonly tribeType: number; readonly sizeIdx: number; readonly value: T }
  >();

  offer(typeId: number, tribeType: number, sizeIdx: number, read: () => T | undefined): void {
    const standing = this.byTypeId.get(typeId);
    if (
      standing !== undefined &&
      (standing.tribeType < tribeType || (standing.tribeType === tribeType && standing.sizeIdx <= sizeIdx))
    ) {
      return;
    }
    const value = read();
    if (value === undefined) return;
    this.byTypeId.set(typeId, { tribeType, sizeIdx, value });
  }

  collapse(): Map<number, T> {
    return new Map([...this.byTypeId].map(([typeId, { value }]) => [typeId, value]));
  }
}

/**
 * Pairs each `key` line to its level's `typeId` through the record's own `LogicType <sizeIdx> <typeId>`
 * table, for the per-typeId overlays that collapse to a single flat value.
 */
function collectGfxHouseWinner<T>(
  sections: readonly RuleSection[],
  key: string,
  readValue: (values: readonly string[]) => T | undefined,
): Map<number, T> {
  const winners = new GfxHouseWinners<T>();
  for (const { rec, tribeType, typeByLevel } of gfxHouseLogicRecords(sections)) {
    for (const p of findProps(rec, key)) {
      const sizeIdx = Number.parseInt(p.values[0] ?? '', 10);
      if (Number.isNaN(sizeIdx)) continue;
      const typeId = typeByLevel.get(sizeIdx);
      if (typeId === undefined) continue;
      winners.offer(typeId, tribeType, sizeIdx, () => readValue(p.values));
    }
  }
  return winners.collapse();
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
  const winners = new GfxHouseWinners<number>();
  for (const { tribeType, typeByLevel } of gfxHouseLogicRecords(sections)) {
    for (const [sizeIdx, typeId] of typeByLevel) {
      const target = typeByLevel.get(sizeIdx + 1);
      if (target === undefined || target === typeId) continue; // top level, or a degenerate self-link
      winners.offer(typeId, tribeType, sizeIdx, () => target);
    }
  }
  return winners.collapse();
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
  const winners = new GfxHouseWinners<BuildingFootprint>();
  for (const { rec, tribeType, typeByLevel } of gfxHouseLogicRecords(sections)) {
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
      winners.offer(typeId, tribeType, sizeIdx, () => ({
        blocked: canonicalCells(blockedByLevel.get(sizeIdx) ?? []),
        familyBody,
        reserved,
        door: doorByLevel.get(sizeIdx),
      }));
    }
  }
  return winners.collapse();
}
