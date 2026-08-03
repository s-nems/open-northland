import type { UiString } from '../../../../content/gui-gfx.js';
import { messages } from '../../../../i18n/index.js';
import type { Chrome } from '../../chrome.js';
import { type BuildingLayout, ROW_TEXT_PAD } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { HOUSEWINDOW } from './shared.js';

/** Workers window: a compact per-trade limits strip ("Kowal 1/3 · Tragarz 1/1"), leaving the field below
 *  free for the animated worker sprites (drawn by the panel's own pass - see panel.ts). A home shows its
 *  residents instead - the "Mieszkańcy" headline and a "Rodziny 1/3" family-slot line over the
 *  family-grouped sprite field. A workplace still going up lists the same worker strip - it takes its staff
 *  while it is raised - and its field adds the build crew beside them.
 *
 *  A building on alarm takes the same swap: the field draws its garrison rather than its staff
 *  (`worker-selection.ts`), so the window is headlined and counted for the garrison, not for trades whose
 *  slots stand empty under it. */

/** Whether the window draws a limits strip at all. False only for a home still going up: it houses nobody
 *  until it stands (`assignHouse` refuses an unfinished home), so the row goes to its build crew instead.
 *  The panel insets the sprite field by exactly this row - one owner for the two decisions. */
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

/** Whose window this is: the garrison's while one holds the building, else its residents' (a home) or its
 *  workers'. The garrison headline is ours - the original has no string for a sheltering crowd. */
function windowTitle(model: BuildingPanelModel, ui: UiString): string {
  if (model.garrison !== null) return messages().hud.sheltered;
  return model.home !== null
    ? ui('housewindow', HOUSEWINDOW.residents, messages().hud.residents)
    : ui('housewindow', HOUSEWINDOW.workers, messages().hud.workers);
}

/** The count line under the headline: the garrison's fill, a home's family slots, or the per-trade limits. */
function limitsStrip(model: BuildingPanelModel, ui: UiString): string {
  const garrison = model.garrison;
  if (garrison !== null) return `${garrison.sheltered}/${garrison.capacity}`;
  const home = model.home;
  // The decoded original label ("Liczba Rodzin", trailing-space in the data) + the slot count.
  if (home !== null) {
    const label = ui('housewindow', HOUSEWINDOW.families, messages().hud.families).trim();
    return `${label} ${home.families.length}/${home.capacity}`;
  }
  return model.workerSlots.map((r) => `${r.label} ${r.filled}/${r.capacity}`).join('  ·  ');
}
