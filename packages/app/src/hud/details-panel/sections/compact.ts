import type { UiString } from '../../../content/gui-gfx.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { Chrome } from '../chrome.js';
import type { CompactLayout } from '../layout/index.js';
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
      ? ui('humanlistwindow', HUMANLIST_COUNT, messages().hud.subjectCount.replace('{count}', '%d')).replace(
          '%d',
          String(model.count),
        )
      : formatMessage(messages().hud.selectedCount, { count: model.count });
  chrome.headline(layout.section.title, title);
  chrome.textAt(
    messages().hud.commandHint,
    layout.section.body.x,
    layout.section.body.y + ROW_TEXT_PAD * s,
    'dimmed',
  );
}
