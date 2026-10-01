import { formatMessage, messages } from '../../../i18n/index.js';
import type {
  VehicleClass,
  VehicleCrewModel,
  VehiclePanelModel,
  VehicleRiderModel,
} from '../../details-panel/model/index.js';
import { FIGURE, GLYPH } from '../icons.js';
import {
  button,
  element,
  isDisabled,
  onPress,
  setAttribute,
  setClass,
  setDisabled,
  setHidden,
  setTip,
  write,
} from '../parts/dom.js';
import { createFigureWell, type FigureWell, showInWell, type WellFigureFit } from '../parts/figure-well.js';
import { createLedger } from '../parts/ledger.js';
import { createSection } from '../parts/section.js';
import { seatButton } from '../settler-panel/work.js';
import type { VehiclePanelDeps, VehiclePick } from './actions.js';

/** The badge on the commander's well: what it commands. */
const ROLE_GLYPH: Readonly<Record<VehicleClass, string>> = {
  cart: GLYPH.wheel,
  ship: GLYPH.anchor,
  siege: GLYPH.crosshair,
};

/** The commander's well (foundation.css `.on-seat-well--helm`, 40 x 56 design px) shows its rider
 *  larger than a seat does. */
const HELM_FIT: WellFigureFit = { zoom: 0.68, feetInset: 6 };

/** A rider's tooltip: the commander's role and the rider's name, or only the name on an ordinary seat.
 *  Another seat's rider shows its trade in place of the name. */
