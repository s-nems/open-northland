import type { UiString } from '../../../content/gui-gfx.js';
import { messages } from '../../../i18n/index.js';
import type { Chrome } from '../chrome.js';
import type { ButtonAction, SignpostLayout } from '../layout/index.js';

// Decoded `miscwindow` string ids: 270 "Drogowskaz", 273 "Wyburz ten drogowskaz".
const MISCWINDOW = { signpost: 270, tearDown: 273 } as const;

export function drawSignpost(
  chrome: Chrome,
  layout: SignpostLayout,
  ui: UiString,
  hover: ButtonAction | null,
): void {
  chrome.window(layout.section.frame);
  chrome.headline(layout.section.title, ui('miscwindow', MISCWINDOW.signpost, messages().hud.signpost));
  chrome.button(
    layout.button,
    ui('miscwindow', MISCWINDOW.tearDown, messages().hud.demolishSignpost),
    hover === 'demolish',
  );
}
