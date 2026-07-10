/**
 * The bottom-right selection details panel: pure model (`model.ts`), geometry (`layout.ts`),
 * original-art drawing (`chrome.ts` + `sections.ts`), and the app wiring (`panel.ts`).
 */
export { HUMANWINDOW, buildUnitPanelModel, professionsFromContent } from './model.js';
export type {
  BuildingPanelModel,
  EquipRow,
  EquipSlotModel,
  GenericSelectionPanelModel,
  MultiSettlerPanelModel,
  PanelBar,
  Profession,
  ProductionModel,
  SettlerPanelModel,
  StockRow,
  UnitPanelModel,
  UnitPanelModelContext,
  WorkerRow,
} from './model.js';
export { mountUnitPanel } from './panel.js';
export type { PortraitBox, UnitPanel, UnitPanelOptions } from './panel.js';
