import type { UiString } from '../../../content/gui-gfx.js';
import type { Chrome } from '../chrome.js';
import type { CompactLayout } from '../layout.js';
import type { GenericSelectionPanelModel, MultiSettlerPanelModel } from '../model/index.js';
import { ROW_TEXT_PAD } from './shared.js';

/** `humanlistwindow` 2: 'Liczba poddanych na liście: %d'. */
const HUMANLIST_COUNT = 2;

export function drawCompact(
  chrome: Chrome,
  layout: CompactLayout,
  model: MultiSettlerPanelModel | GenericSelectionPanelModel,
  ui: UiString,
  s: number,
): void {
  chrome.window(layout.section.frame);
  const title =
    model.kind === 'multi-settler'
      ? ui('humanlistwindow', HUMANLIST_COUNT, 'Liczba poddanych na liście: %d').replace(
          '%d',
          String(model.count),
        )
      : `${model.count} zaznaczonych`;
  chrome.headline(layout.section.title, title);
  chrome.textAt(
    'PPM — rozkaz ruchu, Spacja — akcje',
    layout.section.body.x,
    layout.section.body.y + ROW_TEXT_PAD * s,
    'dimmed',
  );
}
