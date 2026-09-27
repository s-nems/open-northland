import { formatMessage, messages } from '../../../i18n/index.js';
import type {
  VehicleCrewModel,
  VehiclePanelModel,
  VehicleRiderModel,
} from '../../details-panel/model/index.js';
import { FIGURE, GLYPH } from '../icons.js';
import {
  button,
  element,
  isDisabled,
  setAttribute,
  setClass,
  setDisabled,
  setHidden,
  setTip,
  write,
} from '../parts/dom.js';
import { createLedger, type LedgerSegment } from '../parts/ledger.js';
import { createSection } from '../parts/section.js';
import { seatButton } from '../settler-panel/work.js';
import type { VehiclePanelDeps, VehiclePick } from './actions.js';

/** A rider's tooltip: who, what trade, and whether it still walks to the door. */
export function riderTooltip(rider: VehicleRiderModel, foreign: boolean): string {
  const copy = messages().hud.vehiclePanel;
  if (foreign) return rider.job;
  return formatMessage(rider.inside ? copy.rider : copy.riderWalking, { name: rider.name, job: rider.job });
}

/** The commander row's value: the rider as a link ("idzie" while it walks to the door), or the seat to
 *  fill in amber, a link that arms the pick while the player may. */
export function commanderValue(
  model: Pick<VehiclePanelModel, 'vehicleClass' | 'foreign' | 'crew'>,
): LedgerSegment[] {
  const copy = messages().hud.vehiclePanel;
  const crew = model.crew;
  const lead = crew.commander;
  if (lead !== null) {
    const name: LedgerSegment = model.foreign
      ? { text: lead.name }
      : { text: lead.name, link: true, tooltip: riderTooltip(lead, false) };
    return lead.inside ? [name] : [name, { text: copy.walking, tone: 'muted' }];
  }
  return [
    crew.assign === true
      ? {
          text: copy.assignRole[model.vehicleClass],
          link: true,
          tone: 'missing',
          tooltip: copy.assignTooltip,
        }
      : { text: messages().hud.settlerPanel.missing, tone: 'muted' },
  ];
}

/** Which wells a ship's seat grid shows: the riders, the first free seat as the seat pick while the
 *  player may seat someone, and plain free seats. */
export type SeatWell =
  | { readonly kind: 'rider'; readonly rider: VehicleRiderModel }
  | { readonly kind: 'add' }
  | { readonly kind: 'free' };

export function seatWells(crew: VehicleCrewModel): SeatWell[] {
  let offered = crew.assign !== true || crew.commander === null;
  return crew.seats.map((seat): SeatWell => {
    if (seat !== null) return { kind: 'rider', rider: seat };
    if (offered) return { kind: 'free' };
    offered = true;
    return { kind: 'add' };
  });
}

/** Załoga: the commander on its ledger row, a ship's seats as wells and its deck; the count and "Wysadź
 *  wszystkich" at the rule's right end. */
export interface CrewSection {
  readonly element: HTMLElement;
  update(model: VehiclePanelModel): void;
  /** Once a frame: the seat pick's controls or the deck pick's button light while their pick waits. */
  refresh(armed: VehiclePick | null): void;
}

