import { formatMessage, messages } from '../../../../i18n/index.js';
import type { Chrome } from '../../chrome.js';
import { type BuildingLayout, ROW_TEXT_PAD } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';

/** Household wares show their remaining activity charges; holy oil drains continuously and instead
 * reports whether this finished home's fire is active. */
export function drawHomeQualitySection(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  s: number,
): void {
  if (layout.homeQuality === null) return;
  chrome.window(layout.homeQuality.frame);
  chrome.headline(layout.homeQuality.title, messages().hud.homeQuality);
  layout.homeQualityRows.forEach((row, i) => {
    const quality = model.homeQuality[i];
    if (quality === undefined) return;
    const percent = Math.floor((quality.value * 100) / quality.capacity);
    const status =
      quality.holyFireActive === undefined
        ? formatMessage(messages().hud.homeQualityUses, { count: quality.uses ?? 0 })
        : quality.holyFireActive
          ? messages().hud.holyFireActive
          : messages().hud.holyFireInactive;
    chrome.textAt(`${quality.label}: ${percent}% · ${status}`, row.x, row.y + ROW_TEXT_PAD * s, 'white');
  });
}
