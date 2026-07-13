import { formatMessage, messages } from '../i18n/index.js';
import { el, PANEL_STYLE } from './overlay.js';

/** Show a localized routing error when `?scene=<id>` does not match the registry. */
export function mountUnknownSceneOverlay(sceneId: string, available: readonly string[]): void {
  const copy = messages().common;
  const panel = el('div', PANEL_STYLE);
  panel.append(
    el(
      'div',
      'font-weight:700;font-size:14px;margin-bottom:6px',
      formatMessage(copy.unknownScene, { id: sceneId }),
    ),
    el('div', 'opacity:0.85;margin-bottom:6px', copy.availableScenes),
  );
  const list = el('ul', 'margin:0;padding-left:18px');
  for (const id of available) list.append(el('li', 'margin:2px 0', id));
  panel.append(list);
  document.body.append(panel);
}
