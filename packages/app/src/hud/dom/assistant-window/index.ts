import type { UiCue } from '@open-northland/audio';
import type { HudModel } from '@open-northland/render';
import type { components } from '@open-northland/sim';
import {
  type AssistantGrantId,
  AUDIENCE_SWITCH_IDS,
  GIVE_SWITCH_GOODS,
  type GiveSwitchId,
  WEAPON_SWITCH_GOOD,
  type WeaponSwitchId,
} from '../../../game/assistant-grant-ids.js';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import {
  type AssistantShortage,
  type AssistantShortages,
  NO_SHORTAGES,
} from '../../../view/assistant-shortages.js';
import type { ToolWindow } from '../../tool-panel/window-shell.js';
import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { FIGURE, GLYPH } from '../icons.js';
import { COUNTER_TENS_STEP, createCounter } from '../parts/counter.js';
import { element, setHidden, setTip, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import { createSegmented } from '../parts/segmented.js';
import { createSwitch } from '../parts/switch.js';
import { attachTipLayer, type TipChip } from '../parts/tip-layer.js';
import { centralWindowPlacer, createHudWindow } from '../window.js';
import {
  ASSISTANT_WINDOW_WIDE_W,
  type AssistantBookings,
  assistantWindowWidth,
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

const ROW_ICON_PX = 24;
const SUB_ICON_PX = 18;

/** The sim's counter block for the watched seat, and the command that sets one counter. */
export interface AssistantCountersSeam {
  read(): Readonly<components.AssistantCounterValues>;
  /** False when the write was rejected, which the window must not echo. */
  set(kind: CounterKind, state: CounterState): boolean;
}

/** The sim's switches for the watched seat: a give switch is on when its goods are granted, a weapon
 *  switch when its good is not vetoed, and a give switch is soldiers-only when its goods are kept for
 *  fighters. */
export interface AssistantSwitchesSeam {
  read(): Readonly<Record<AssistantGrantId, boolean>>;
  /** False when the write was rejected, which the window must not echo. */
  set(id: AssistantGrantId, enabled: boolean): boolean;
  readSoldiersOnly(): Readonly<Record<GiveSwitchId, boolean>>;
  setSoldiersOnly(id: GiveSwitchId, soldiersOnly: boolean): boolean;
}

/** Whose assistant the window shows: a seat the player commands, a watched seat's (read only), or nobody's. */
export type AssistantAccess = 'control' | 'watching' | 'noSeat';

/** What the game hands the window: the live state, its commands and the tooltip chip. */
export interface AssistantSource {
  readonly counters: AssistantCountersSeam;
  readonly switches: AssistantSwitchesSeam;
  readonly bookings: () => AssistantBookings;
  /** How many men each give switch would still dress, beside the stock it draws on. */
  readonly shortages: () => AssistantShortages;
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
 *  standing orders in two columns on the right (gear and drinks; amulets and work). Like the residents
 *  window it routes its own pointer input, so it claims no canvas point. */
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
const GEAR_ORDER: readonly GiveSwitchId[] = ['giveBoots', 'giveIronTools', 'giveWoodenTools'];
/** The drinks, mead first as the one brewed without a druid, then the potions by what they restore. */
const DRINK_ORDER: readonly GiveSwitchId[] = [
  'giveMead',
  'giveFoodPotions',
  'giveStaminaPotions',
  'giveHealingPotions',
];
/** The amulets: the two that feed a need, then the four for a fight and the road. */
const CHARM_ORDER: readonly GiveSwitchId[] = [
  'giveFoodAmulet',
  'giveStaminaAmulet',
  'giveStrengthAmulet',
  'giveDefenseAmulet',
  'giveCriticalHitAmulet',
  'giveSpeedAmulet',
];
/** A drink or amulet row's one control: off, kept for the soldiers, or handed to everyone. */
type Audience = 'none' | 'soldiers' | 'everyone';
const AUDIENCES: readonly Audience[] = ['none', 'soldiers', 'everyone'];

export function createAssistantWindow(deps: AssistantWindowDeps): AssistantWindow {
  const copy = messages().hud.assistant;
  const locale = bcp47Tag();
  const window = createHudWindow(deps.plane, {
    title: copy.title,
    kicker: copy.kicker,
    art: deps.art,
    closeLabel: messages().hud.shell.close,
    width: ASSISTANT_WINDOW_WIDE_W,
  });
  window.element.classList.add('on-window--assistant');
  const tips = attachTipLayer(window.element, deps.tooltip);
  const placeWindow = centralWindowPlacer(window, deps.plane, assistantWindowWidth);

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
  /** A give switch's stock: every bottle size of a potion counts. */
  const stockOfAll = (goodIds: readonly string[]): number =>
    goodIds.reduce((sum, goodId) => sum + stockOf(goodId), 0);
  let writable = false;
  let liveCounters = deps.counters.read();
  let liveSwitches = deps.switches.read();
  let liveSoldiersOnly = deps.switches.readSoldiersOnly();

  // A press shows at once; the live value takes over when it arrives or the hold runs out.
  const pendingCounters = new PressHold<CounterKind, CounterState>(sameCounter);
  const pendingSwitches = new PressHold<AssistantGrantId, boolean>((a, b) => a === b);
  const pendingSoldiersOnly = new PressHold<GiveSwitchId, boolean>((a, b) => a === b);
  const counterNow = (kind: CounterKind): CounterState =>
    pendingCounters.shown(kind, liveCounters[kind], tick);
  const switchNow = (id: AssistantGrantId): boolean => pendingSwitches.shown(id, liveSwitches[id], tick);
  const soldiersOnlyNow = (id: GiveSwitchId): boolean =>
    pendingSoldiersOnly.shown(id, liveSoldiersOnly[id], tick);
  const audienceNow = (id: GiveSwitchId): Audience =>
    !switchNow(id) ? 'none' : soldiersOnlyNow(id) ? 'soldiers' : 'everyone';

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
  /** The limit goes first, so no civilian is dressed in the tick between it and the grant. */
  const pressAudience = (id: GiveSwitchId, next: Audience): void => {
    const soldiersOnly = next === 'soldiers';
    const on = next !== 'none';
    const written =
      (next === 'none' || deps.switches.setSoldiersOnly(id, soldiersOnly)) && deps.switches.set(id, on);
    if (!written) {
      deps.cue('fail');
      return;
    }
    deps.cue('confirm');
    if (next !== 'none') pendingSoldiersOnly.hold(id, soldiersOnly, liveSoldiersOnly[id], tick);
    pendingSwitches.hold(id, on, liveSwitches[id], tick);
    show();
  };

  /** A good's icon with the stock tag at its foot and, for a give row, the tag of the men still without
   *  it at its head. */
  const goodArt = (
    goodId: string,
    box: number,
  ): { art: HTMLElement; count: HTMLElement; lack: HTMLElement } => {
    const art = element(
      'span',
      'on-asst-art',
      `${goodIconMarkup(box)}<b class="on-asst-art__count"></b><b class="on-asst-art__lack" hidden></b>`,
    );
    const frame = art.querySelector<HTMLElement>('.on-good__frame');
    const count = art.querySelector<HTMLElement>('.on-asst-art__count');
    const lack = art.querySelector<HTMLElement>('.on-asst-art__lack');
    if (frame === null || count === null || lack === null) throw new Error('assistant: good art');
    deps.paintGood(frame, goodId, box);
    return { art, count, lack };
  };
  /** The stock tag turns amber when an order waits on it; its tip then says so. `more` follows the
   *  stock sentence in the art's tip. */
  const showStock = (count: HTMLElement, amount: number, wanted: boolean, more = ''): void => {
    write(count, String(amount));
    const short = wanted && amount === 0;
    count.classList.toggle('is-short', short);
    const holder = count.parentElement;
    if (holder !== null) {
      const stock = short ? copy.outOfStock : formatMessage(copy.inStock, { count: amount });
      setTip(holder, more === '' ? stock : `${stock} ${more}`);
    }
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
  const section = (title: string, tip: string, control?: HTMLElement): HTMLElement => {
    const s = createSection(control);
    s.update(title);
    const caption = s.element.firstElementChild;
    if (caption instanceof HTMLElement) setTip(caption, tip);
    return s.element;
  };
  /** The three audience words once, over the columns the rows' choice dots sit in. */
  const audienceHead = (): HTMLElement => {
    const head = element('span', 'on-asst-audience-head');
    for (const audience of AUDIENCES) {
      const word = element('i', '');
      word.textContent = copy.audience[audience];
      setTip(word, copy.audience[`${audience}Tip`]);
      head.append(word);
    }
    return head;
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
  const standing = element('div', 'on-asst__standing');
  const standingColumns = element('div', 'on-asst__cols');
  const wear = element('div', 'on-asst__col');
  const carry = element('div', 'on-asst__col');
  standingColumns.append(wear, carry);
  columns.append(orders, standing);
  window.body.append(access, columns);

  // The first show() reads them; until then nothing is booked.
  let bookings = NO_BOOKINGS;
  let shortages = NO_SHORTAGES;

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

  /** The sentence on the men a switch would still dress, with the soldiers among them and whether the
   *  stock covers them; empty when nobody lacks it. */
  const shortageText = (shortage: AssistantShortage, lacking: number, amount: number): string => {
    if (lacking === 0) return '';
    const soldiers =
      shortage.soldiersLacking > 0
        ? ` ${formatMessage(pluralForm(shortage.soldiersLacking, copy.shortage.soldiers, locale), { count: shortage.soldiersLacking })}`
        : '';
    const covered = amount < lacking ? copy.shortage.short : copy.shortage.covered;
    return `${formatMessage(copy.shortage.lacking, { count: shortage.lacking })}${soldiers}. ${covered}`;
  };
  /** A give row: the first good's icon with the stock of every good the switch grants and the men its
   *  current choice would still dress (nobody while it is off, the soldiers alone under that choice),
   *  and either an on/off switch or, for a drink and an amulet, the strip choosing who receives it. */
  const giveRow = (id: GiveSwitchId): HTMLElement => {
    const goods = GIVE_SWITCH_GOODS[id];
    const { art, count, lack } = goodArt(goods[0], ROW_ICON_PX);
    const audience = AUDIENCE_SWITCH_IDS.includes(id);
    const gear = audience ? audienceRow(id, art) : switchRow(id, art);
    const lackingNow = (shortage: AssistantShortage): number => {
      if (!gear.on()) return 0;
      return audience && audienceNow(id) === 'soldiers' ? shortage.soldiersLacking : shortage.lacking;
    };
    updates.push(() => {
      const shortage = shortages[id];
      const lacking = lackingNow(shortage);
      const amount = stockOfAll(goods);
      showStock(count, amount, gear.on(), shortageText(shortage, lacking, amount));
      write(lack, String(lacking));
      setHidden(lack, lacking === 0);
    });
    return gear.row;
  };
  const audienceRow = (id: GiveSwitchId, art: HTMLElement): { row: HTMLElement; on: () => boolean } => {
    const row = element('div', 'on-asst-row on-asst-row--audience');
    const text = copy.switches[id];
    const strip = createSegmented(AUDIENCES, `${text.label}: ${copy.audience.label}`, (pick) =>
      pressAudience(id, pick),
    );
    row.append(art, label(text.label, text.tip, element('span', 'on-asst-marks')), strip.element);
    // Dots under the section's audience words: the word and its meaning travel in the tooltip.
    const options = {
      none: { label: '', tooltip: `${copy.audience.none}. ${copy.audience.noneTip}`, enabled: writable },
      everyone: {
        label: '',
        tooltip: `${copy.audience.everyone}. ${copy.audience.everyoneTip}`,
        enabled: writable,
      },
      soldiers: {
        label: '',
        tooltip: `${copy.audience.soldiers}. ${copy.audience.soldiersTip}`,
        enabled: writable,
      },
    };
    updates.push(() => {
      const choice = audienceNow(id);
      for (const option of Object.values(options)) option.enabled = writable;
      strip.update(options, choice);
      row.classList.toggle('on-asst-row--off', choice === 'none');
    });
    return { row, on: () => switchNow(id) };
  };

  standing.append(columnHead(copy.standing, copy.standingTip), standingColumns);
  wear.append(section(copy.equipment, copy.equipmentTip), ...GEAR_ORDER.map(giveRow));
  wear.append(section(copy.drinks, copy.drinksTip, audienceHead()), ...DRINK_ORDER.map(giveRow));
  carry.append(section(copy.charms, copy.charmsTip, audienceHead()), ...CHARM_ORDER.map(giveRow));
  carry.append(section(copy.work, copy.workTip));
  carry.append(
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
    liveSoldiersOnly = deps.switches.readSoldiersOnly();
    bookings = deps.bookings();
    shortages = deps.shortages();
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
