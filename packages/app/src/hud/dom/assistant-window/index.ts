import type { UiCue } from '@open-northland/audio';
import type { HudModel } from '@open-northland/render';
import type { components } from '@open-northland/sim';
import {
  type AssistantGrantId,
  GIVE_SWITCH_GOOD,
  type GiveSwitchId,
  WEAPON_SWITCH_GOOD,
  type WeaponSwitchId,
} from '../../../game/assistant-grant-ids.js';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import type { ToolWindow } from '../../tool-panel/window-shell.js';
import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { FIGURE, GLYPH } from '../icons.js';
import { COUNTER_TENS_STEP, createCounter } from '../parts/counter.js';
import { element, setHidden, setTip, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import { createSwitch } from '../parts/switch.js';
import { attachTipLayer, type TipChip } from '../parts/tip-layer.js';
import { centralWindowPlacer, createHudWindow } from '../window.js';
import {
  type AssistantBookings,
  birthNotes,
  counterFace,
  counterFromFace,
  counterRange,
  NO_BOOKINGS,
  NOTE_TONE,
  PressHold,
  type StatusNote,
  type StatusNoteKey,
  sameCounter,
  trainingNotes,
  weaponStocked,
} from './model.js';

type CounterKind = components.AssistantCounterKind;
type CounterState = components.AssistantCounterState;
type ClassIntent = Exclude<components.AssistantRecruitIntent, 'trainSoldiers'>;

/** Design px: two columns of rows side by side. */
const ASSISTANT_WINDOW_W = 700;
const ROW_ICON_PX = 22;
const SUB_ICON_PX = 18;

/** The sim's counter block for the watched seat, and the command that sets one counter. */
export interface AssistantCountersSeam {
  read(): Readonly<components.AssistantCounterValues>;
  /** False when the write was rejected, which the window must not echo. */
  set(kind: CounterKind, state: CounterState): boolean;
}

/** The sim's switches for the watched seat: a give switch is on when its good is granted, a weapon
 *  switch when its good is not vetoed. */
export interface AssistantSwitchesSeam {
  read(): Readonly<Record<AssistantGrantId, boolean>>;
  set(id: AssistantGrantId, enabled: boolean): boolean;
}

/** Whose assistant the window shows: a seat the player commands, a watched seat's (read only), or nobody's. */
export type AssistantAccess = 'control' | 'watching' | 'noSeat';

/** What the game hands the window: the live state, its commands and the tooltip chip. */
export interface AssistantSource {
  readonly counters: AssistantCountersSeam;
  readonly switches: AssistantSwitchesSeam;
  readonly bookings: () => AssistantBookings;
  readonly access: () => AssistantAccess;
  readonly tooltip: TipChip;
  /** The game's one good-icon painter. */
  readonly paintGood: GoodIconPainter;
}

export interface AssistantWindowDeps extends AssistantSource {
  readonly plane: HTMLElement;
  /** The title art, the beam entry's painted icon. */
  readonly art: string;
  readonly goodTypeOf: (goodId: string) => number | undefined;
  readonly cue: (cue: UiCue) => void;
}

/** The assistant window on the DOM plane: the drain-down orders on the left (births, training), the
 *  standing orders on the right (equipment, work). Like the residents window it routes its own
 *  pointer input, so it claims no canvas point. */
export interface AssistantWindow extends ToolWindow {
  /** Once a frame: re-place an open window and show the live state. */
  refresh(): void;
  /** The tick's stock figures and clock, the same the top bar shows. */
  update(model: HudModel): void;
  onDismiss(listener: () => void): void;
  dispose(): void;
}

/** One weapon class: the weapon it is drawn with, and the switch that lets it settle for a weaker one.
 *  Approximation: the sim arms a class from any weapon of its main type, and these pairs are the two
 *  each class has in the current content; a third weapon would not show in the stock tag. */
interface ClassSpec {
  readonly kind: ClassIntent;
  readonly weapon: string;
  readonly weaker: WeaponSwitchId;
}
const CLASS_SPECS: readonly ClassSpec[] = [
  { kind: 'trainSword', weapon: 'sword_long', weaker: 'allowShortSwords' },
  { kind: 'trainSpear', weapon: 'spear_iron', weaker: 'allowWoodenSpears' },
  { kind: 'trainBow', weapon: 'bow_long', weaker: 'allowShortBows' },
];
/** The glyph each status mark carries. */
const NOTE_GLYPH: Readonly<Record<StatusNoteKey, string>> = {
  expected: GLYPH.cradle,
  needsCouple: GLYPH.heart,
  drilling: GLYPH.house,
  fetchingWeapon: GLYPH.blade,
  needsWeapon: GLYPH.blade,
  needsMen: GLYPH.addPerson,
};
/** Iron tools before wooden ones, as the assistant hands them out. */
const GEAR_ORDER: readonly GiveSwitchId[] = ['giveBoots', 'giveIronTools', 'giveWoodenTools', 'giveMead'];

export function createAssistantWindow(deps: AssistantWindowDeps): AssistantWindow {
  const copy = messages().hud.assistant;
  const locale = bcp47Tag();
  const window = createHudWindow(deps.plane, {
    title: copy.title,
    kicker: copy.kicker,
    art: deps.art,
    closeLabel: messages().hud.shell.close,
    width: ASSISTANT_WINDOW_W,
  });
  window.element.classList.add('on-window--assistant');
  const tips = attachTipLayer(window.element, deps.tooltip);
  const placeWindow = centralWindowPlacer(window, deps.plane, ASSISTANT_WINDOW_W);

  let tick = 0;
  // Indexed only when an open window asks: the model lands every frame, the window is mostly shut.
  let stockLines: HudModel['stocks'] = [];
  let stocks: ReadonlyMap<number, number> | null = null;
  const stockOf = (goodId: string): number => {
    const goodType = deps.goodTypeOf(goodId);
    if (goodType === undefined) return 0;
    stocks ??= new Map(stockLines.map((line) => [line.goodType, line.amount]));
    return stocks.get(goodType) ?? 0;
  };
  let writable = false;
  let liveCounters = deps.counters.read();
  let liveSwitches = deps.switches.read();

  // A press shows at once; the live value takes over when it arrives or the hold runs out.
  const pendingCounters = new PressHold<CounterKind, CounterState>(sameCounter);
  const pendingSwitches = new PressHold<AssistantGrantId, boolean>((a, b) => a === b);
  const counterNow = (kind: CounterKind): CounterState =>
    pendingCounters.shown(kind, liveCounters[kind], tick);
  const switchNow = (id: AssistantGrantId): boolean => pendingSwitches.shown(id, liveSwitches[id], tick);

  const pressCounter = (kind: CounterKind, face: number): void => {
    const next = counterFromFace(counterNow(kind), face);
    if (!deps.counters.set(kind, next)) {
      deps.cue('fail');
      return;
    }
    deps.cue('confirm');
    pendingCounters.hold(kind, next, liveCounters[kind], tick);
    show();
  };
  const pressSwitch = (id: AssistantGrantId, next: boolean): void => {
    if (!deps.switches.set(id, next)) {
      deps.cue('fail');
      return;
    }
    deps.cue('confirm');
    pendingSwitches.hold(id, next, liveSwitches[id], tick);
    show();
  };

  const goodArt = (goodId: string, box: number): { art: HTMLElement; count: HTMLElement } => {
    const art = element('span', 'on-asst-art', `${goodIconMarkup(box)}<b class="on-asst-art__count"></b>`);
    const frame = art.querySelector<HTMLElement>('.on-good__frame');
    const count = art.querySelector<HTMLElement>('.on-asst-art__count');
    if (frame === null || count === null) throw new Error('assistant: good art');
    deps.paintGood(frame, goodId, box);
    return { art, count };
  };
  /** The stock tag turns amber when an order waits on it; its tip then says so. */
  const showStock = (count: HTMLElement, amount: number, wanted: boolean): void => {
    write(count, String(amount));
    const short = wanted && amount === 0;
    count.classList.toggle('is-short', short);
    const holder = count.parentElement;
    if (holder !== null)
      setTip(holder, short ? copy.outOfStock : formatMessage(copy.inStock, { count: amount }));
  };
  const glyphArt = (markup: string): HTMLElement => element('span', 'on-asst-art', markup);

  const noteText = (note: StatusNote): string => {
    if (note.count === null) return copy.notes[note.key].endless;
    return formatMessage(pluralForm(note.count, copy.notes[note.key].counted, locale), { count: note.count });
  };
  /** A row's status as small marks on its label line, a glyph and a count each, so the row keeps its
   *  height whatever the assistant is doing; the sentence is the mark's tip. */
  const statusMarks = (): { marks: HTMLElement; show: (notes: readonly StatusNote[]) => void } => {
    const marks = element('span', 'on-asst-marks');
    let shown: string | null = null;
    return {
      marks,
      show: (notes) => {
        const key = notes.map((n) => `${n.key}:${n.count}`).join('|');
        if (key === shown) return;
        shown = key;
        marks.replaceChildren(
          ...notes.map((note) => {
            const mark = element('span', `on-asst-mark is-${NOTE_TONE[note.key]}`, NOTE_GLYPH[note.key]);
            if (note.count !== null) mark.append(String(note.count));
            setTip(mark, `${noteText(note)}. ${copy.notes[note.key].tip}`);
            return mark;
          }),
        );
      },
    };
  };
  /** The label with the row's status marks after it, on one line. */
  const label = (text: string, tip: string, marks: HTMLElement): HTMLElement => {
    const line = element('span', 'on-asst-row__line');
    const node = element('span', 'on-asst-row__label');
    node.textContent = text;
    setTip(node, tip);
    line.append(node, marks);
    return line;
  };
  const section = (title: string, tip: string): HTMLElement => {
    const s = createSection();
    s.update(title);
    const caption = s.element.firstElementChild;
    if (caption instanceof HTMLElement) setTip(caption, tip);
    return s.element;
  };
  const columnHead = (title: string, tip: string): HTMLElement => {
    const head = element('h3', 'on-asst__kind');
    head.textContent = title;
    setTip(head, tip);
    return head;
  };

  /** Everything a frame re-shows, one closure per row. */
  const updates: (() => void)[] = [];

  const counterRow = (
    kind: CounterKind,
    art: HTMLElement,
    notes: () => readonly StatusNote[],
  ): HTMLElement => {
    const row = element('div', 'on-asst-row on-asst-row--counter');
    const range = counterRange(kind);
    const counter = createCounter(range, (face) => pressCounter(kind, face));
    const status = statusMarks();
    const text = copy.counters[kind];
    const endless = range.unlimited !== undefined;
    const steps = { max: range.max, step: COUNTER_TENS_STEP };
    const lessTip = formatMessage(endless ? copy.lessEndlessTip : copy.lessTip, steps);
    const moreTip = formatMessage(endless ? copy.moreEndlessTip : copy.moreTip, steps);
    row.append(art, label(text.label, text.tip, status.marks), counter.element);
    updates.push(() => {
      counter.update({
        value: counterFace(counterNow(kind)),
        lessLabel: copy.less,
        moreLabel: copy.more,
        lessTooltip: lessTip,
        moreTooltip: moreTip,
        lessEnabled: writable,
        moreEnabled: writable,
      });
      status.show(notes());
    });
    return row;
  };

  const switchRow = (id: AssistantGrantId, art: HTMLElement): { row: HTMLElement; on: () => boolean } => {
    const row = element('div', 'on-asst-row');
    const text = copy.switches[id];
    const control = createSwitch(text.label, text.tip, (next) => pressSwitch(id, next));
    row.append(art, label(text.label, text.tip, element('span', 'on-asst-marks')), control.element);
    updates.push(() => {
      const on = switchNow(id);
      control.update(on, writable);
      row.classList.toggle('on-asst-row--off', !on);
    });
    return { row, on: () => switchNow(id) };
  };

  /** The weaker-weapon switch under a class row, with that weapon's own stock. */
  const weakerSub = (id: WeaponSwitchId): { element: HTMLElement; allowed: () => boolean } => {
    const sub = element('div', 'on-asst-sub');
    const good = WEAPON_SWITCH_GOOD[id];
    const { art, count } = goodArt(good, SUB_ICON_PX);
    const text = copy.switches[id];
    const caption = element('span', 'on-asst-sub__text');
    caption.textContent = text.label;
    setTip(caption, text.tip);
    const control = createSwitch(text.label, text.tip, (next) => pressSwitch(id, next), true);
    sub.append(art, caption, control.element);
    updates.push(() => {
      const on = switchNow(id);
      control.update(on, writable);
      showStock(count, stockOf(good), false);
    });
    return { element: sub, allowed: () => switchNow(id) };
  };

  const access = element('div', 'on-asst__access');
  const columns = element('div', 'on-asst__cols');
  const orders = element('div', 'on-asst__col');
  const standing = element('div', 'on-asst__col');
  columns.append(orders, standing);
  window.body.append(access, columns);

  // The first show() reads them; until then nothing is booked.
  let bookings = NO_BOOKINGS;

  orders.append(columnHead(copy.orders, copy.ordersTip), section(copy.births, copy.birthsTip));
  orders.append(
    counterRow('extraWomen', glyphArt(FIGURE.woman), () =>
      birthNotes(counterNow('extraWomen'), bookings.daughters),
    ),
    counterRow('extraMen', glyphArt(FIGURE.man), () => birthNotes(counterNow('extraMen'), bookings.sons)),
  );

  orders.append(section(copy.military, copy.militaryTip));
  orders.append(
    counterRow('trainSoldiers', glyphArt(GLYPH.banner), () =>
      trainingNotes(counterNow('trainSoldiers'), {
        drilling: bookings.drilling.trainSoldiers,
        arming: 0,
        weaponStocked: null,
      }),
    ),
  );
  for (const spec of CLASS_SPECS) {
    const { art, count } = goodArt(spec.weapon, ROW_ICON_PX);
    const weaker = weakerSub(spec.weaker);
    const stocked = (): boolean =>
      weaponStocked(stockOf(spec.weapon), stockOf(WEAPON_SWITCH_GOOD[spec.weaker]), weaker.allowed());
    const row = counterRow(spec.kind, art, () =>
      trainingNotes(counterNow(spec.kind), {
        drilling: bookings.drilling[spec.kind],
        arming: bookings.arming[spec.kind],
        weaponStocked: stocked(),
      }),
    );
    row.append(weaker.element);
    updates.push(() => {
      const wanted = counterFace(counterNow(spec.kind)) > 0 && !stocked();
      showStock(count, stockOf(spec.weapon), wanted);
    });
    orders.append(row);
  }

  standing.append(columnHead(copy.standing, copy.standingTip), section(copy.equipment, copy.equipmentTip));
  for (const id of GEAR_ORDER) {
    const good = GIVE_SWITCH_GOOD[id];
    const { art, count } = goodArt(good, ROW_ICON_PX);
    const gear = switchRow(id, art);
    updates.push(() => showStock(count, stockOf(good), gear.on()));
    standing.append(gear.row);
  }
  standing.append(section(copy.work, copy.workTip));
  standing.append(
    switchRow('postGraduates', glyphArt(GLYPH.scroll)).row,
    switchRow('moveFlags', glyphArt(GLYPH.pin)).row,
  );

  const show = (): void => {
    const now = deps.access();
    writable = now === 'control';
    write(access, now === 'watching' ? copy.watching : now === 'noSeat' ? copy.noSeat : '');
    setHidden(access, now === 'control');
    liveCounters = deps.counters.read();
    liveSwitches = deps.switches.read();
    bookings = deps.bookings();
    for (const update of updates) update();
  };

  const close = (): void => {
    tips.hide();
    window.close();
  };

  return {
    isOpen: window.isOpen,
    toggle: () => {
      if (window.isOpen()) {
        close();
        return;
      }
      window.open();
      placeWindow();
      show();
    },
    close,
    claims: () => false,
    handleClick: () => false,
    refresh: () => {
      if (!window.isOpen()) return;
      placeWindow();
      show();
      tips.refresh();
    },
    update: (model) => {
      tick = model.tick;
      if (model.stocks === stockLines) return;
      stockLines = model.stocks;
      stocks = null;
    },
    onDismiss: window.onDismiss,
    dispose: () => {
      tips.dispose();
      window.dispose();
    },
  };
}
