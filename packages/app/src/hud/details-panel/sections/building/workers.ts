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
 *  while it is raised - and its field adds the build crew beside them; a HOME going up lists no family line,
 *  because it houses nobody until it stands (`assignHouse` refuses an unfinished home). */
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
  const limits =
    model.home !== null
      ? model.construction !== null
        ? '' // an unfinished home offers no family slot yet
        : // The decoded original label ("Liczba Rodzin", trailing-space in the data) + the slot count.
          `${ui('housewindow', HOUSEWINDOW.families, messages().hud.families).trim()} ${model.home.families.length}/${model.home.capacity}`
      : model.workerSlots.map((r) => `${r.label} ${r.filled}/${r.capacity}`).join('  ·  ');
  if (limits.length > 0) chrome.textAt(limits, body.x, body.y + ROW_TEXT_PAD * s, 'dimmed');
}
