/**
 * The bottom-right selection details panel: pure model (`model.ts`), geometry (`layout.ts`),
 * original-art drawing (`chrome.ts` + `sections.ts`), and the app wiring (`panel.ts`).
 */
export { buildUnitPanelModel, professionsFromContent } from './model.js';
export type {
  BuildingPanelModel,
  GenericSelectionPanelModel,
  MultiSettlerPanelModel,
  PanelNeed,
  Profession,
  ProductionModel,
  SettlerPanelModel,
  StockRow,
  UnitPanelModel,
  UnitPanelModelContext,
  WorkerRow,
} from './model.js';
export { mountUnitPanel } from './panel.js';
export type { UnitPanel, UnitPanelOptions } from './panel.js';
