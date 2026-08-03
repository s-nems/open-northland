import { GUI_FRAME } from '../../../../content/gui-atlas-map.js';
import type { UiString } from '../../../../content/gui-gfx.js';
import { messages } from '../../../../i18n/index.js';
import type { Rect } from '../../../geometry.js';
import type { Chrome } from '../../chrome.js';
import { type BuildingLayout, type ButtonAction, PREVIEW_INSET } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { HOUSEWINDOW } from './shared.js';

// The building's own action buttons (assign-workplace is a settler-panel action, never drawn here).
const BUTTON_STRING: Readonly<Partial<Record<ButtonAction, number>>> = {
  upgrade: HOUSEWINDOW.upgrade,
  cancelUpgrade: HOUSEWINDOW.cancelUpgrade,
  demolish: HOUSEWINDOW.demolish,
  center: HOUSEWINDOW.center,
  workers: HOUSEWINDOW.workersButton,
  help: HOUSEWINDOW.help,
};

function buttonFallback(action: ButtonAction): string {
  const hud = messages().hud;
  if (action === 'upgrade') return hud.upgrade;
  if (action === 'cancelUpgrade') return hud.cancelUpgrade;
  if (action === 'demolish') return hud.demolish;
  if (action === 'center') return hud.center;
  if (action === 'workers') return hud.workers;
  return hud.help;
}

/** General window: the building preview bob, the name row + health gauge, and the action buttons. */
export function drawGeneralSection(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  ui: UiString,
  hover: ButtonAction | null,
  s: number,
): void {
  chrome.window(layout.general.frame);
  chrome.headline(layout.general.title, ui('housewindow', HOUSEWINDOW.general, messages().hud.general));

  chrome.innerBox(layout.preview);
  const previewInset = Math.round(PREVIEW_INSET * s);
  const previewArt: Rect = {
    x: layout.preview.x + previewInset,
    y: layout.preview.y + previewInset,
    w: layout.preview.w - previewInset * 2,
    h: layout.preview.h - previewInset * 2,
  };
  // A construction site skips the finished-building bob: whenever the live portrait inset cannot draw,
  // the box must show the neutral plate rather than a misleading complete house.
  if (model.construction !== null || !chrome.buildingPreview(model.typeId, previewArt)) {
    chrome.guiCentered(GUI_FRAME.house_plate, layout.preview, 'magenta', 'bg_normal');
    chrome.guiCentered(GUI_FRAME.tool_button_buildings, layout.preview, 'full');
  }

  chrome.textCentered(model.title, layout.name, 'white');
  // Bare gauge, no label column: the cursor tooltip is the only thing that names it.
  if (model.health !== null) chrome.bar(layout.health, model.health.pct, 'gauge');

  for (const hit of layout.buttons) {
    // The `?? help` guard only satisfies the Partial type; a building action without a BUTTON_STRING row
    // would silently draw the help label.
    chrome.button(
      hit,
      ui('housewindow', BUTTON_STRING[hit.action] ?? HOUSEWINDOW.help, buttonFallback(hit.action)),
      hover === hit.action,
    );
  }
}
