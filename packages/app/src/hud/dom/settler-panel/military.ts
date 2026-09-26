import { systems } from '@open-northland/sim';
import { messages } from '../../../i18n/index.js';
import type { SettlerPanelModel } from '../../details-panel/model/index.js';
import { element, setHidden, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import { createSegmented } from '../parts/segmented.js';
import type { SettlerPanelDeps } from './actions.js';

type Stance = 'attack' | 'defend' | 'ignore';
type Regeneration = 'allowed' | 'forbidden';

/** The three stances the panel offers, as the action ring issues them; flight is the sim's own state. */
const STANCE_MODE: Readonly<Record<Stance, number>> = {
  attack: systems.MILITARY_MODE.ATTACK,
  defend: systems.MILITARY_MODE.DEFEND,
  ignore: systems.MILITARY_MODE.IGNORE,
};
const STANCES: readonly Stance[] = ['attack', 'defend', 'ignore'];

/** The segment a stance lights; null for flight or a unit the sim has not stamped yet. */
export function stanceSegment(mode: number | null): Stance | null {
  return STANCES.find((stance) => STANCE_MODE[stance] === mode) ?? null;
}

/** Wojsko: Postawa as a three-way choice and Jedzenie i sen as allowed or forbidden. */
export interface MilitarySection {
  readonly element: HTMLElement;
  update(model: SettlerPanelModel): void;
}

export function createMilitarySection(deps: SettlerPanelDeps, entity: () => number): MilitarySection {
  const copy = (): ReturnType<typeof messages>['hud'] => messages().hud;
  const root = element('div', '');
  const title = createSection();
  const row = (segmented: HTMLElement): { element: HTMLElement; label: HTMLElement } => {
    const line = element('div', 'on-ledger on-ledger--ctl', '<span></span>');
    const label = line.firstElementChild;
    if (!(label instanceof HTMLElement)) throw new Error('military: row');
    line.append(segmented);
    return { element: line, label };
  };
  const stance = createSegmented(STANCES, copy().settlerPanel.stance, (key) =>
    deps.actions.setStance(entity(), STANCE_MODE[key]),
  );
  const regeneration = createSegmented<Regeneration>(
    ['allowed', 'forbidden'],
    copy().settlerPanel.regeneration,
    (key) => deps.actions.setRegeneration(entity(), key === 'allowed'),
  );
  const stanceRow = row(stance.element);
  const regenerationRow = row(regeneration.element);
  root.append(title.element, stanceRow.element, regenerationRow.element);
  return {
    element: root,
    update(model): void {
      const military = model.military;
      setHidden(root, military === null);
      if (military === null) return;
      const hud = copy();
      title.update(hud.settlerPanel.military);
      write(stanceRow.label, hud.settlerPanel.stance);
      write(regenerationRow.label, hud.settlerPanel.regeneration);
      stance.update(
        { attack: { label: hud.attack }, defend: { label: hud.defend }, ignore: { label: hud.ignore } },
        stanceSegment(military.stance),
      );
      regeneration.update(
        {
          allowed: { label: hud.settlerPanel.allowed },
          forbidden: { label: hud.settlerPanel.forbidden },
        },
        military.regeneration ? 'allowed' : 'forbidden',
      );
    },
  };
}
