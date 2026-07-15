import type { UiString } from '../../../../content/gui-gfx.js';
import { messages } from '../../../../i18n/index.js';
import type { Chrome } from '../../chrome.js';
import type { BuildingLayout } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { ROW_TEXT_PAD } from '../shared.js';
import { HOUSEWINDOW } from './shared.js';

/** Workers window: a compact per-trade limits strip ("Kowal 1/3 · Tragarz 1/1"), leaving the field below
 *  free for the animated worker sprites (drawn by the panel's own pass — see panel.ts). A site hides the
 *  strip (the slots describe the finished building; the field shows the live build crew instead). */
export function drawWorkersSection(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  ui: UiString,
  s: number,
): void {
  chrome.window(layout.workers.frame);
  chrome.headline(layout.workers.title, ui('housewindow', HOUSEWINDOW.workers, messages().hud.workers));
  const body = layout.workers.body;
  const limits =
    model.construction === null
      ? model.workerSlots.map((r) => `${r.label} ${r.filled}/${r.capacity}`).join('  ·  ')
      : '';
  if (limits.length > 0) chrome.textAt(limits, body.x, body.y + ROW_TEXT_PAD * s, 'dimmed');
}
