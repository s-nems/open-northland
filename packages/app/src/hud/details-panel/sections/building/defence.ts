import type { UiString } from '../../../../content/gui-gfx.js';
import { messages } from '../../../../i18n/index.js';
import type { Chrome } from '../../chrome.js';
import { type BuildingLayout, type ButtonAction, ROW_TEXT_PAD } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { HOUSEWINDOW } from './shared.js';

/**
 * Defence window: the original's status line, plus the round alarm toggle that raises and lowers defence
 * mode. The button is the equip window's round control with a shield face - filled while the alarm is up,
 * hollow while it is down. An original glyph: the source's own toggle is a labelled button
 * (`housewindow` 140/141, "Rozpocznij/Zatrzymaj Tryb Obrony") that this one-line window has no room for,
 * so its name lives in the cursor tooltip like the equip controls' do.
 */
export function drawDefenceSection(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  ui: UiString,
  hover: ButtonAction | null,
  s: number,
): void {
  if (layout.defence === null) return;
  chrome.window(layout.defence.frame);
  chrome.headline(layout.defence.title, ui('housewindow', HOUSEWINDOW.defence, messages().hud.defence));
  // Light body text like the original's defence status line (screenshot-observed).
  chrome.textAt(model.defenseLabel, layout.defence.body.x, layout.defence.body.y + ROW_TEXT_PAD * s, 'white');
  if (layout.defenceToggle === null) return;
  chrome.roundButton(layout.defenceToggle.rect, true, hover === 'toggle-defence');
  chrome.glyphShield(layout.defenceToggle.rect, model.defenseEnabled);
}
