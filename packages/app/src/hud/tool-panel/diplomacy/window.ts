import type { DiplomacyState } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import { messages } from '../../../i18n/index.js';
import { contains } from '../../geometry.js';
import type { PanelContext } from '../context.js';
import {
  clearFills,
  paintTitledTabWindow,
  paintWindowTabs,
  standardWindowWidth,
  type TitledTab,
  type WindowLayers,
} from '../window-family/index.js';
import { createWindowShell, type ToolWindow } from '../window-shell.js';
import { createDiplomacyBody, diplomacyPlayerLabel } from './body.js';
import {
  type DiplomacyPanelRow,
  hitTestDiplomacyWindow,
  layoutDiplomacyWindow,
  resolveSelectedPlayer,
  tradeSectionRows,
} from './model.js';
import { type FittedDiplomacyWindow, fitDiplomacyWindow } from './viewport.js';

const TITLE_STRING_ID = 350;
/** The scroll track's inset from the window's right edge, its width and the thumb's least height
 *  (design px): inside the family's side pad, so the track never covers a card's edge. */
const TRACK_INSET = 6;
const TRACK_W = 4;
const THUMB_MIN_H = 12;
const TRACK_FILL = 0x493922;
const THUMB_FILL = 0xc9a75c;
/** One wheel notch scrolls the body this far (design px). */
const WHEEL_STEP = 36;

const scrollTrack = (layout: FittedDiplomacyWindow, scale: number) => ({
  x: layout.window.x + layout.window.w - TRACK_INSET * scale,
  y: layout.viewport.y,
  w: TRACK_W * scale,
  h: layout.viewport.h,
});

export interface DiplomacyWindowDeps {
  readonly ctx: PanelContext;
  readonly container: Container;
  /** One row per discovered player, viewer excluded. Pulled only while the window is open. */
  readonly rows: () => readonly DiplomacyPanelRow[];
  /** A live pay button was pressed; the rows show the payment once the sim applied it. */
  readonly onPayTribute?: (slot: number) => void;
  /** A stance button was pressed for the selected player; the rows show the stance once the sim
   *  applied it. */
  readonly onDeclareDiplomacy?: (player: number, state: DiplomacyState) => void;
}

/** The pop-up diplomacy window; per-frame refresh rebuilds only when the rows or selection changed. */
export interface DiplomacyWindow extends ToolWindow {
  refresh(): void;
  handleWheel(x: number, y: number, deltaY: number): boolean;
  state(): number | null;
  restore(player: number | null): void;
}

