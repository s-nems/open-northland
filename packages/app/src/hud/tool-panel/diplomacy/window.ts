import type { DiplomacyState } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { messages } from '../../../i18n/index.js';
import { drawPlateOutline, WIN_PAD } from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { TextRun } from '../../text-run.js';
import type { PanelContext } from '../context.js';
import {
  addRun,
  clearFills,
  paintRowCard,
  paintTitledTabWindow,
  placeOnCard,
  ROW_INSET_X,
  ROW_PX,
  TEXT_CAP_H,
  type TitledTab,
  type WindowLayers,
} from '../window-family/index.js';
import { createWindowShell, type ToolWindow } from '../window-shell.js';
import {
  type DiplomacyPanelRow,
  type DiplomacyWindowLayout,
  hitTestDiplomacyWindow,
  layoutDiplomacyWindow,
  resolveSelectedPlayer,
} from './model.js';

/** Team-swatch square side (design px) on the identity card. */
const SWATCH = 9;
/** Gap (design px) between the swatch and the name beside it. */
const SWATCH_NAME_GAP = 5;

/** The decoded original strings the window prefers over the catalog fallbacks. */
const TITLE_STRING_ID = 350; // miscwindow 'Diplomacy'
const THEIR_STANCE_STRING_ID = 358; // miscwindow 'Relationship to your tribe is'
const YOUR_STANCE_STRING_ID = 359; // miscwindow 'Your relation to the other tribe'
const PLAYER_STRING_ID = 361; // miscwindow 'Player'
const STANCE_STRING_ID: Readonly<Record<DiplomacyState, number>> = {
  friend: 200, // misclogic 'friendly'
  neutral: 201,
  enemy: 202,
};

export interface DiplomacyWindowDeps {
  readonly ctx: PanelContext;
  readonly container: Container;
  /** One row per discovered player, viewer excluded. Pulled only while the window is open. */
  readonly rows: () => readonly DiplomacyPanelRow[];
}

/** The pop-up diplomacy window; per-frame refresh rebuilds only when the rows or selection changed. */
export interface DiplomacyWindow extends ToolWindow {
  refresh(): void;
  state(): number | null;
  restore(player: number | null): void;
}

export function createDiplomacyWindow(deps: DiplomacyWindowDeps): DiplomacyWindow {
  const { ctx } = deps;
  const { scale } = ctx;
  const origin = {
    x: ctx.layout.width + WIN_PAD * scale,
    y: ctx.layout.buttons.find((b) => b.id === 'diplomacy')?.placed.y ?? ctx.layout.strip.y,
  };

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

  let selected: number | null = null;
  let layout: DiplomacyWindowLayout | null = null;
  let key = '';

  const rebuildKey = (rows: readonly DiplomacyPanelRow[], chosen: number | null): string =>
    JSON.stringify([
      rows.map((r) => [r.player, r.name ?? null, r.colour, r.towardYou, r.yourStance]),
      chosen,
    ]);

  /** The authored name, or the numbered fallback an unnamed slot renders as. */
  const playerLabel = (player: number, name: string | undefined): string =>
    name ?? `${ctx.uiString('miscwindow', PLAYER_STRING_ID, messages().hud.player)} ${player}`;

  /** Place a run flush with the card's right edge, mirroring the left label inset. */
  const onCardRight = (run: TextRun, card: Rect): void => {
    const { width: rw, height: rh } = ctx.screen();
    const x = card.x + card.w - (ROW_INSET_X + run.width) * scale;
    const y = card.y + (card.h - TEXT_CAP_H * scale) / 2;
    run.place(Math.round(x), Math.round(y), scale, rw, rh);
  };

  const stanceText = (state: DiplomacyState): string =>
    ctx.uiString('misclogic', STANCE_STRING_ID[state], messages().hud.diplomacyStances[state]);

  const paintBody = (built: DiplomacyWindowLayout, row: DiplomacyPanelRow): void => {
    const [identity, theirLine, yourLine] = built.bodyLines;
    if (identity === undefined) return;
    const idCard = paintRowCard(layers, identity);
    const side = Math.round(SWATCH * scale);
    const swatch: Rect = {
      x: Math.round(idCard.x + ROW_INSET_X * scale),
      y: Math.round(idCard.y + (idCard.h - side) / 2),
      w: side,
      h: side,
    };
    shell.graphics.rect(swatch.x, swatch.y, swatch.w, swatch.h).fill(row.colour);
    drawPlateOutline(shell.graphics, swatch, scale);
    placeOnCard(
      layers,
      addRun(layers, playerLabel(row.player, row.name), 'white', ROW_PX),
      idCard,
      ROW_INSET_X + SWATCH + SWATCH_NAME_GAP,
    );

    const stanceLine = (line: Rect | undefined, heading: string, state: DiplomacyState): void => {
      if (line === undefined) return;
      const card = paintRowCard(layers, line);
      placeOnCard(layers, addRun(layers, heading, 'dimmed', ROW_PX), card);
      onCardRight(addRun(layers, stanceText(state), state === 'enemy' ? 'red' : 'white', ROW_PX), card);
    };
    stanceLine(
      theirLine,
      ctx.uiString('miscwindow', THEIR_STANCE_STRING_ID, messages().hud.diplomacyTheirStance),
      row.towardYou,
    );
    stanceLine(
      yourLine,
      ctx.uiString('miscwindow', YOUR_STANCE_STRING_ID, messages().hud.diplomacyYourStance),
      row.yourStance,
    );
  };

  const rebuild = (rows: readonly DiplomacyPanelRow[]): void => {
    shell.clear();
    clearFills(back);
    selected = resolveSelectedPlayer(rows, selected);
    key = rebuildKey(rows, selected);
    const built = layoutDiplomacyWindow({
      originX: origin.x,
      originY: origin.y,
      scale,
      players: rows.map((r) => r.player),
      selected,
    });
    layout = built;

    const byPlayer = new Map(rows.map((r) => [r.player, r]));
    const tabs: TitledTab[] = built.tabs.map((tab) => ({
      rect: tab.rect,
      selected: tab.selected,
      label: playerLabel(tab.player, byPlayer.get(tab.player)?.name),
    }));
    paintTitledTabWindow(
      layers,
      built,
      tabs,
      ctx.uiString('miscwindow', TITLE_STRING_ID, messages().hud.diplomacy),
    );

    const selectedRow = rows.find((r) => r.player === selected);
    if (selectedRow !== undefined) {
      paintBody(built, selectedRow);
    } else {
      const line = built.bodyLines[0];
      if (line !== undefined) {
        const card = paintRowCard(layers, line);
        placeOnCard(layers, addRun(layers, messages().hud.diplomacyNoneMet, 'dimmed', ROW_PX), card);
      }
    }
  };

  const close = (): void => {
    shell.setOpen(false);
    shell.clear();
    clearFills(back);
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
      const hit = hitTestDiplomacyWindow(layout, x, y);
      if (hit === null) return false;
      switch (hit.kind) {
        case 'close':
          close();
          break;
        case 'tab':
          selected = hit.player;
          rebuild(deps.rows());
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
