import { messages } from '../../../i18n/index.js';
import type {
  SeatControl,
  SettlerFamilyModel,
  SettlerPanelModel,
  SettlerSeatRow,
} from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import { element, setHidden } from '../parts/dom.js';
import { createLedger, type LedgerSegment } from '../parts/ledger.js';
import type { RoundButtonModel } from '../parts/round-button.js';
import { createSection } from '../parts/section.js';
import type { SettlerPanelDeps } from './actions.js';

/** A seat row's round button: live, faded with the sim's reason, or a blank slot. */
export function seatButton(
  control: SeatControl | null,
  glyph: string,
  label: string,
  hint: string,
): RoundButtonModel | null {
  if (control === null) return null;
  return {
    face: { glyph },
    label,
    tooltip: control === true ? hint : control,
    enabled: control === true,
  };
}

/** The value of a Miejsce pracy or Dom row: the building as a link, plain for another seat's person,
 *  or "brak" in amber when the player can fill it. */
export function seatValue(row: SettlerSeatRow, linkTooltip: string, foreign: boolean): LedgerSegment[] {
  const copy = messages().hud.settlerPanel;
  if (row.target === null) {
    return [{ text: copy.missing, tone: row.assign === true ? 'missing' : 'muted' }];
  }
  const link = !foreign && row.target.id !== null;
  return [{ text: row.target.label, link, ...(link ? { tooltip: linkTooltip } : {}) }];
}

/** The Rodzina value: the spouse and the child as links, or "bez pary", a link while the partner pick
 *  is open to the person. */
export function familyValue(family: SettlerFamilyModel): LedgerSegment[] {
  const copy = messages().hud.settlerPanel;
  if (family.partner === null) {
    return [
      family.canPickPartner
        ? { text: copy.noPartner, link: true, tone: 'missing', tooltip: copy.noPartnerTooltip }
        : { text: copy.noPartner, tone: 'muted' },
    ];
  }
  const people: LedgerSegment[] = [{ text: family.partner.label, link: true, tooltip: copy.partnerTooltip }];
  if (family.child !== null)
    people.push({ text: family.child.label, link: true, tooltip: copy.childTooltip });
  return people;
}

/** Praca i rodzina: the workplace and home rows with their assign and remove buttons, and the family. */
export interface WorkSection {
  readonly element: HTMLElement;
  update(model: SettlerPanelModel): void;
}

export function createWorkSection(
  deps: SettlerPanelDeps,
  current: () => SettlerPanelModel | null,
): WorkSection {
  const { actions } = deps;
  const id = (): number => current()?.entityId ?? -1;
  const root = element('div', '');
  const title = createSection();

  const workplace = createLedger({
    buttons: 2,
    onLink: () => {
      const target = current()?.workplace?.target?.id;
      if (target != null) actions.select(target);
    },
    onLinkHover: (_index, event) => {
      const target = current()?.workplace?.target?.id;
      const card = target == null || event === null ? null : deps.buildingHover(target);
      if (card === null || event === null) deps.hoverCard.hide();
      else deps.hoverCard.show(event.clientX, event.clientY, card);
    },
    onButton: (index) => (index === 0 ? actions.assignWorkplace(id()) : actions.unassignWorkplace(id())),
  });
  const home = createLedger({
    buttons: 2,
    onLink: () => {
      const target = current()?.home?.target?.id;
      if (target != null) actions.select(target);
    },
    onButton: (index) => (index === 0 ? actions.assignHome(id()) : actions.unassignHome(id())),
  });
  const family = createLedger({
    onLink: (index) => {
      const model = current()?.family;
      if (model == null) return;
      if (model.partner === null) actions.pickPartner(id());
      else {
        const person = index === 0 ? model.partner : model.child;
        if (person !== null) actions.select(person.id);
      }
    },
  });
  root.append(title.element, workplace.element, home.element, family.element);

  return {
    element: root,
    update(model): void {
      const copy = messages().hud;
      const panel = copy.settlerPanel;
      title.update(
        model.family !== null ? panel.workAndFamily : model.home !== null ? panel.workAndHome : copy.work,
      );
      setHidden(workplace.element, model.workplace === null);
      if (model.workplace !== null) {
        workplace.update({
          label: panel.workplace,
          value: seatValue(model.workplace, panel.workplaceTooltip, model.foreign),
          buttons: [
            seatButton(model.workplace.assign, GLYPH.target, copy.assignWorkplace, copy.assignWorkplaceHint),
            seatButton(
              model.workplace.remove,
              GLYPH.close,
              copy.unassignWorkplace,
              copy.unassignWorkplaceHint,
            ),
          ],
        });
      } else deps.hoverCard.hide();
      setHidden(home.element, model.home === null);
      if (model.home !== null) {
        home.update({
          label: panel.home,
          value: seatValue(model.home, panel.buildingTooltip, model.foreign),
          buttons: [
            seatButton(model.home.assign, GLYPH.target, copy.assignHome, copy.assignHomeHint),
            seatButton(model.home.remove, GLYPH.close, copy.unassignHome, copy.unassignHomeHint),
          ],
        });
      }
      setHidden(family.element, model.family === null);
      if (model.family !== null) family.update({ label: panel.family, value: familyValue(model.family) });
    },
  };
}
