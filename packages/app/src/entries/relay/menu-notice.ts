import { messages } from '../../i18n/index.js';
import { swapToEntry } from '../../launch.js';
import { BUTTON_STYLE, el, mountMessage } from '../../view/overlay.js';
import { menuSearch } from '../../view/params.js';

/** The notice a relayed entry ends on, with a way back to the menu that takes the notice with it. */
export function mountReturnToMenuNotice(title: string, detail: string): void {
  const back = el('button', BUTTON_STYLE, messages().hud.returnToMenu);
  back.type = 'button';
  const remove = mountMessage(title, detail, [back]);
  back.addEventListener('click', () => {
    void swapToEntry(menuSearch(), remove);
  });
}
