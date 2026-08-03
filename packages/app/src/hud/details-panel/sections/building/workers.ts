import type { UiString } from '../../../../content/gui-gfx.js';
import { messages } from '../../../../i18n/index.js';
import type { Chrome } from '../../chrome.js';
import { type BuildingLayout, ROW_TEXT_PAD } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { HOUSEWINDOW } from './shared.js';

/** Whether the window draws a limits strip; the panel insets the sprite field by exactly this row. */
export function hasWorkerLimitsRow(model: BuildingPanelModel): boolean {
  return model.home === null || model.construction === null;
}

export function drawWorkersSection(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  ui: UiString,
  s: number,
): void {
  chrome.window(layout.workers.frame);
  chrome.headline(layout.workers.title, windowTitle(model, ui));
  const body = layout.workers.body;
  if (!hasWorkerLimitsRow(model)) return;
  const limits = limitsStrip(model, ui);
  if (limits.length > 0) chrome.textAt(limits, body.x, body.y + ROW_TEXT_PAD * s, 'dimmed');
}

/** The garrison headline is ours; the original has no string for a sheltering crowd. */
function windowTitle(model: BuildingPanelModel, ui: UiString): string {
  if (model.garrison !== null) return messages().hud.sheltered;
  return model.home !== null
    ? ui('housewindow', HOUSEWINDOW.residents, messages().hud.residents)
    : ui('housewindow', HOUSEWINDOW.workers, messages().hud.workers);
}

function limitsStrip(model: BuildingPanelModel, ui: UiString): string {
  const garrison = model.garrison;
  if (garrison !== null) return `${garrison.sheltered}/${garrison.capacity}`;
  const home = model.home;
  // The decoded label "Liczba Rodzin" carries a trailing space in the data.
  if (home !== null) {
    const label = ui('housewindow', HOUSEWINDOW.families, messages().hud.families).trim();
    return `${label} ${home.families.length}/${home.capacity}`;
  }
  return model.workerSlots.map((r) => `${r.label} ${r.filled}/${r.capacity}`).join('  ·  ');
}
