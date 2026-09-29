import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { element, setClass, setStyleVar, setTip, write } from '../parts/dom.js';

/** Design px of a good's icon in its well (foundation.css `.on-good-well`), and of an ingredient's. */
const LINE_ICON_PX = 18;
const NEED_ICON_PX = 14;

/** An ingredient beside a product's name: its icon and "have/need", short while the shelf lacks it. */
export interface GoodNeedModel {
  readonly goodId: string | undefined;
  readonly text: string;
  readonly short: boolean;
  readonly tooltip: string;
}

export interface GoodLineModel {
  readonly goodId: string | undefined;
  readonly label: string;
  /** The figure at the right end, and a muted aside after it. */
  readonly value: string;
  readonly aside?: string;
  /** The rule under the line, as a CSS percentage. */
  readonly fill: string;
  readonly tooltip: string;
  /** Faded: a shelf with nothing on it. */
  readonly muted?: boolean;
  /** The line holds the house up: amber for a wait the player can end, red for a halt. */
  readonly tone?: 'warning' | 'danger';
  readonly needs?: readonly GoodNeedModel[];
}

/** One line of a building section: the good's well, its name, a figure, and a thin rule under it that
 *  fills with the line's share (stocked, delivered, crafted). */
export interface GoodLine {
  readonly element: HTMLLIElement;
  update(model: GoodLineModel): void;
}

export function createGoodLine(icons: GoodIconPainter): GoodLine {
  const item = element(
    'li',
    'on-cargo-row on-cargo-row--needs',
    `<span class="on-good-well">${goodIconMarkup(LINE_ICON_PX)}</span><span class="on-cargo-row__name"></span><span class="on-cargo-row__needs"></span><b class="on-cargo-row__now"><span></span><small></small></b>`,
  );
  const frame = item.querySelector('.on-good__frame');
  const name = item.querySelector('.on-cargo-row__name');
  const needs = item.querySelector('.on-cargo-row__needs');
  const value = item.querySelector('.on-cargo-row__now > span');
  const aside = item.querySelector('.on-cargo-row__now > small');
  if (
    !(frame instanceof HTMLElement) ||
    name === null ||
    !(needs instanceof HTMLElement) ||
    value === null ||
    aside === null
  ) {
    throw new Error('building panel: good line');
  }
  let good = '';
  let needGoods = '';
  let needTexts = '';
  let chips: HTMLElement[] = [];

  /** Show the ingredients only when all of them fit beside the name: a part of the list would read
   *  as the whole recipe. A wrapped chip sits below the first; the tooltip still lists them all. */
  const fitNeeds = (): void => {
    const top = chips[0]?.offsetTop;
    setClass(
      needs,
      'on-cargo-row__needs--clipped',
      chips.some((chip) => chip.offsetTop !== top),
    );
  };
  // The name's width and the panel's first layout move the room left; a hidden chip keeps its box.
  let resizes: ResizeObserver | null = null;

  const paintNeeds = (list: readonly GoodNeedModel[]): void => {
    const key = list.map((need) => need.goodId ?? '').join();
    if (key !== needGoods) {
      needGoods = key;
      needTexts = '';
      chips = list.map((need) => {
        const chip = element('span', 'on-need', `${goodIconMarkup(NEED_ICON_PX)}<b></b>`);
        const icon = chip.querySelector('.on-good__frame');
        if (icon instanceof HTMLElement && need.goodId !== undefined) icons(icon, need.goodId, NEED_ICON_PX);
        return chip;
      });
      needs.replaceChildren(...chips);
      if (resizes === null && chips.length > 0) {
        resizes = new ResizeObserver(fitNeeds);
        resizes.observe(needs);
      }
    }
    list.forEach((need, index) => {
      const chip = chips[index];
      const figure = chip?.lastElementChild;
      if (chip === undefined || figure == null) return;
      write(figure, need.text);
      setClass(chip, 'on-need--short', need.short);
      setTip(chip, need.tooltip);
    });
    const texts = list.map((need) => need.text).join();
    if (texts !== needTexts) {
      needTexts = texts;
      fitNeeds();
    }
  };

  return {
    element: item,
    update(model): void {
      const id = model.goodId ?? '';
      if (id !== good) {
        good = id;
        frame.removeAttribute('style');
        if (model.goodId !== undefined) icons(frame, model.goodId, LINE_ICON_PX);
      }
      write(name, model.label);
      paintNeeds(model.needs ?? []);
      write(value, model.value);
      write(aside, model.aside ?? '');
      setStyleVar(item, '--fill', model.fill);
      setTip(item, model.tooltip);
      setClass(item, 'on-cargo-row--out', model.muted === true);
      setClass(item, 'on-cargo-row--warning', model.tone === 'warning');
      setClass(item, 'on-cargo-row--danger', model.tone === 'danger');
    },
  };
}

/** A line's tooltip with the good's carried effect under it, when it has one. */
export function withEffect(tooltip: string, effect: string): string {
  return effect === '' ? tooltip : `${tooltip}\n${effect}`;
}

/** Keep one line per key in `list`, rebuilt only when the keys change; returns the lines in order. */
export function syncLines(
  list: HTMLElement,
  lines: Map<string, GoodLine>,
  keys: readonly string[],
  make: () => GoodLine,
): GoodLine[] {
  const shown = [...lines.keys()];
  const same = keys.length === shown.length && keys.every((key, index) => shown[index] === key);
  if (!same) {
    const next = new Map<string, GoodLine>();
    for (const key of keys) next.set(key, lines.get(key) ?? make());
    lines.clear();
    for (const [key, line] of next) lines.set(key, line);
    list.replaceChildren(...[...lines.values()].map((line) => line.element));
  }
  return [...lines.values()];
}
