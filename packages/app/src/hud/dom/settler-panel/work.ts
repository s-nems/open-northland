import { messages } from '../../../i18n/index.js';
import type {
  SeatControl,
  SettlerFamilyModel,
  SettlerPanelModel,
  SettlerSeatRow,
  SettlerVehicleRow,
} from '../../details-panel/model/index.js';
import { createHouseCardLink } from '../hover-card.js';
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

/** The button that centres the view on the settler's work flag; a blank slot without one. */
function flagButton(flag: number | null): RoundButtonModel | null {
  const copy = messages().hud.settlerPanel;
  return flag === null
    ? null
    : { face: { glyph: GLYPH.center }, label: copy.centreFlag, tooltip: copy.centreFlagHint };
}

/** The value of a Workplace or Home row: the building as a link, plain for another seat's person,
 *  or "none" in amber when the player can fill it. */
export function seatValue(row: SettlerSeatRow, linkTooltip: string, foreign: boolean): LedgerSegment[] {
  const copy = messages().hud.settlerPanel;
  if (row.target === null) {
    return [{ text: copy.missing, tone: row.assign === true ? 'missing' : 'muted' }];
  }
  const link = !foreign && row.target.id !== null;
  return [{ text: row.target.label, link, ...(link && linkTooltip !== '' ? { tooltip: linkTooltip } : {}) }];
}

/** The Vehicle value: the vehicle as a link with its hold in the tooltip, or "Assign a vehicle" in amber,
 *  a link that arms the pick while the player may assign one. */
export function vehicleValue(row: SettlerVehicleRow): LedgerSegment[] {
  const copy = messages().hud.settlerPanel;
  if (row.target !== null) return [{ text: row.target.label, link: true, tooltip: row.target.load }];
  return [
    row.assign === true
      ? { text: copy.assignVehicle, link: true, tone: 'missing', tooltip: copy.assignVehicleTooltip }
      : { text: copy.missing, tone: 'muted' },
  ];
}

/** The Family row's button: the rings that send the person to find a partner, faded while a wedding
 *  is under way. */
export function familyButton(family: SettlerFamilyModel): RoundButtonModel | null {
  const find = messages().hud.settlerPanel.noPartnerTooltip;
  return seatButton(family.marry, GLYPH.rings, find, find);
}

/** The Family value: the spouse and the child as links, or "single", a link while the person may go
 *  and find a partner; after them what holds the couple's child order, while something does. */
export function familyValue(family: SettlerFamilyModel): LedgerSegment[] {
  const copy = messages().hud.settlerPanel;
  if (family.partner === null) {
    return [
      family.marry === true
        ? { text: copy.noPartner, link: true, tone: 'missing', tooltip: copy.noPartnerTooltip }
        : { text: copy.noPartner, tone: 'muted' },
    ];
  }
  const people: LedgerSegment[] = [{ text: family.partner.label, link: true, tooltip: copy.partnerTooltip }];
  if (family.child !== null)
    people.push({ text: family.child.label, link: true, tooltip: copy.childTooltip });
  if (family.childOnHold !== null)
    people.push({ text: family.childOnHold.label, tone: 'missing', tooltip: family.childOnHold.tooltip });
  return people;
}

