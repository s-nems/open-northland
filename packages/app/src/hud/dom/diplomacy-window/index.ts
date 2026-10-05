import type { UiCue } from '@open-northland/audio';
import type { DiplomacyState } from '@open-northland/sim';
import { formatMessage, messages, tribeName } from '../../../i18n/index.js';
import type { ToolWindow } from '../../tool-panel/window-shell.js';
import type { GoodIconPainter } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { createNoticeArt } from '../notice-art.js';
import { button, element, setAttribute, setClass, setHidden, setStyleVar, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import { attachTipLayer, type TipChip } from '../parts/tip-layer.js';
import { centralWindowPlacer, createHudWindow } from '../window.js';
import { createOffers, createTributes } from './details.js';
import type { NationEmblemPainter } from './emblems.js';
import { type DiplomacyPanelRow, type DiplomacySource, resolveSelectedPlayer } from './model.js';
import { DiplomacyOrders } from './orders.js';

const WIDTH = 820;
const STANCES: readonly DiplomacyState[] = ['friend', 'neutral', 'enemy'];
const STANCE_ART = {
  friend: { glyph: 'shield', tint: 0xa9bd8b },
  neutral: { glyph: 'banner', tint: 0xc9a262 },
  enemy: { glyph: 'swords', tint: 0xce765d },
} as const;

export interface DiplomacyWindowDeps {
  readonly plane: HTMLElement;
  readonly source: DiplomacySource;
  readonly art: string;
  readonly paintGood: GoodIconPainter;
  readonly paintEmblem: NationEmblemPainter;
  readonly tooltip: TipChip;
  readonly cue: (cue: UiCue) => void;
}

export interface DiplomacyWindow extends ToolWindow {
  refresh(): void;
  state(): number | null;
  restore(player: number | null): void;
  onDismiss(listener: () => void): void;
  dispose(): void;
}

interface NationView {
  readonly button: HTMLButtonElement;
  readonly name: HTMLElement;
  readonly stance: HTMLElement;
  readonly tribute: HTMLElement;
  readonly emblem: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  identity: string;
}

export function createDiplomacyWindow(deps: DiplomacyWindowDeps): DiplomacyWindow {
  const copy = messages().hud.diplomacyWindow;
  const window = createHudWindow(deps.plane, {
    title: messages().hud.diplomacy,
    art: deps.art,
    closeLabel: messages().hud.shell.close,
    width: WIDTH,
  });
  window.element.classList.add('on-window--diplomacy');
  window.body.classList.add('on-window__body--column');
  window.body.classList.add('on-dip-body');
  const place = centralWindowPlacer(window, deps.plane, WIDTH);
  const tips = attachTipLayer(window.element, deps.tooltip);
  const layout = element('div', 'on-dip-layout');
  const nav = element('nav', 'on-dip-nav');
  setAttribute(nav, 'aria-label', copy.nations);
  const count = element('p', 'on-dip-nav__heading');
  const list = element('div', 'on-dip-list');
  nav.append(count, list);
  const detail = element('section', 'on-dip-detail');
  const identity = element('div', 'on-dip-identity');
  const portrait = element('span', 'on-dip-emblem', GLYPH.banner);
  const portraitCanvas = element('canvas', '');
  portraitCanvas.setAttribute('aria-hidden', 'true');
  portrait.append(portraitCanvas);
  const title = element('h3', '');
  const tribe = element('p', 'on-dip-note');
  const naming = element('div', '');
  naming.append(title, tribe);
  identity.append(portrait, naming);
  const relationHeading = createSection();
  relationHeading.update(copy.attitude);
  const theirs = element('div', 'on-dip-relation');
  const theirLabel = element('span', '');
  write(theirLabel, copy.theirs);
  const theirState = element('strong', 'on-dip-status');
  theirs.append(theirLabel, theirState);
  const ourLabel = element('p', 'on-dip-our-label');
  write(ourLabel, copy.ours);
  const stances = element('div', 'on-dip-stances');
  setAttribute(stances, 'role', 'group');
  setAttribute(stances, 'aria-label', copy.ours);
  const blocked = element('p', 'on-dip-note');
  const warning = element('p', 'on-dip-note on-dip-warning');
  write(warning, copy.hostile);
  const feedback = element('p', 'on-dip-feedback');
  setAttribute(feedback, 'role', 'status');
  const empty = element('p', 'on-dip-empty');
  write(empty, messages().hud.diplomacyNoneMet);
  const tally = element('p', 'on-dip-note');
  let selected: number | null = null;
  let rows: readonly DiplomacyPanelRow[] = [];
  let row: DiplomacyPanelRow | undefined;
  let paintedPlayer: number | null = null;
  let portraitKey = '';
  let rosterKey = '';
  let viewer = deps.source.viewer();
  let nations = new Map<number, NationView>();
  let disposed = false;
  const orders = new DiplomacyOrders(deps.source, () => {
    if (!disposed) refresh();
  });
  const tributeList = createTributes(deps.paintGood, (slot) => {
    if (row === undefined) return;
    deps.cue('confirm');
    orders.pay(row, slot);
  });
  const offers = createOffers(deps.paintGood);
  const stanceArt = createNoticeArt();
  const stanceButtons = new Map(
    STANCES.map((state) => {
      const control = button('on-dip-stance');
      const art = element('span', 'on-dip-stance__art', GLYPH[STANCE_ART[state].glyph]);
      const canvas = element('canvas', '');
      canvas.setAttribute('aria-hidden', 'true');
      const fallback = art.firstChild;
      if (
        stanceArt?.paint(canvas, STANCE_ART[state].glyph, STANCE_ART[state].tint, () => {
          if (fallback !== null) art.replaceChildren(fallback);
        })
      )
        art.replaceChildren(canvas);
      control.append(art);
      const label = element('span', '');
      write(label, copy.stances[state]);
      control.append(label);
      control.dataset.stance = state;
      control.addEventListener('click', () => {
        if (row === undefined || control.disabled || orders.stance(row) === state) return;
        deps.cue('confirm');
        orders.declare(row, state);
      });
      stances.append(control);
      return [state, control] as const;
    }),
  );
  detail.append(
    identity,
    relationHeading.element,
    theirs,
    ourLabel,
    stances,
    blocked,
    warning,
    tributeList.element,
    offers.element,
    tally,
  );
  layout.append(nav, detail);
  window.body.append(layout, empty, feedback);

  function paintEmblem(
    node: HTMLElement,
    canvas: HTMLCanvasElement,
    nation: DiplomacyPanelRow,
    size: number,
  ): void {
    const drawn = nation.tribe !== undefined && deps.paintEmblem(canvas, nation.tribe, nation.player, size);
    setClass(node, 'on-dip-emblem--drawn', drawn);
    setStyleVar(node, '--nation-colour', `#${nation.colour.toString(16).padStart(6, '0')}`);
  }

  function createNation(nation: DiplomacyPanelRow): NationView {
    const control = button('on-dip-nation');
    control.dataset.player = String(nation.player);
    const emblem = element('span', 'on-dip-emblem', GLYPH.banner);
    const canvas = element('canvas', '');
    canvas.setAttribute('aria-hidden', 'true');
    emblem.append(canvas);
    const name = element('strong', '');
    const stance = element('small', '');
    const tribute = element('small', 'on-dip-nation__tribute');
    const text = element('span', 'on-dip-nation__text');
    text.append(name, stance, tribute);
    control.append(emblem, text);
    control.addEventListener('click', () => {
      selected = nation.player;
      deps.cue('confirm');
      refresh();
    });
    return { button: control, name, stance, tribute, emblem, canvas, identity: '' };
  }

  function refresh(): void {
    if (!window.isOpen()) return;
    place();
    tips.refresh();
    if (viewer !== deps.source.viewer()) {
      viewer = deps.source.viewer();
      selected = null;
      orders.clear();
    }
    rows = deps.source.rows();
    orders.reconcile(rows);
    selected = resolveSelectedPlayer(rows, selected);
    const key = rows.map((r) => r.player).join(',');
    if (rosterKey !== key) {
      const focused = [...nations.entries()].find(([, view]) => view.button === document.activeElement)?.[0];
      rosterKey = key;
      nations = new Map(rows.map((r) => [r.player, nations.get(r.player) ?? createNation(r)]));
      list.replaceChildren(...[...nations.values()].map((view) => view.button));
      if (focused !== undefined) {
        (nations.get(focused) ?? nations.get(selected ?? -1))?.button.focus({ preventScroll: true });
      }
    }
    write(count, `${copy.nations} · ${rows.length}`);
    for (const nation of rows) {
      const view = nations.get(nation.player);
      if (view === undefined) continue;
      write(view.name, nation.name ?? `${messages().hud.player} ${nation.player}`);
      write(view.stance, copy.stances[nation.towardYou]);
      setAttribute(view.stance, 'data-stance', nation.towardYou);
      write(view.tribute, nation.tributes.length > 0 ? `${copy.tributes}: ${nation.tributes.length}` : '');
      setHidden(view.tribute, nation.tributes.length === 0);
      setAttribute(view.button, 'aria-current', String(nation.player === selected));
      const identity = `${nation.tribe}:${nation.colour}`;
      if (view.identity !== identity) {
        view.identity = identity;
        paintEmblem(view.emblem, view.canvas, nation, 52);
      }
    }
    row = rows.find((r) => r.player === selected);
    setHidden(layout, row === undefined);
    setHidden(empty, row !== undefined);
    write(feedback, orders.failed ? copy.failed : '');
    setHidden(feedback, !orders.failed);
    if (row === undefined) return;
    write(title, row.name ?? `${messages().hud.player} ${row.player}`);
    write(tribe, row.tribe === undefined ? '' : tribeName(row.tribe));
    const emblemKey = `${row.player}:${row.tribe}:${row.colour}`;
    if (portraitKey !== emblemKey) {
      portraitKey = emblemKey;
      paintEmblem(portrait, portraitCanvas, row, 64);
    }
    write(theirState, copy.stances[row.towardYou]);
    setAttribute(theirState, 'data-stance', row.towardYou);
    for (const [state, control] of stanceButtons) {
      setAttribute(control, 'aria-pressed', String(orders.stance(row) === state));
      control.disabled = !row.canDeclare || orders.declaring(row.player);
    }
    write(blocked, row.blocked === undefined ? '' : copy.blocked[row.blocked]);
    setHidden(blocked, row.blocked === undefined);
    setHidden(warning, row.towardYou !== 'enemy' || orders.stance(row) === 'enemy');
    tributeList.update(row.tributes, (slot) => orders.paying(slot), row.blocked === 'observer');
    offers.update(row.tradeOffers, row.yourStance === 'friend');
    write(tally, row.goodsTraded === undefined ? '' : formatMessage(copy.traded, { count: row.goodsTraded }));
    setHidden(tally, row.goodsTraded === undefined);
    if (paintedPlayer !== selected) {
      paintedPlayer = selected;
      detail.scrollTop = 0;
      layout.scrollTop = 0;
    }
  }

  const close = (): void => {
    tips.hide();
    window.close();
  };
  window.onDismiss(() => tips.hide());
  return {
    isOpen: window.isOpen,
    close,
    toggle: () => {
      if (window.isOpen()) close();
      else {
        window.open();
        refresh();
        nations.get(selected ?? -1)?.button.focus({ preventScroll: true });
      }
    },
    claims: () => false,
    handleClick: () => false,
    refresh,
    state: () => selected,
    restore: (player) => {
      selected = player;
      refresh();
    },
    onDismiss: window.onDismiss,
    dispose: () => {
      disposed = true;
      orders.clear();
      tips.dispose();
      window.dispose();
    },
  };
}
