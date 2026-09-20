import type { UiString } from '../../../../content/gui-gfx.js';
import type { Chrome } from '../../chrome.js';
import type { BuildingLayout, ButtonAction } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { drawConstructionSection } from './construction.js';
import { drawDefenceSection } from './defence.js';
import { drawGeneralSection } from './general.js';
import { drawHomeQualitySection } from './home-quality.js';
import { drawOffersSection } from './offers.js';
import { drawProductionSection } from './production.js';
import { drawStockSection } from './stock.js';
import { drawWorkersSection } from './workers.js';

/** Each section no-ops when its layout slot is absent. */
export function drawBuilding(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  ui: UiString,
  hover: ButtonAction | null,
  activeTab: number,
  s: number,
): void {
  drawGeneralSection(chrome, layout, model, ui, hover, s);
  drawConstructionSection(chrome, layout, model, s);
  drawDefenceSection(chrome, layout, model, ui, hover, s);
  drawProductionSection(chrome, layout, model, s);
  drawStockSection(chrome, layout, model, ui, activeTab, s);
  drawHomeQualitySection(chrome, layout, model, hover, s);
  drawWorkersSection(chrome, layout, model, ui, s);
  drawOffersSection(chrome, layout, model, s);
}
