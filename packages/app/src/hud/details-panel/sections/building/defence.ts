import type { UiString } from '../../../../content/gui-gfx.js';
import { messages } from '../../../../i18n/index.js';
import type { Chrome } from '../../chrome.js';
import { type BuildingLayout, ROW_TEXT_PAD } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { HOUSEWINDOW } from './shared.js';

/** Defence window: the original's single status line. */
export function drawDefenceSection(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  ui: UiString,
  s: number,
): void {
  if (layout.defence === null) return;
  chrome.window(layout.defence.frame);
  chrome.headline(layout.defence.title, ui('housewindow', HOUSEWINDOW.defence, messages().hud.defence));
  // Light body text like the original's defence status line (screenshot-observed).
  chrome.textAt(model.defenseLabel, layout.defence.body.x, layout.defence.body.y + ROW_TEXT_PAD * s, 'white');
}
