/**
 * The bottom-right selection details panel: pure model (`model.ts`), geometry (`layout.ts`),
 * original-art drawing (`chrome.ts` + `sections.ts`), and the app wiring (`panel.ts`).
 */
export { HUMANWINDOW, barTone, buildUnitPanelModel } from './model.js';
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
} from './model.js';
export { mountUnitPanel } from './panel.js';
export type { PortraitBox, UnitPanel, UnitPanelOptions } from './panel.js';
