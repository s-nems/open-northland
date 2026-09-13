import type { ContentSet } from '@open-northland/data';
import type { SimEvent } from '@open-northland/sim';
import { technologyLabel } from '../../game/technology.js';
import { messages } from '../../i18n/index.js';
import { BUTTON_STYLE, el } from '../overlay.js';

type Consumer = (events: readonly SimEvent[]) => void;

export function createWorldEventHandler(options: {
  content: ContentSet;
  player: number;
  signal: AbortSignal;
  forward: Consumer;
  terrainColors: Consumer;
  subMissions: (events: readonly SimEvent[]) => boolean;
  verdict: Consumer;
  presentation: Consumer;
}): Consumer {
  const notice = el(
    'button',
    `${BUTTON_STYLE};position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:55;max-width:65vw;padding:12px`,
  );
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.addEventListener('click', () => {
    notice.hidden = true;
  });
  document.body.append(notice);
  options.signal.addEventListener('abort', () => notice.remove(), { once: true });
  return (events) => {
    options.forward(events);
    options.terrainColors(events);
    if (options.subMissions(events)) return;
    options.verdict(events);
    options.presentation(events);
    const labels: string[] = [];
    for (const event of events) {
      if (event.kind !== 'technologyDiscovered' || event.player !== options.player) continue;
      labels.push(technologyLabel(options.content, event.technology, event.typeId));
    }
    if (labels.length > 0) {
      notice.textContent = `${messages().hud.technologyDiscovered}: ${labels.join(', ')}`;
      notice.hidden = false;
    }
  };
}
