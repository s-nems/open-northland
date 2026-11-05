import type { ObserverSeatEntry } from '../../../game/match/observer-seats.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { SeatArmy, SeatStanding, SeatStatus } from '../../summary/standings.js';
import type { GoodIconPainter } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { element, setAttribute, setHidden, setStyleVar, write } from '../parts/dom.js';
import { goodTipRow, keepTipOnScreen, tipRow } from './breakdown.js';
import { observerSeatColour, observerSeatLabels } from './observer-picker.js';

export interface ObserverStandingsDeps {
  readonly seats: readonly ObserverSeatEntry[];
  /** Owner slot to team-colour slot for the swatches; absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  readonly onWatch: (player: number) => void;
  /** A seat's army over the snapshot shown; asked only while its breakdown is open. */
  readonly army: (player: number) => SeatArmy;
  /** Paints the breakdown's gear icons in the art this game draws with. */
  readonly paintGood: GoodIconPainter;
  /** A good's localized name by string id. */
  readonly goodLabel: (goodId: string) => string;
}

/**
 * The spectator's standings strip, shown while it watches no single seat: one chip per seat, tinted and
 * topped with the seat's colour, with its people over its soldiers, read against the strip's leading
 * legend. On hover or focus the seat's breakdown opens under the chip, its army beside its settlement.
 * A click on a chip watches that seat.
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

/** A gear row's icon, sized to the breakdown's 14 px rows. */
const GEAR_ICON_PX = 18;

/** One row of a good list: a good's count, or a count under a plain label when no good names it. */
interface ListedCount {
  readonly goodId: string | undefined;
  readonly count: number;
}

/** A labelled list of good rows in the breakdown, with an optional muted remainder after them ("no
 *  armour"); the rows are rebuilt only when the listed goods change. */
interface GoodList {
  readonly root: HTMLElement;
  /** Show `counts` and the remainder; the list hides when it shows nothing. */
  fill(counts: readonly ListedCount[], rest: number): void;
}

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
  tip.className = 'on-tip on-tip--wide on-standings__tip';
  tip.id = `on-standings-tip-${nextTipId++}`;
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const title = document.createElement('h4');
  title.className = 'on-tip__title on-standings__title';
  const titleSwatch = document.createElement('span');
  titleSwatch.className = 'on-seat__swatch';
  const titleName = document.createElement('span');
  title.append(titleSwatch, titleName);

  const goodList = (
    className: string,
    label: string | null,
    restLabel: string | null,
    unnamedLabel = '',
  ): GoodList => {
    const root = element('div', className);
    if (label !== null) {
      const heading = element('p', 'on-standings__group-label');
      heading.textContent = label;
      root.append(heading);
    }
    const rows = element('div', '');
    root.append(rows);
    const rest = restLabel === null ? null : tipRow(restLabel, 'on-standings__rest');
    if (rest !== null) root.append(rest.row);
    let keys: readonly (string | undefined)[] = [];
    let figures: HTMLElement[] = [];
    return {
      root,
      fill: (counts, left) => {
        const same = keys.length === counts.length && counts.every((c, i) => c.goodId === keys[i]);
        if (!same) {
          keys = counts.map((c) => c.goodId);
          const made = counts.map(({ goodId }) =>
            goodId === undefined
              ? tipRow(unnamedLabel)
              : goodTipRow(deps.goodLabel(goodId), goodId, deps.paintGood, GEAR_ICON_PX),
          );
          rows.replaceChildren(...made.map((m) => m.row));
          figures = made.map((m) => m.figure);
        }
        counts.forEach((c, i) => {
          const figure = figures[i];
          if (figure !== undefined) write(figure, String(c.count));
        });
        if (rest !== null) {
          write(rest.figure, String(left));
          setHidden(rest.row, left === 0);
        }
        setHidden(root, counts.length === 0 && left === 0);
      },
    };
  };
  const section = (heading: string): HTMLElement => {
    const root = element('section', 'on-standings__section');
    const label = element('h5', 'on-standings__heading');
    label.textContent = heading;
    root.append(label);
    return root;
  };

  // The army: the head-counts first, then what the soldiers wield, wear and carry.
  const army = section(observerCopy.army);
  const soldiersRow = tipRow(observerCopy.soldiers, 'on-standings__lead');
  const GEAR = 'on-standings__group';
  const siege = goodList('on-standings__units', null, null, observerCopy.siegeEngines);
  const weapons = goodList(GEAR, observerCopy.weapons, observerCopy.unarmed);
  const armour = goodList(GEAR, observerCopy.armour, observerCopy.unarmoured);
  const carried = goodList(GEAR, observerCopy.carried, null);
  army.append(soldiersRow.row, siege.root, weapons.root, armour.root, carried.root);

  // The settlement: the people outside the army, everyone together, and the buildings.
  const settlement = section(observerCopy.settlement);
  const workersRow = tipRow(observerCopy.workers);
  const womenRow = tipRow(summaryCopy.women);
  const childrenRow = tipRow(summaryCopy.children);
  const totalRow = tipRow(observerCopy.population, 'on-tip__row--total');
  const buildingsRow = tipRow(observerCopy.buildings);
  settlement.append(workersRow.row, womenRow.row, childrenRow.row, totalRow.row, buildingsRow.row);

  const columns = element('div', 'on-tip__columns on-standings__columns');
  columns.append(army, settlement);
  const status = document.createElement('p');
  status.className = 'on-standings__status';
  const hint = document.createElement('p');
  hint.className = 'on-standings__hint';
  hint.textContent = observerCopy.watchHint;
  tip.append(title, columns, status, hint);

  let open: Chip | null = null;
  const fillTip = (chip: Chip): void => {
    write(titleName, labelOf(chip.player));
    titleSwatch.style.background = observerSeatColour(chip.player, deps.playerColourOf);
    const standing = chip.standing;
    if (standing === null) return;
    const { people } = standing;
    const forces = deps.army(chip.player);
    write(soldiersRow.figure, String(forces.soldiers));
    siege.fill(forces.siege, 0);
    weapons.fill(forces.weapons, forces.unarmed);
    armour.fill(forces.armour, forces.unarmoured);
    carried.fill(forces.carried, 0);
    write(workersRow.figure, String(people.workers));
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
    setStyleVar(button, '--seat', observerSeatColour(player, deps.playerColourOf));
    const swatch = document.createElement('span');
    swatch.className = 'on-standing__swatch';
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
