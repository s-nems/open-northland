import {
  BUILDING_CATEGORIES,
  type BuildingAvailability,
  type BuildingCategory,
  type CostLine,
  categoryOfKind,
  type MenuBuildingEntry,
  OPEN_AVAILABILITY,
} from './building-menu.js';

/** An entry as the window lists it this tick. */
export interface CatalogueRow {
  readonly entry: MenuBuildingEntry;
  readonly category: BuildingCategory;
  readonly availability: BuildingAvailability;
}

export interface CataloguePartition {
  /** Buildable now, in catalogue order. */
  readonly open: readonly CatalogueRow[];
  /** Waiting on a discovery, listed after the open entries. */
  readonly locked: readonly CatalogueRow[];
}

/** Open entries first, locked after, both in catalogue order; a forbidden entry is dropped, as the
 *  original's selection window lists only what the map allows. */
export function partitionCatalogue(entries: readonly MenuBuildingEntry[]): CataloguePartition {
  const open: CatalogueRow[] = [];
  const locked: CatalogueRow[] = [];
  for (const entry of entries) {
    const availability = entry.availability?.() ?? OPEN_AVAILABILITY;
    const row = { entry, category: categoryOfKind(entry.kind), availability };
    if (availability.kind === 'open') open.push(row);
    else if (availability.kind === 'locked') locked.push(row);
  }
  return { open, locked };
}

/** A change key over every listed entry's availability, so the window re-sorts its cards only on a
 *  discovery or a script's permission change, never per frame. */
export function availabilityKey(partition: CataloguePartition): string {
  const ids = (rows: readonly CatalogueRow[]): string => rows.map((row) => row.entry.typeId).join(',');
  return `${ids(partition.open)}|${ids(partition.locked)}`;
}

/** How many buildable entries each tab shows; the all tab counts every one. */
export function tabCounts(open: readonly CatalogueRow[]): Readonly<Record<BuildingCategory, number>> {
  const counts = Object.fromEntries(BUILDING_CATEGORIES.map((tab) => [tab.id, 0])) as Record<
    BuildingCategory,
    number
  >;
  for (const row of open) {
    counts.all += 1;
    counts[row.category] += 1;
  }
  return counts;
}

export interface CostSlot extends CostLine {
  readonly have: number;
  /** The seat cannot cover this line from what it holds. Information only: placement never checks
   *  stock, in the original either, and the builders wait for the goods instead. */
  readonly short: boolean;
}

/** The bill against the stock on hand. */
export function costSlots(cost: readonly CostLine[], stockOf: (goodType: number) => number): CostSlot[] {
  return cost.map((line) => {
    const have = stockOf(line.goodType);
    return { goodType: line.goodType, amount: line.amount, have, short: have < line.amount };
  });
}
