import type { UiString } from '../../../content/gui-gfx.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { Chrome } from '../chrome.js';
import { type ButtonAction, type PalisadeLayout, ROW_TEXT_PAD } from '../layout/index.js';
import type { PalisadePanelModel } from '../model/index.js';

export function drawPalisade(
  chrome: Chrome,
  layout: PalisadeLayout,
  model: PalisadePanelModel,
  _ui: UiString,
  hover: ButtonAction | null,
  s: number,
): void {
  const hud = messages().hud;
  chrome.window(layout.section.frame);
  chrome.headline(layout.section.title, model.gateOpen === null ? hud.palisade : hud.gate);
  if (model.health !== null) {
    chrome.textAt(
      `${model.health.label}: ${model.health.hover}`,
      layout.healthLabel.x,
      layout.healthLabel.y + ROW_TEXT_PAD * s,
      'white',
    );
    chrome.bar(layout.health, model.health.pct, 'gauge');
  }
  if (layout.progress !== null) {
    const progress = formatMessage(hud.constructionProgress, {
      percent: model.builtPct,
    });
    chrome.textAt(progress, layout.progress.x, layout.progress.y + ROW_TEXT_PAD * s, 'dimmed');
  }
  for (const button of layout.buttons) {
    const label =
      button.action === 'toggle-gate'
        ? model.gateOpen === true
          ? hud.closeGate
          : hud.openGate
        : model.gateOpen === null
          ? hud.demolishPalisade
          : hud.demolishGate;
    chrome.button(button, label, hover === button.action);
  }
}
