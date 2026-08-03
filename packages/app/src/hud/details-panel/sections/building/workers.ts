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
 *  while it is raised - and its field adds the build crew beside them. */

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
  const title =
    model.home !== null
      ? ui('housewindow', HOUSEWINDOW.residents, messages().hud.residents)
      : ui('housewindow', HOUSEWINDOW.workers, messages().hud.workers);
  chrome.headline(layout.workers.title, title);
  const body = layout.workers.body;
  if (!hasWorkerLimitsRow(model)) return;
  const home = model.home;
  const limits =
    home !== null
      ? // The decoded original label ("Liczba Rodzin", trailing-space in the data) + the slot count.
        `${ui('housewindow', HOUSEWINDOW.families, messages().hud.families).trim()} ${home.families.length}/${home.capacity}`
      : model.workerSlots.map((r) => `${r.label} ${r.filled}/${r.capacity}`).join('  ·  ');
  chrome.textAt(limits, body.x, body.y + ROW_TEXT_PAD * s, 'dimmed');
}
