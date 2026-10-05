import { formatMessage, messages } from '../../../i18n/index.js';
import type { Chrome } from '../chrome.js';
import { type ButtonAction, type PalisadeLayout, ROW_TEXT_PAD } from '../layout/index.js';
import type { PalisadePanelModel } from '../model/index.js';

export function drawPalisade(
  chrome: Chrome,
  layout: PalisadeLayout,
  model: PalisadePanelModel,
  hover: ButtonAction | null,
  s: number,
): void {
  const hud = messages().hud;
  chrome.window(layout.section.frame);
  chrome.headline(layout.section.title, model.roadSite ? hud.roadSite : hud.palisade);
  if (model.health !== null) {
    chrome.textAt(
      `${model.health.label}: ${model.health.hover}`,
      layout.healthLabel.x,
      layout.healthLabel.y + ROW_TEXT_PAD * s,
      'white',
    );
    chrome.bar(layout.health, model.health.pct);
  }
  if (layout.progress !== null) {
    const progress = model.siteStatus ?? formatMessage(hud.constructionProgress, { percent: model.builtPct });
    chrome.textAt(progress, layout.progress.x, layout.progress.y + ROW_TEXT_PAD * s, 'dimmed');
  }
  for (const button of layout.buttons) {
    const label = model.roadSite ? hud.cancelRoadSite : hud.demolishPalisade;
    chrome.button(button, label, hover === button.action);
  }
}
