import type { UiString } from '../../../../content/gui-gfx.js';
import { messages } from '../../../../i18n/index.js';
import type { Chrome } from '../../chrome.js';
import { type BuildingLayout, type ButtonAction, DEFENCE_LABEL_GAP } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { HOUSEWINDOW } from './shared.js';

/**
 * Defence window. The original's own toggle is a labelled button (`housewindow` 140/141) that this
 * one-line window has no room for, so a round shield control carries the label in its cursor tooltip.
 */
export function drawDefenceSection(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  ui: UiString,
  hover: ButtonAction | null,
  s: number,
): void {
  const toggle = layout.defenceToggle;
  if (layout.defence === null || toggle === null) return;
  chrome.window(layout.defence.frame);
  chrome.headline(layout.defence.title, ui('housewindow', HOUSEWINDOW.defence, messages().hud.defence));
  chrome.roundButton(toggle.rect, true, hover === 'toggle-defence');
  chrome.glyphShield(toggle.rect, model.defenseEnabled);
  // The status line sits on the toggle's centre line, like the original's defence line (observed).
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
