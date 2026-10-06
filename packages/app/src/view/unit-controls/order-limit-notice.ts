import { MAX_UNIT_ORDER_MEMBERS } from '@open-northland/sim';
import { WINDOW_REGION_TOP } from '../../hud/regions.js';
import { formatMessage, messages } from '../../i18n/index.js';

export function createOrderLimitNotice(plane: HTMLElement): { show(): void; dispose(): void } {
  const element = document.createElement('div');
  element.className = 'on-strip';
  element.setAttribute('role', 'status');
  element.hidden = true;
  element.style.top = `${WINDOW_REGION_TOP}px`;
  element.style.pointerEvents = 'none';
  element.style.zIndex = '20';
  const text = document.createElement('span');
  text.className = 'on-strip__text';
  element.append(text);
  plane.append(element);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    show: () => {
      clearTimeout(timer);
      text.textContent = formatMessage(messages().hud.armyOrderLimit, { limit: MAX_UNIT_ORDER_MEMBERS });
      element.hidden = false;
      timer = setTimeout(() => {
        element.hidden = true;
        timer = undefined;
      }, 6000);
    },
    dispose: () => {
      clearTimeout(timer);
      element.remove();
    },
  };
}