export function riderTooltip(rider: VehicleRiderModel, foreign: boolean, role: string | null): string {
  const who = foreign ? rider.job : rider.name;
  return role === null ? who : `${role} · ${who}`;
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

/** The commander's well: the rider, or the seat to fill (the seat pick while the player may). */
export function commanderWell(crew: VehicleCrewModel): SeatWell {
  if (crew.commander !== null) return { kind: 'rider', rider: crew.commander };
  return crew.assign === true ? { kind: 'add' } : { kind: 'free' };
}

/** What a press on a well does: select its rider, step the rider out (a Ctrl click), refuse a Ctrl
 *  click where the rider cannot step out, or arm the seat pick; nothing on a free seat or another
 *  seat's vehicle. */
export type WellPress = 'select' | 'leave' | 'refuse' | 'seat' | null;

export function wellPress(
  well: SeatWell,
  model: Pick<VehiclePanelModel, 'foreign' | 'crew'>,
  ctrl: boolean,
): WellPress {
  if (model.foreign) return null;
  if (well.kind === 'add') return 'seat';
  if (well.kind === 'free') return null;
  if (!ctrl) return 'select';
  return model.crew.leave === true ? 'leave' : 'refuse';
}

/** The seat pick's well lights while its pick waits for a settler. */
function lightSeatPick(well: HTMLElement, seating: boolean): void {
  setClass(well, 'on-seat-well--armed', seating && well.classList.contains('on-seat-well--add'));
}

/** A land vehicle's line beside its commander's well: the role, and the trade, the walk to the door
 *  or the seat to fill. */
export function commanderCaption(model: Pick<VehiclePanelModel, 'vehicleClass' | 'crew'>): {
  role: string;
  detail: string;
  missing: boolean;
} {
  const copy = messages().hud.vehiclePanel;
  const role = copy.roles[model.vehicleClass];
  const lead = model.crew.commander;
  if (lead !== null) return { role, detail: lead.inside ? lead.job : copy.walking, missing: false };
  if (model.crew.assign === true) return { role, detail: copy.assignRole[model.vehicleClass], missing: true };
  return { role, detail: messages().hud.settlerPanel.missing, missing: false };
}

/** Załoga: the commander's well, marked out from the rest, with a ship's seats as wells beside it or a
 *  land vehicle's role line; a ship's deck; the count and "Wysadź wszystkich" at the rule's right end.
 *  A click on a rider selects it, a Ctrl click steps it out. */
export interface CrewSection {
  readonly element: HTMLElement;
  update(model: VehiclePanelModel): void;
  /** Once a frame: the seat pick's wells or the deck pick's button light while their pick waits. */
  refresh(armed: VehiclePick | null): void;
  /** The commander's well, then a ship's seats, for the panel's figure painter. */
  wells(): readonly FigureWell[];
}

export function createCrewSection(
  deps: VehiclePanelDeps,
  current: () => VehiclePanelModel | null,
): CrewSection {
  const { actions, vehicle } = deps;
  const count = element('span', 'on-section__count');
  const unload = button('on-more');
  unload.addEventListener('click', () => {
    const model = current();
    if (model !== null && !isDisabled(unload)) vehicle.unloadPeople(model.entityId);
  });
  const controls = element('span', 'on-section__group');
  controls.append(count, unload);
  const title = createSection(controls);
  const helmWell = createFigureWell('on-seat-well on-seat-well--helm', HELM_FIT);
  const helm = helmWell.node;
  const caption = element('span', 'on-crew__caption', '<b></b><span></span>');
  const [roleLine, detailLine] = [caption.firstElementChild, caption.lastElementChild];
  if (!(roleLine instanceof HTMLElement) || !(detailLine instanceof HTMLElement))
    throw new Error('vehicle crew: caption');
  const seats = element('div', 'on-seats');
  const row = element('div', 'on-crew');
  row.append(helm, caption, seats);
  const deck = createLedger({
    buttons: 1,
    onLink: (index) => {
      const carried = current()?.crew.deck?.vehicles[index];
      if (carried !== undefined) actions.select(carried.entity);
    },
    onButton: () => {
      const model = current();
      const carried = model?.crew.deck?.vehicles[0];
      if (model === null || model.crew.deck === null) return;
      if (carried !== undefined) vehicle.unloadVehicle(carried.entity);
      else vehicle.loadVehicle(model.entityId);
    },
  });
  const root = element('div', '');
  root.append(title.element, row, deck.element);

  let helmSeat: SeatWell = { kind: 'free' };
  let wells: FigureWell[] = [];
  let allWells: readonly FigureWell[] = [helmWell];
  let shownWells: SeatWell[] = [];
  const press = (well: SeatWell | undefined, event: MouseEvent): void => {
    const model = current();
    if (model === null || well === undefined) return;
    const rider = well.kind === 'rider' ? well.rider.entity : null;
    switch (wellPress(well, model, event.ctrlKey || event.metaKey)) {
      case 'seat':
        vehicle.seatRider(model.entityId);
        break;
      case 'select':
        if (rider !== null) actions.select(rider);
        break;
      case 'leave':
        if (rider !== null) vehicle.leave(rider);
        break;
      case 'refuse':
        deps.cue('fail');
        break;
      case null:
        break;
    }
  };
  onPress(helm, (event) => press(helmSeat, event));

  const paintWell = (
    well: FigureWell,
    seat: SeatWell,
    model: VehiclePanelModel,
    role: string | null,
  ): void => {
    const copy = messages().hud.vehiclePanel;
    const { node } = well;
    const rider = seat.kind === 'rider' ? seat.rider : null;
    showInWell(well, rider?.entity ?? null);
    const figure = rider === null ? '' : rider.look === 'woman' ? FIGURE.woman : FIGURE.man;
    const face = seat.kind === 'add' ? GLYPH.addPerson : figure;
    const badge = role === null ? '' : `<i class="on-seat-well__badge">${ROLE_GLYPH[model.vehicleClass]}</i>`;
    const markup = face + badge;
    if (node.dataset.face !== markup) {
      node.dataset.face = markup;
      well.glyph.innerHTML = face;
      node.querySelector('.on-seat-well__badge')?.remove();
      if (badge !== '') node.insertAdjacentHTML('beforeend', badge);
    }
    setClass(node, 'on-seat-well--empty', rider === null);
    setClass(node, 'on-seat-well--add', seat.kind === 'add');
    setClass(node, 'on-seat-well--walking', rider !== null && !rider.inside);
    setClass(node, 'on-seat-well--woman', rider?.look === 'woman');
    setClass(node, 'on-seat-well--soldier', rider?.look === 'soldier');
    const empty = role === null ? copy.emptySeat : `${role} · ${messages().hud.settlerPanel.missing}`;
    const seatLabel = role === null ? copy.seat : copy.assignRole[model.vehicleClass];
    const tip =
      rider !== null
        ? riderTooltip(rider, model.foreign, role)
        : seat.kind === 'add'
          ? `${seatLabel} · ${copy.assignTooltip}`
          : typeof model.crew.assign === 'string'
            ? `${empty} · ${model.crew.assign}`
            : empty;
    setTip(node, tip);
    setAttribute(node, 'aria-label', rider?.name ?? (seat.kind === 'add' ? seatLabel : empty));
    // A free seat and another seat's rider only say what they are.
    setDisabled(node, seat.kind === 'free' || (rider !== null && model.foreign));
  };

  const paintSeats = (model: VehiclePanelModel): void => {
    shownWells = seatWells(model.crew);
    if (wells.length !== shownWells.length) {
      wells = shownWells.map((_, index) => {
        const well = createFigureWell('on-seat-well');
        onPress(well.node, (event) => press(shownWells[index], event));
        return well;
      });
      seats.replaceChildren(...wells.map((well) => well.node));
      allWells = [helmWell, ...wells];
    }
    shownWells.forEach((seat, index) => {
      const well = wells[index];
      if (well !== undefined) paintWell(well, seat, model, null);
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
      helmSeat = commanderWell(crew);
      paintWell(helmWell, helmSeat, model, copy.roles[model.vehicleClass]);
      setHidden(caption, ship);
      if (!ship) {
        const line = commanderCaption(model);
        write(roleLine, line.role);
        write(detailLine, line.detail);
        setClass(detailLine, 'on-crew__missing', line.missing);
      }
      setHidden(seats, !ship);
      if (ship) paintSeats(model);
      else for (const well of wells) showInWell(well, null);
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
      lightSeatPick(helm, seating);
      for (const well of wells) lightSeatPick(well.node, seating);
      setClass(deck.element, 'on-ledger--armed', armed === 'loadVehicle');
    },
    wells: () => allWells,
  };
}
