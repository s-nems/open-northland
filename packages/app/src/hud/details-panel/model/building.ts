import type { PanelBar } from './bars.js';
import type { ConstructionModel, StockRow, UpgradeCostRow } from './building-materials.js';
import type { ProductionModel } from './building-production.js';
import type { WorkerSlotRow } from './building-workers.js';

export * from './building-materials.js';
export * from './building-production.js';
export * from './building-workers.js';

export interface HomeResidentsModel {
  /** One entry per resident family; a family's members list its adults before the child. */
  readonly families: readonly { readonly members: readonly number[] }[];
  /** Family slots this home tier offers (`homeSize`). */
  readonly capacity: number;
}

export interface HomeQualityRow {
  readonly effect: 'cooking' | 'rest' | 'piety';
  readonly goodId: string;
  readonly label: string;
  readonly value: number;
  readonly capacity: number;
  readonly allowed: boolean;
  /** Remaining household actions; omitted for holy oil, whose pool drains continuously. */
  readonly uses?: number;
  /** Only the holy-oil row carries this live finished-home status. */
  readonly holyFireActive?: boolean;
}

export interface BuildingPanelModel {
  readonly kind: 'building';
  readonly entityId: number;
  readonly typeId: number;
  readonly title: string;
  readonly category: string;
  readonly owner: string;
  /** The building's civilization, named for the player. */
  readonly tribe: string;
  /** The same civilization as the `Building.tribe` code, the per-tribe art join key. */
  readonly tribeId: number | undefined;
  readonly level: number;
  readonly builtPct: number;
  /** Null for a type declaring no hitpoints (`work_murek`); the slot under the name then stays empty. */
  readonly health: PanelBar | null;
  readonly stock: readonly StockRow[];
  readonly workerSlots: readonly WorkerSlotRow[];
  /** Non-null for a `home`-kind building: the workers window becomes the residents window. */
  readonly home: HomeResidentsModel | null;
  /** Durable household wares available at this home tier, in cooking/rest/piety order. */
  readonly homeQuality: readonly HomeQualityRow[];
  /** Whether the type offers the Obrona window, that is whether content gives it a `shelterCapacity`. */
  readonly showDefense: boolean;
  /** Whether the alarm is currently up (the sim's `DefenceMode` marker). */
  readonly defenseEnabled: boolean;
  /** Non-null while civilians hold a seat: the workers window becomes the garrison window. */
  readonly garrison: { readonly sheltered: number; readonly capacity: number } | null;
  readonly defenseLabel: string;
  readonly production: ProductionModel | null;
  /** Non-null while the building is a site: the panel swaps its defence, production, and stock windows
   *  for the one Construction window. */
  readonly construction: ConstructionModel | null;
  /** Whether the general section offers the Upgrade button (`housewindow` 110). */
  readonly upgradable: boolean;
  /** Whether the general section offers the Cancel-upgrade button (`housewindow` 112); aborting keeps the
   *  tier the building already had and loses what the hold took in beyond the building's own inventory. */
  readonly cancelable: boolean;
  /** Material cost of the upgrade target tier; empty unless `upgradable`. */
  readonly upgradeBlockedReason?: string | null;
  readonly upgradeCost: readonly UpgradeCostRow[];
  /** The map's trade agreements this house offers a visiting trader, as text rows; empty for most. */
  readonly tradeOffers: readonly string[];
}
