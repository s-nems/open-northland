import type { UiString } from '../../../../content/gui-gfx.js';
import { messages } from '../../../../i18n/index.js';
import type { Chrome } from '../../chrome.js';
import type { BuildingLayout } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { ROW_TEXT_PAD } from '../shared.js';
import { HOUSEWINDOW } from './shared.js';

/** Workers window: a compact per-trade limits strip ("Kowal 1/3 · Tragarz 1/1"), leaving the field below
 *  free for the animated worker sprites (drawn by the panel's own pass — see panel.ts). A home shows its
 *  residents instead — the "Mieszkańcy" headline and a "Rodziny 1/3" family-slot line over the
 *  family-grouped sprite field. A site hides the strip (the slots describe the finished building; the
 *  field shows the live build crew instead). */
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
    model.construction !== null
      ? ''
      : model.home !== null
        ? // The decoded original label ("Liczba Rodzin", trailing-space in the data) + the slot count.
          `${ui('housewindow', HOUSEWINDOW.families, messages().hud.families).trim()} ${model.home.families.length}/${model.home.capacity}`
        : model.workerSlots.map((r) => `${r.label} ${r.filled}/${r.capacity}`).join('  ·  ');
  if (limits.length > 0) chrome.textAt(limits, body.x, body.y + ROW_TEXT_PAD * s, 'dimmed');
}
