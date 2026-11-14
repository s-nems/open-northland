import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingPanelModel } from '../../details-panel/model/index.js';
import { element, setHidden } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import type { BuildingPanelDeps } from './actions.js';
import { createGoodLine } from './good-line.js';

const SECONDS_PER_MINUTE = 60;
const SECONDS_DIGITS = 2;

/** `m:ss` of game seconds. */
function clockText(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const rest = String(whole % SECONDS_PER_MINUTE).padStart(SECONDS_DIGITS, '0');
  return `${Math.floor(whole / SECONDS_PER_MINUTE)}:${rest}`;
}

/** Holy fire: a fuelled temple's burning unit of oil, its rule emptying as the unit burns down. */
export interface TempleFireSection {
  readonly element: HTMLElement;
  update(model: BuildingPanelModel): void;
}

export function createTempleFireSection(deps: Pick<BuildingPanelDeps, 'icons'>): TempleFireSection {
  const title = createSection();
  const list = element('ul', 'on-manifest');
  const line = createGoodLine(deps.icons);
  list.append(line.element);
  const root = element('div', '');
  root.append(title.element, list);

  const update = (model: BuildingPanelModel): void => {
    const fire = model.templeFire;
    setHidden(root, fire === null);
    if (fire === null) return;
    const copy = messages().hud.buildingPanel;
    title.update(copy.templeFire);
    const time = clockText(fire.unitSecondsLeft);
    line.update({
      goodId: fire.goodId,
      label: fire.label,
      value: time,
      fill: `${fire.pct}%`,
      tooltip: fire.burning
        ? formatMessage(copy.templeFireLeft, {
            time,
            minutes: Math.ceil(fire.storeSecondsLeft / SECONDS_PER_MINUTE),
          })
        : fire.doused
          ? copy.templeFireDoused
          : copy.templeFireOut,
      muted: !fire.burning,
    });
  };

  return { element: root, update };
}
