import type { PanelBar } from './bars.js';
import type { ConstructionModel, StockRow, UpgradeCostRow } from './building-materials.js';
import type { ProductionModel } from './building-production.js';
import type { WorkerSlotRow } from './building-workers.js';

export * from './building-materials.js';
export * from './building-production.js';
export * from './building-workers.js';

/** Residents of a `home`-kind building: its families and the family-slot capacity (`logichomesize`). */
export interface HomeResidentsModel {
  /** One entry per resident family in ascending head-id order; members list adults before the child. */
  readonly families: readonly { readonly members: readonly number[] }[];
  /** Family slots this home tier offers (`homeSize`). */
  readonly capacity: number;
}

export interface BuildingPanelModel {
  readonly kind: 'building';
  readonly entityId: number;
  readonly typeId: number;
  readonly title: string;
  readonly category: string;
  readonly owner: string;
  readonly tribe: string;
  readonly level: number;
  readonly builtPct: number;
  /** Null for a type declaring no hitpoints (`work_murek`); the slot under the name then stays empty. */
  readonly health: PanelBar | null;
  readonly stock: readonly StockRow[];
  readonly workerSlots: readonly WorkerSlotRow[];
  /** Non-null for a `home`-kind building: the workers window becomes the residents window. */
  readonly home: HomeResidentsModel | null;
  /** Whether the type offers the Obrona window, that is whether content gives it a `shelterCapacity`. */
  readonly showDefense: boolean;
  /** Whether the alarm is currently up (the sim's `DefenceMode` marker). */
  readonly defenseEnabled: boolean;
  /** Non-null while civilians hold a seat: the workers window becomes the garrison window. */
  readonly garrison: { readonly sheltered: number; readonly capacity: number } | null;
  readonly defenseLabel: string;
  readonly production: ProductionModel | null;
  /** Non-null while the building is a site: the panel swaps its production, stock, and workers windows
   *  for the one Construction window. */
  readonly construction: ConstructionModel | null;
  /** Whether the general section offers the Upgrade button (`housewindow` 110). */
  readonly upgradable: boolean;
  /** Whether the general section offers the Cancel-upgrade button (`housewindow` 112); aborting
   *  restores the previous level and loses the delivered materials. */
  readonly cancelable: boolean;
  /** Material cost of the upgrade target tier; empty unless `upgradable`. */
  readonly upgradeCost: readonly UpgradeCostRow[];
}
