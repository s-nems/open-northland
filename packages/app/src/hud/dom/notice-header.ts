import { formatMessage, messages } from '../../i18n/index.js';
import { NOTICE_COLUMN } from '../regions.js';
import type { MessagePriorityLevel } from '../tool-panel/messages/types.js';

/** The seal filters in level order: everything, notable and important, important only. */
const FILTERS: readonly { readonly level: MessagePriorityLevel; readonly seal: string }[] = [
  { level: 0, seal: 'low' },
  { level: 1, seal: 'medium' },
  { level: 2, seal: 'high' },
];

/** The head of the notification column: the message count medallion and the three seal filters. */
export interface HudNoticeHeader {
  set(count: number, level: MessagePriorityLevel): void;
  dispose(): void;
}

export function createHudNoticeHeader(
  plane: HTMLElement,
  onLevel: (level: MessagePriorityLevel) => void,
): HudNoticeHeader {
  const copy = messages().hud.shell;
  const column = document.createElement('aside');
  column.className = 'on-notices';
  Object.assign(column.style, {
    position: 'absolute',
    left: `${NOTICE_COLUMN.left}px`,
    top: `${NOTICE_COLUMN.top}px`,
    width: `${NOTICE_COLUMN.width}px`,
  });
  const head = document.createElement('div');
  Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '10px', padding: '0 0 10px 2px' });
  const counter = document.createElement('strong');
  counter.className = 'on-counter on-medallion';
  const counterLabel = document.createElement('span');
  counterLabel.className = 'on-sr';
  const counterValue = document.createElement('span');
  counter.append(counterLabel, counterValue);
  const filters = document.createElement('div');
  filters.className = 'on-filters';
  filters.setAttribute('role', 'toolbar');
  filters.setAttribute('aria-label', copy.messageLevelLabel);
  const levelNames = [copy.messageLevels.all, copy.messageLevels.notable, copy.messageLevels.important];
  const buttons = FILTERS.map((filter, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `on-filter on-filter--${filter.seal}`;
    const name = levelNames[i] ?? '';
    button.setAttribute('aria-label', name);
    button.title = name;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => onLevel(filter.level));
    filters.append(button);
    return button;
  });
  head.append(counter, filters);
  column.append(head);
  plane.append(column);
  let shown = '';
  return {
    set: (count, level) => {
      const key = `${count}:${level}`;
      if (key === shown) return;
      shown = key;
      counterValue.textContent = String(count);
      counterLabel.textContent = `${copy.messages}: `;
      counter.title = formatMessage(copy.messagesCount, { count });
      FILTERS.forEach((filter, i) => {
        buttons[i]?.setAttribute('aria-pressed', String(filter.level === level));
      });
    },
    dispose: () => column.remove(),
  };
}
