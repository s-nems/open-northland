import type { PanelBar } from './bars.js';
import type { ConstructionModel, StockRow, UpgradeCostRow } from './building-materials.js';
import type { ProductionModel } from './building-production.js';
import type { WorkerSlotRow } from './building-workers.js';

// The pure building half of the details-panel model, composed from the goods (Magazyn + construction),
// worker-slot, and Produkcja parts. The orchestrator in `index.ts` assembles a BuildingPanelModel here.
export * from './building-materials.js';
export * from './building-production.js';
export * from './building-workers.js';

/** The residents view of a `home`-kind building: its families (each a member id list, drawn grouped in
 *  the field) and the family-slot capacity (`logichomesize`) for the "Rodziny 1/3" line. */
export interface HomeResidentsModel {
  /** One entry per resident family, in ascending head-id order; members ids, adults before the child. */
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
  /** The general section's health gauge, for every building state. Null only for a type declaring no
   *  hitpoints (`work_murek`), whose slot under the name then stays empty. */
  readonly health: PanelBar | null;
  readonly stock: readonly StockRow[];
  /** One row per worker slot (trade), each with its filled/capacity - the per-trade limits the panel
   *  lists. See {@link workerSlotsFor}. */
  readonly workerSlots: readonly WorkerSlotRow[];
  /** Non-null for a `home`-kind building: the workers window becomes the residents window
   *  ("Mieszkańcy" + "Rodziny 1/3" + the family-grouped sprite field). */
  readonly home: HomeResidentsModel | null;
  readonly showDefense: boolean;
  /** Approximation until a real building-defense mode component exists. */
  readonly defenseLabel: string;
  readonly production: ProductionModel | null;
  /** Non-null while the building is a construction site - the panel then swaps its production/stock/
   *  workers windows for the one Construction window (those sections mean nothing before completion). */
  readonly construction: ConstructionModel | null;
  /** Whether the general section offers the Upgrade button (housewindow 110): a BUILT building whose
   *  type has an `upgradeTarget` level to rise into. False while it is a site. */
  readonly upgradable: boolean;
  /** Whether the general section offers the Cancel-upgrade button (housewindow 112): a running
   *  upgrade site (`Upgrading`) - aborting restores the previous level, delivered materials lost. */
  readonly cancelable: boolean;
  /** The upgrade target tier's material cost - the level-difference bill the sim charges to raise this
   *  building (its target's own `construction`, mirroring {@link constructionModel}'s upgrading branch).
   *  Empty unless {@link upgradable}; surfaced by the Upgrade button's hover tooltip. */
  readonly upgradeCost: readonly UpgradeCostRow[];
}
