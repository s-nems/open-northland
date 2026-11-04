import type { ObserverSeatEntry } from '../../../game/match/observer-seats.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { SeatStanding, SeatStatus } from '../../summary/standings.js';
import { GLYPH } from '../icons.js';
import { setAttribute, write } from '../parts/dom.js';
import { keepTipOnScreen, tipRow } from './breakdown.js';
import { observerSeatColour, observerSeatLabels } from './observer-picker.js';

export interface ObserverStandingsDeps {
  readonly seats: readonly ObserverSeatEntry[];
  /** Owner slot to team-colour slot for the swatches; absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  readonly onWatch: (player: number) => void;
}

/**
 * The spectator's standings strip, shown while it watches no single seat: one chip per seat with its
 * people over its soldiers, read against the strip's leading legend, and the seat's breakdown under
 * the chip on hover or focus. A click on a chip watches that seat.
 */
export interface ObserverStandings {
  readonly element: HTMLElement;
  /** Show the standings as they stand; the same list twice costs nothing. */
  update(standings: readonly SeatStanding[]): void;
  /** Hidden, the strip closes its breakdown. */
  setShown(shown: boolean): void;
  dispose(): void;
}

/** Tip ids run across mounts, so no two strips on one page share an `aria-describedby` id. */
let nextTipId = 0;

interface Chip {
  readonly player: number;
  readonly button: HTMLButtonElement;
  readonly people: HTMLElement;
  readonly soldiers: HTMLElement;
  readonly mark: HTMLElement;
  standing: SeatStanding | null;
}

const MARK_GLYPH: Readonly<Record<SeatStatus, string>> = {
  playing: '',
  empty: '',
  won: GLYPH.star,
  defeated: GLYPH.skull,
};

export function createObserverStandings(deps: ObserverStandingsDeps): ObserverStandings {
  const copy = messages().hud;
  const observerCopy = copy.observer;
  const summaryCopy = copy.summary;
  const labelOf = observerSeatLabels(deps.seats);

  const root = document.createElement('div');
  root.className = 'on-standings';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', observerCopy.standings);

  // The figures' meaning, said once for every chip: the people glyph over the soldiers'.
  const legend = document.createElement('span');
  legend.className = 'on-standings__legend';
  legend.setAttribute('aria-hidden', 'true');
  legend.innerHTML = `${GLYPH.people}${GLYPH.swords}`;
  root.append(legend);

  const tip = document.createElement('div');
  tip.className = 'on-tip on-standings__tip';
  tip.id = `on-standings-tip-${nextTipId++}`;
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const title = document.createElement('h4');
  title.className = 'on-tip__title on-standings__title';
  const titleSwatch = document.createElement('span');
  titleSwatch.className = 'on-seat__swatch';
  const titleName = document.createElement('span');
  title.append(titleSwatch, titleName);
  const SUB = 'on-tip__row--sub';
  const menRow = tipRow(summaryCopy.men);
  const soldiersRow = tipRow(summaryCopy.soldiers, SUB);
  const womenRow = tipRow(summaryCopy.women);
  const childrenRow = tipRow(summaryCopy.children);
  const totalRow = tipRow(summaryCopy.total, 'on-tip__row--total');
  const buildingsRow = tipRow(observerCopy.buildings);
  const status = document.createElement('p');
  status.className = 'on-standings__status';
  const hint = document.createElement('p');
  hint.className = 'on-standings__hint';
  hint.textContent = observerCopy.watchHint;
  tip.append(
    title,
    menRow.row,
    soldiersRow.row,
    womenRow.row,
    childrenRow.row,
    totalRow.row,
    buildingsRow.row,
    status,
    hint,
  );

  let open: Chip | null = null;
  const fillTip = (chip: Chip): void => {
    write(titleName, labelOf(chip.player));
    titleSwatch.style.background = observerSeatColour(chip.player, deps.playerColourOf);
    const standing = chip.standing;
    if (standing === null) return;
    const { people } = standing;
    write(menRow.figure, String(people.men));
    write(soldiersRow.figure, String(people.soldiers));
    write(womenRow.figure, String(people.women));
    write(childrenRow.figure, String(people.children));
    write(totalRow.figure, String(people.total));
    write(buildingsRow.figure, String(standing.buildings));
    const said = standing.status === 'playing' ? '' : observerCopy.status[standing.status];
    write(status, said);
    status.hidden = said === '';
    setAttribute(status, 'data-status', standing.status);
  };
  const show = (chip: Chip | null): void => {
    if (open === chip) return;
    open?.button.setAttribute('aria-expanded', 'false');
    open = chip;
    tip.hidden = chip === null;
    if (chip === null) return;
    chip.button.setAttribute('aria-expanded', 'true');
    fillTip(chip);
    tip.style.left = `${String(chip.button.offsetLeft)}px`;
    keepTipOnScreen(tip);
  };
  const onResize = (): void => {
    if (open !== null) keepTipOnScreen(tip);
  };
  window.addEventListener('resize', onResize);

  const chips = new Map<number, Chip>();
  for (const { player } of deps.seats) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'on-standing';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-describedby', tip.id);
    const swatch = document.createElement('span');
    swatch.className = 'on-standing__swatch';
    swatch.style.background = observerSeatColour(player, deps.playerColourOf);
    const figures = document.createElement('span');
    figures.className = 'on-standing__figures';
    const people = document.createElement('b');
    people.className = 'on-standing__people';
    const soldiers = document.createElement('span');
    soldiers.className = 'on-standing__soldiers';
    figures.append(people, soldiers);
    const mark = document.createElement('span');
    mark.className = 'on-standing__mark';
    button.append(swatch, figures, mark);
    const chip: Chip = { player, button, people, soldiers, mark, standing: null };
    button.addEventListener('mouseenter', () => show(chip));
    button.addEventListener('focus', () => show(chip));
    button.addEventListener('click', () => {
      show(null);
      deps.onWatch(player);
    });
    root.append(button);
    chips.set(player, chip);
  }
  root.append(tip);

  root.addEventListener('mouseleave', () => show(null));
  root.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node && root.contains(next))) show(null);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open !== null) {
      show(null);
      event.stopPropagation();
    }
  });

  const setChip = (chip: Chip, standing: SeatStanding): void => {
    const was = chip.standing;
    chip.standing = standing;
    const { total, soldiers } = standing.people;
    if (was?.people.total === total && was.people.soldiers === soldiers && was.status === standing.status)
      return;
    write(chip.people, String(total));
    write(chip.soldiers, String(soldiers));
    if (was?.status !== standing.status) {
      chip.button.dataset.status = standing.status;
      chip.mark.innerHTML = MARK_GLYPH[standing.status];
    }
    const said = formatMessage(observerCopy.standing, {
      name: labelOf(chip.player),
      people: total,
      soldiers,
    });
    chip.button.setAttribute(
      'aria-label',
      standing.status === 'playing' ? said : `${said}, ${observerCopy.status[standing.status]}`,
    );
  };

  let shown: readonly SeatStanding[] | null = null;
  return {
    element: root,
    update: (standings) => {
      if (standings === shown) return;
      shown = standings;
      for (const standing of standings) {
        const chip = chips.get(standing.player);
        if (chip !== undefined) setChip(chip, standing);
      }
      if (open !== null) fillTip(open);
    },
    setShown: (on) => {
      if (root.hidden === !on) return;
      root.hidden = !on;
      if (!on) show(null);
    },
    dispose: () => {
      window.removeEventListener('resize', onResize);
      root.remove();
    },
  };
}
