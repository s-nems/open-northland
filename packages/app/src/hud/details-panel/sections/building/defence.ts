import type { UiString } from '../../../../content/gui-gfx.js';
import { messages } from '../../../../i18n/index.js';
import type { Chrome } from '../../chrome.js';
import { type BuildingLayout, type ButtonAction, DEFENCE_LABEL_GAP } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { HOUSEWINDOW } from './shared.js';

/**
 * Defence window: the round alarm toggle that raises and lowers defence mode, with the original's status
 * line beside it. The button is the equip window's round control with a shield face - filled while the
 * alarm is up, hollow while it is down. An original glyph: the source's own toggle is a labelled button
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
  const toggle = layout.defenceToggle; // built with the window, so the two are null together
  if (layout.defence === null || toggle === null) return;
  chrome.window(layout.defence.frame);
  chrome.headline(layout.defence.title, ui('housewindow', HOUSEWINDOW.defence, messages().hud.defence));
  chrome.roundButton(toggle.rect, true, hover === 'toggle-defence');
  chrome.glyphShield(toggle.rect, model.defenseEnabled);
  // Light body text like the original's defence status line (screenshot-observed), set on the button's
  // centre line so the pair reads as one row, and shrunk to what the toggle leaves of it.
  const textX = toggle.rect.x + toggle.rect.w + Math.round(DEFENCE_LABEL_GAP * s);
  chrome.textLeftMiddle(
    model.defenseLabel,
    textX,
    toggle.rect.y + toggle.rect.h / 2,
    'white',
    'body',
    layout.defence.body.x + layout.defence.body.w - textX,
  );
}