export function createCrewSection(
  deps: VehiclePanelDeps,
  current: () => VehiclePanelModel | null,
): CrewSection {
  const { actions, vehicle } = deps;
  const shown = (): VehiclePanelModel | null => current();
  const count = element('span', 'on-section__count');
  const unload = button('on-more');
  unload.addEventListener('click', () => {
    const model = shown();
    if (model !== null && !isDisabled(unload)) vehicle.unloadPeople(model.entityId);
  });
  const controls = element('span', 'on-section__group');
  controls.append(count, unload);
  const title = createSection(controls);
  const commander = createLedger({
    buttons: 1,
    onLink: () => {
      const model = shown();
      if (model === null) return;
      const lead = model.crew.commander;
      if (lead !== null) actions.select(lead.entity);
      else if (model.crew.assign === true) vehicle.seatRider(model.entityId);
    },
    onButton: () => {
      const model = shown();
      if (model === null) return;
      const lead = model.crew.commander;
      if (lead !== null) vehicle.leave(lead.entity);
      else vehicle.seatRider(model.entityId);
    },
  });
  const seats = element('div', 'on-seats');
  const deck = createLedger({
    buttons: 1,
    onLink: (index) => {
      const carried = shown()?.crew.deck?.vehicles[index];
      if (carried !== undefined) actions.select(carried.entity);
    },
    onButton: () => {
      const model = shown();
      const carried = model?.crew.deck?.vehicles[0];
      if (model === null || model.crew.deck === null) return;
      if (carried !== undefined) vehicle.unloadVehicle(carried.entity);
      else vehicle.loadVehicle(model.entityId);
    },
  });
  const root = element('div', '');
  root.append(title.element, commander.element, seats, deck.element);

  let wells: HTMLButtonElement[] = [];
  let shownWells: SeatWell[] = [];
  const pressWell = (index: number): void => {
    const model = shown();
    const well = shownWells[index];
    if (model === null || well === undefined) return;
    if (well.kind === 'rider') actions.select(well.rider.entity);
    else if (well.kind === 'add') vehicle.seatRider(model.entityId);
  };
  const paintSeats = (model: VehiclePanelModel): void => {
    const copy = messages().hud.vehiclePanel;
    shownWells = seatWells(model.crew);
    if (wells.length !== shownWells.length) {
      wells = shownWells.map((_, index) => {
        const well = button('on-seat-well');
        well.addEventListener('click', () => pressWell(index));
        return well;
      });
      seats.replaceChildren(...wells);
    }
    shownWells.forEach((seat, index) => {
      const well = wells[index];
      if (well === undefined) return;
      const face =
        seat.kind === 'rider'
          ? seat.rider.look === 'woman'
            ? FIGURE.woman
            : FIGURE.man
          : seat.kind === 'add'
            ? GLYPH.addPerson
            : '';
      if (well.dataset.face !== face) {
        well.dataset.face = face;
        well.innerHTML = face;
      }
      const rider = seat.kind === 'rider' ? seat.rider : null;
      setClass(well, 'on-seat-well--empty', rider === null);
      setClass(well, 'on-seat-well--add', seat.kind === 'add');
      setClass(well, 'on-seat-well--walking', rider !== null && !rider.inside);
      setClass(well, 'on-seat-well--woman', rider?.look === 'woman');
      setClass(well, 'on-seat-well--soldier', rider?.look === 'soldier');
      const tip =
        rider !== null
          ? riderTooltip(rider, model.foreign)
          : seat.kind === 'add'
            ? `${copy.seat} · ${copy.assignTooltip}`
            : copy.emptySeat;
      setTip(well, tip);
      setAttribute(well, 'aria-label', rider?.name ?? (seat.kind === 'add' ? copy.seat : copy.emptySeat));
      // A free seat and another seat's rider only say what they are.
      setDisabled(well, seat.kind === 'free' || (rider !== null && model.foreign));
    });
  };

  return {
    element: root,
    update(model): void {
      const copy = messages().hud.vehiclePanel;
      const crew = model.crew;
      title.update(copy.crew);
      const ship = crew.seats.length > 0;
      setHidden(count, !ship);
      write(count, `${crew.count} / ${crew.capacity}`);
      setTip(count, copy.seatCount);
      setHidden(unload, !ship || crew.unload === null);
      write(unload, copy.unloadAll);
      setDisabled(unload, crew.unload !== true);
      setTip(unload, crew.unload === true ? copy.unloadAllTooltip : (crew.unload ?? ''));
      const lead = crew.commander;
      commander.update({
        label: copy.roles[model.vehicleClass],
        value: commanderValue(model),
        buttons: [
          lead !== null
            ? seatButton(
                crew.leave,
                GLYPH.close,
                formatMessage(copy.leave, { name: lead.name }),
                formatMessage(copy.leave, { name: lead.name }),
              )
            : seatButton(
                crew.assign,
                GLYPH.addPerson,
                copy.assignRole[model.vehicleClass],
                copy.assignTooltip,
              ),
        ],
      });
      setHidden(seats, !ship);
      if (ship) paintSeats(model);
      const hold = crew.deck;
      setHidden(deck.element, hold === null);
      if (hold !== null) {
        const carried = hold.vehicles[0];
        deck.update({
          label: copy.deck,
          value:
            carried === undefined
              ? [{ text: copy.deckEmpty, tone: 'muted' }]
              : hold.vehicles.map((v) => ({
                  text: v.label,
                  link: true,
                  tooltip: formatMessage(copy.deckSelect, { vehicle: v.label }),
                })),
          buttons: [
            carried === undefined
              ? seatButton(
                  crew.load,
                  GLYPH.boardShip,
                  copy.deckLoad,
                  `${copy.deckLoad} · ${copy.deckLoadTooltip}`,
                )
              : seatButton(
                  crew.unloadVehicle,
                  GLYPH.leaveShip,
                  formatMessage(copy.deckUnload, { vehicle: carried.label }),
                  formatMessage(copy.deckUnload, { vehicle: carried.label }),
                ),
          ],
        });
      }
    },
    refresh(armed): void {
      const seating = armed === 'seatRider';
      setClass(commander.element, 'on-ledger--armed', seating);
      for (const well of wells)
        setClass(well, 'on-seat-well--armed', seating && well.classList.contains('on-seat-well--add'));
      setClass(deck.element, 'on-ledger--armed', armed === 'loadVehicle');
    },
  };
}
