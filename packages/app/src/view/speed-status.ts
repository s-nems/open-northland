import { formatMessage, messages } from '../i18n/index.js';
import { el } from './overlay.js';
import { formatDelivered, formatSpeed } from './perf-overlay.js';

export interface SpeedStatusLine {
  /** Null `delivered` hides the line. Cheap every frame: it formats and writes only on a change. */
  update(delivered: number | null, requested: number): void;
  dispose(): void;
}

/** The printed figure's resolution, the tenth {@link formatDelivered} rounds to. */
const TENTHS = 10;

const LINE_STYLE =
  'max-width:360px;padding-top:10px;border-top:1px solid rgba(138,116,74,0.7);font-size:12px;color:#f0c070';

export function speedShortfallText(delivered: number, requested: number): string {
  return formatMessage(messages().hud.speedShortfall, {
    delivered: formatDelivered(delivered),
    requested: formatSpeed(requested),
  });
}

/** The system menu's line for a sustained speed shortfall, hidden until one holds. */
export function mountSpeedStatusLine(parent: HTMLElement): SpeedStatusLine {
  const line = el('div', LINE_STYLE);
  line.setAttribute('role', 'status');
  line.style.display = 'none';
  parent.append(line);
  let shownTenths: number | null = null;
  let shownRequested = 0;
  let shownCopy = messages();
  return {
    update(delivered, requested): void {
      const tenths = delivered === null ? null : Math.round(delivered * TENTHS);
      const copy = messages();
      if (tenths === shownTenths && requested === shownRequested && copy === shownCopy) return;
      shownTenths = tenths;
      shownRequested = requested;
      shownCopy = copy;
      if (delivered === null) {
        line.style.display = 'none';
        return;
      }
      line.textContent = speedShortfallText(delivered, requested);
      line.style.display = '';
    },
    dispose: () => line.remove(),
  };
}
