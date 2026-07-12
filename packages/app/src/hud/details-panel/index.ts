/**
 * The bottom-right selection details panel: pure model (`model/`), geometry (`layout.ts`),
 * original-art drawing (`chrome.ts` + `sections.ts`), and the app wiring (`panel.ts`).
 */

export type {
  BarTone,
  BuildingPanelModel,
  EquipRow,
  EquipSlotModel,
  GenericSelectionPanelModel,
  MultiSettlerPanelModel,
  PanelBar,
  ProductionModel,
  SettlerPanelModel,
  StockRow,
  UnitPanelModel,
  UnitPanelModelContext,
  WorkerSlotRow,
} from './model/index.js';
export { barTone, buildUnitPanelModel, HUMANWINDOW } from './model/index.js';
export type { PortraitBox, UnitPanel, UnitPanelOptions } from './panel.js';
export { mountUnitPanel } from './panel.js';
