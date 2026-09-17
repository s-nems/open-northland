import type { DiplomacyState } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import { messages } from '../../../i18n/index.js';
import { contains } from '../../geometry.js';
import type { PanelContext } from '../context.js';
import {
  clearFills,
  paintTitledTabWindow,
  paintWindowTabs,
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
} from './model.js';
import { type FittedDiplomacyWindow, fitDiplomacyWindow } from './viewport.js';

const TITLE_STRING_ID = 350;

const scrollTrack = (layout: FittedDiplomacyWindow) => ({
  x: layout.window.x + layout.window.w - 6,
  y: layout.viewport.y,
  w: 4,
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
    const measured = layoutDiplomacyWindow({
      originX: 0,
      originY: 0,
      scale,
      players: rows.map((r) => r.player),
      selected,
      tributes: cards.map((c) => c.spec),
    });
    const screen = ctx.screen();
    const origin = ctx.layout.windowOrigin(screen, measured.window.w);
    const raw = layoutDiplomacyWindow({
      originX: origin.x,
      originY: origin.y,
      scale,
      players: rows.map((r) => r.player),
      selected,
      declarable: selectedRow?.canDeclare === true ? selectedRow.yourStance : null,
      tributes: cards.map((c) => c.spec),
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
    body.paint(built, selectedRow, cards);
    if (built.maxScroll > 0) {
      const track = scrollTrack(built);
      const thumbH = Math.max(12, (track.h * track.h) / (track.h + built.maxScroll));
      shell.graphics.rect(track.x, track.y, track.w, track.h).fill(0x493922);
      shell.graphics
        .rect(track.x, track.y + ((track.h - thumbH) * built.scroll) / built.maxScroll, track.w, thumbH)
        .fill(0xc9a75c);
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
      if (layout.maxScroll > 0 && contains(scrollTrack(layout), x, y)) {
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
      const next = Math.max(0, Math.min(layout.maxScroll, scroll + Math.sign(deltaY) * 36 * scale));
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
