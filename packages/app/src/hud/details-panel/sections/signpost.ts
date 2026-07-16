import type { UiString } from '../../../content/gui-gfx.js';
import { messages } from '../../../i18n/index.js';
import type { Chrome } from '../chrome.js';
import type { ButtonAction, SignpostLayout } from '../layout/index.js';

// The signpost window's decoded strings (`miscwindow`): 270 "Signpost" / "Drogowskaz",
// 273 "Tear down this signpost" / "Wyburz ten drogowskaz".
const MISCWINDOW = { signpost: 270, tearDown: 273 } as const;

/** The selected-signpost panel: the original's title + its one action, the tear-down button. */
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