/** Work and family: the workplace, work area, home and vehicle rows with their assign and remove buttons,
 *  and the family. */
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
  const workplaceCard = createHouseCardLink(deps.hoverCard, deps.buildingHover);

  /** The centre button leads a row so the assign and remove columns stay aligned with the other rows. */
  const centreOn = (flag: number | null | undefined): void => {
    if (flag != null) actions.centre(flag);
  };
  const workplace = createLedger({
    buttons: 3,
    onLink: () => {
      const target = current()?.workplace?.target?.id;
      if (target != null) actions.select(target);
    },
    onLinkHover: (_index, event) => workplaceCard.hover(current()?.workplace?.target?.id ?? null, event),
    onButton: (index) => {
      if (index === 0) centreOn(current()?.workplace?.centreFlag);
      else if (index === 1) actions.assignWorkplace(id());
      else actions.unassignWorkplace(id());
    },
  });
  const workArea = createLedger({
    buttons: 3,
    onButton: (index) => {
      if (index === 0) centreOn(current()?.workArea?.flag);
      else if (index === 1) actions.assignWorkArea(id());
      else actions.clearWorkArea(id());
    },
  });
  const buildRun = createLedger({ buttons: 1, onButton: () => actions.endBuildRun(id()) });
  const home = createLedger({
    buttons: 2,
    onLink: () => {
      const target = current()?.home?.target?.id;
      if (target != null) actions.select(target);
    },
    onButton: (index) => (index === 0 ? actions.assignHome(id()) : actions.unassignHome(id())),
  });
  const vehicle = createLedger({
    buttons: 2,
    onLink: () => {
      const row = current()?.vehicle;
      if (row == null) return;
      if (row.target === null) actions.assignVehicle(id());
      else actions.select(row.target.id);
    },
    onButton: (index) => (index === 0 ? actions.assignVehicle(id()) : actions.leaveVehicle(id())),
  });
  const family = createLedger({
    buttons: 1,
    onButton: () => actions.marry(id()),
    onLink: (index) => {
      const model = current()?.family;
      if (model == null) return;
      if (model.partner === null) actions.marry(id());
      else {
        const person = index === 0 ? model.partner : model.child;
        if (person !== null) actions.select(person.id);
      }
    },
  });
  root.append(
    title.element,
    workplace.element,
    workArea.element,
    buildRun.element,
    home.element,
    vehicle.element,
    family.element,
  );

  return {
    element: root,
    update(model): void {
      const copy = messages().hud;
      const panel = copy.settlerPanel;
      title.update(
        model.family !== null ? panel.workAndFamily : model.home !== null ? panel.workAndHome : copy.work,
      );
      workplaceCard.update(model.workplace?.target?.id ?? null);
      setHidden(workplace.element, model.workplace === null);
      if (model.workplace !== null) {
        workplace.update({
          label: panel.workplace,
          // The workplace link shows its hover card alone; a tip would only cover it.
          value: seatValue(model.workplace, '', model.foreign),
          buttons: [
            flagButton(model.workplace.centreFlag),
            seatButton(
              model.workplace.assign,
              model.workplace.flag ? GLYPH.banner : GLYPH.house,
              copy.assignWorkplace,
              model.workplace.flag ? copy.assignWorkplaceFlagHint : copy.assignWorkplaceHint,
            ),
            seatButton(
              model.workplace.remove,
              GLYPH.close,
              copy.unassignWorkplace,
              copy.unassignWorkplaceHint,
            ),
          ],
        });
      }
      setHidden(workArea.element, model.workArea === null);
      if (model.workArea !== null) {
        workArea.update({
          label: panel.workArea,
          value: [{ text: model.workArea.flag !== null ? panel.workAreaFlag : panel.workAreaReach }],
          buttons: [
            flagButton(model.workArea.flag),
            seatButton(model.workArea.assign, GLYPH.banner, panel.assignWorkArea, panel.assignWorkAreaHint),
            seatButton(model.workArea.remove, GLYPH.close, panel.clearWorkArea, panel.clearWorkAreaHint),
          ],
        });
      }
      setHidden(buildRun.element, model.buildRun === null);
      if (model.buildRun !== null) {
        buildRun.update({
          label: panel.buildRun,
          value: [{ text: panel.buildRuns[model.buildRun] }],
          buttons: [seatButton(true, GLYPH.close, panel.endBuildRun, panel.endBuildRunHint)],
        });
      }
      setHidden(home.element, model.home === null);
      if (model.home !== null) {
        home.update({
          label: panel.home,
          value: seatValue(model.home, panel.buildingTooltip, model.foreign),
          buttons: [
            seatButton(model.home.assign, GLYPH.house, copy.assignHome, copy.assignHomeHint),
            seatButton(model.home.remove, GLYPH.close, copy.unassignHome, copy.unassignHomeHint),
          ],
        });
      }
      setHidden(vehicle.element, model.vehicle === null);
      if (model.vehicle !== null) {
        vehicle.update({
          label: panel.vehicle,
          value: vehicleValue(model.vehicle),
          buttons: [
            seatButton(model.vehicle.assign, GLYPH.wheel, panel.assignVehicle, panel.assignVehicleTooltip),
            seatButton(model.vehicle.remove, GLYPH.close, panel.leaveVehicle, panel.leaveVehicle),
          ],
        });
      }
      setHidden(family.element, model.family === null);
      if (model.family !== null) {
        family.update({
          label: panel.family,
          value: familyValue(model.family),
          buttons: [familyButton(model.family)],
        });
      }
    },
  };
}