export function createDiplomacyWindow(deps: DiplomacyWindowDeps): DiplomacyWindow {
  const { ctx } = deps;
  const { scale } = ctx;
  const shell = createWindowShell(deps.container);
  const back = new Container();
  shell.container.addChildAt(back, 0); // behind the shell's frame Graphics
  const layers: WindowLayers = {
    ctx,
    container: shell.container,
    back,
    graphics: shell.graphics,
    runs: shell.runs,
  };
  const bodyShell = createWindowShell(shell.container);
  const bodyBack = new Container();
  bodyShell.container.addChildAt(bodyBack, 0);
  const mask = new Graphics();
  shell.container.addChild(mask);
  bodyShell.container.mask = mask;
  const bodyLayers: WindowLayers = {
    ctx,
    container: bodyShell.container,
    back: bodyBack,
    graphics: bodyShell.graphics,
    runs: bodyShell.runs,
  };
  const body = createDiplomacyBody(bodyLayers);

  let selected: number | null = null;
  let layout: FittedDiplomacyWindow | null = null;
  let key = '';
  let scroll = 0;

  const rebuildKey = (rows: readonly DiplomacyPanelRow[], chosen: number | null): string =>
    JSON.stringify([
      rows.map((r) => [
        r.player,
        r.name ?? null,
        r.colour,
        r.towardYou,
        r.yourStance,
        r.canDeclare,
        r.goodsTraded ?? null,
        r.tradeOffers,
        r.tributes.map((t) => [
          t.slot,
          t.text ?? null,
          t.payable,
          t.demands.map((d) => [d.label, d.amount, d.onHand]),
        ]),
      ]),
      chosen,
      ctx.screen(),
      ctx.overlayReserve?.(),
    ]);

  const clear = (): void => {
    shell.clear();
    clearFills(back);
    body.clear();
    bodyShell.clear();
    clearFills(bodyBack);
    mask.clear();
  };

  const rebuild = (rows: readonly DiplomacyPanelRow[]): void => {
    clear();
    selected = resolveSelectedPlayer(rows, selected);
    key = rebuildKey(rows, selected);
    const selectedRow = rows.find((r) => r.player === selected);
    const cards = body.measureCards(selectedRow?.tributes ?? []);
    const tradedNote = body.measureTradedNote(selectedRow);
    const screen = ctx.screen();
    const origin = ctx.layout.windowOrigin(screen, standardWindowWidth(scale));
    const raw = layoutDiplomacyWindow({
      originX: origin.x,
      originY: origin.y,
      scale,
      players: rows.map((r) => r.player),
      selected,
      declarable: selectedRow?.canDeclare === true ? selectedRow.yourStance : null,
      tributes: cards.map((c) => c.spec),
      offerRows: selectedRow === undefined ? 0 : tradeSectionRows(selectedRow),
      tradedNoteH: tradedNote?.height ?? null,
    });
    const built = fitDiplomacyWindow(
      raw,
      screen,
      ctx.overlayReserve?.() ?? null,
      scroll,
      ctx.layout.windowFloor(screen),
    );
    scroll = built.scroll;
    layout = built;

    const byPlayer = new Map(rows.map((r) => [r.player, r]));
    const tabs: TitledTab[] = built.tabs.map((tab) => ({
      rect: tab.rect,
      selected: tab.selected,
      label: diplomacyPlayerLabel(ctx, tab.player, byPlayer.get(tab.player)?.name),
    }));
    paintTitledTabWindow(
      layers,
      built,
      built.scrollTabs ? [] : tabs,
      ctx.uiString('miscwindow', TITLE_STRING_ID, messages().hud.diplomacy),
    );

    mask.rect(built.viewport.x, built.viewport.y, built.viewport.w, built.viewport.h).fill(0xffffff);
    if (built.scrollTabs) paintWindowTabs(bodyLayers, tabs);
    body.paint(built, selectedRow, cards, tradedNote);
    if (built.maxScroll > 0) {
      const track = scrollTrack(built, scale);
      const thumbH = Math.max(THUMB_MIN_H * scale, (track.h * track.h) / (track.h + built.maxScroll));
      shell.graphics.rect(track.x, track.y, track.w, track.h).fill(TRACK_FILL);
      shell.graphics
        .rect(track.x, track.y + ((track.h - thumbH) * built.scroll) / built.maxScroll, track.w, thumbH)
        .fill(THUMB_FILL);
    }
  };

  const close = (): void => {
    shell.setOpen(false);
    clear();
    layout = null;
    key = '';
  };

  return {
    isOpen: shell.isOpen,
    toggle: () => {
      if (shell.isOpen()) close();
      else {
        shell.setOpen(true);
        rebuild(deps.rows());
      }
    },
    close,
    claims: (x, y) => shell.claims(layout?.window ?? null, x, y),
    handleClick: (x, y): boolean => {
      if (!shell.isOpen() || layout === null) return false;
      if (layout.maxScroll > 0 && contains(scrollTrack(layout, scale), x, y)) {
        scroll = Math.max(
          0,
          Math.min(layout.maxScroll, ((y - layout.viewport.y) / layout.viewport.h) * layout.maxScroll),
        );
        rebuild(deps.rows());
        return true;
      }
      const hit = hitTestDiplomacyWindow(layout, x, y);
      if (
        (hit?.kind === 'pay' || hit?.kind === 'declare' || (hit?.kind === 'tab' && layout.scrollTabs)) &&
        !contains(layout.viewport, x, y)
      )
        return contains(layout.window, x, y);
      if (hit === null) return false;
      if (hit.kind !== 'window') ctx.cue('confirm');
      switch (hit.kind) {
        case 'close':
          close();
          break;
        case 'tab':
          selected = hit.player;
          scroll = 0;
          rebuild(deps.rows());
          break;
        case 'declare':
          if (selected !== null) deps.onDeclareDiplomacy?.(selected, hit.state);
          break;
        case 'pay':
          deps.onPayTribute?.(hit.slot);
          break;
        case 'window':
          break; // a click on the window body is consumed
        default: {
          const unreachable: never = hit;
          return unreachable;
        }
      }
      return true;
    },
    handleWheel: (x, y, deltaY) => {
      if (!shell.isOpen() || layout === null || !contains(layout.window, x, y)) return false;
      const next = Math.max(0, Math.min(layout.maxScroll, scroll + Math.sign(deltaY) * WHEEL_STEP * scale));
      if (next !== scroll) {
        scroll = next;
        rebuild(deps.rows());
      }
      return true;
    },
    refresh: (): void => {
      if (!shell.isOpen()) return;
      const rows = deps.rows();
      if (rebuildKey(rows, resolveSelectedPlayer(rows, selected)) === key) return;
      rebuild(rows);
    },
    state: () => selected,
    restore: (player): void => {
      selected = player;
    },
  };
}
