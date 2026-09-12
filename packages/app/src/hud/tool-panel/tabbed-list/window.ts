import { Container, Graphics } from 'pixi.js';
import { createTooltip, type Tooltip } from '../../../view/tooltip.js';
import { WIN_PAD } from '../../chrome.js';
import { contains } from '../../geometry.js';
import type { PanelContext } from '../context.js';
import type { ToolButtonId } from '../layout.js';
import { clearFills, ROW_H, standardWindowWidth, type WindowLayers } from '../window-family/index.js';
import { createWindowShell, type ToolWindow } from '../window-shell.js';
import { paintHover, paintWindow } from './chrome.js';
import {
  chromeAboveList,
  hitTestTabbedList,
  layoutTabbedList,
  type TabbedListItem,
  type TabbedListLayout,
  type TabbedListTab,
} from './model.js';

/** How many rows one mouse-wheel event scrolls the list. */
const WHEEL_ROWS = 1;
/** Bottom margin (design px) the list keeps clear of whatever bounds it below. */
const LIST_BOTTOM_MARGIN = 24;
/** Hard cap on visible rows so the window stays a tidy panel even on a very tall screen (the rest scroll). */
const MAX_LIST_ROWS = 13;
/** Floor on visible rows so a short screen still shows a usable list. It outranks the list floor: where
 *  the overlay leaves room for fewer rows the window stays this tall and keeps overlapping. */
const MIN_LIST_ROWS = 3;

export interface TabbedListSource<Id, Item extends TabbedListItem> {
  /** The headline text, resolved at rebuild time so a language change is picked up. */
  title(): string;
  /** The strip button the window drops from. */
  readonly anchor: ToolButtonId;
  tabs(): readonly TabbedListTab<Id>[];
  /** Tabs per grid row. */
  readonly tabColumns: number;
  readonly initialTab: Id;
  /** The items under `tab`, in display order. Must return the same object per item across calls: the
   *  row-hover highlight tracks the hovered item by identity. */
  items(tab: Id): readonly Item[];
}

export interface TabbedListWindowDeps<Id, Item extends TabbedListItem> {
  readonly ctx: PanelContext;
  /** The panel's window container the pop-up mounts its own container under. */
  readonly container: Container;
  readonly source: TabbedListSource<Id, Item>;
  /** A row was clicked; the window closes itself first. */
  readonly onPick: (item: Item) => void;
}

/** A pop-up tabbed list: open/close, tabs, scroll, row hover, and the pick hand-off. */
export interface TabbedListWindowState<Id> {
  readonly selected: Id;
  readonly scrollTop: number;
}

export interface TabbedListWindow<Id> extends ToolWindow {
  /** Route a wheel event; returns true when this window consumed it (scrolled its list). */
  handleWheel(x: number, y: number, deltaY: number): boolean;
  /** Update the row-hover highlight from a canvas-space point (no-op when closed). */
  handleHover(x: number, y: number): void;
  /** Drop the row-hover highlight, for when the pointer leaves the list or another pop-up covers it. */
  clearHover(): void;
  /** Per-frame hook: reflow the list only when a canvas resize changes how many rows fit. */
  refresh(): void;
  state(): TabbedListWindowState<Id>;
  restore(state: TabbedListWindowState<Id>): void;
}

/**
 * Build a tabbed-list window controller. `back` (tiled fills) and `hoverG` (the row wash) sit inside the
 * shell's container so the child order stays back < frame < hover < labels.
 */
export function createTabbedListWindow<Id, Item extends TabbedListItem>(
  deps: TabbedListWindowDeps<Id, Item>,
): TabbedListWindow<Id> {
  const { ctx, source } = deps;
  const { scale } = ctx;
  // Right of the strip, dropping from the button that opens it, which clears the top-left debug overlay.
  const origin = {
    x: ctx.layout.width + WIN_PAD * scale,
    y: ctx.layout.buttons.find((b) => b.id === source.anchor)?.placed.y ?? ctx.layout.strip.y,
  };
  const windowRight = origin.x + standardWindowWidth(scale);

  // The tab set is fixed per source, so the chrome above the list is a constant.
  const chromeH = chromeAboveList(source.tabs().length, source.tabColumns);

  let tooltip: Tooltip | undefined;
  deps.container.on('destroyed', () => tooltip?.destroy());
  let permissionKey = '';
  const permissions = (): string =>
    source
      .items(selected)
      .map((i) => i.disabledReason?.() ?? '')
      .join('\n');
  let selected: Id = source.initialTab;
  let scrollTop = 0;
  let layout: TabbedListLayout<Id, Item> | null = null;
  let hovered: Item | null = null;
  // The last canvas cursor point, so a scroll, tab change or resize re-resolves which card a stationary
  // cursor is over.
  let lastPointer: { x: number; y: number } | null = null;
  // The viewport row count the current layout was built for; a resize that changes it triggers a reflow.
  let builtRows = 0;

  const shell = createWindowShell(deps.container);
  const back = new Container();
  shell.container.addChildAt(back, 0); // behind the shell's frame Graphics
  const hoverG = new Graphics();
  shell.container.addChild(hoverG);
  const layers: WindowLayers = {
    ctx,
    container: shell.container,
    back,
    graphics: shell.graphics,
    runs: shell.runs,
  };

  /** The lowest screen y the list should reach: the screen foot, raised to the top of the bottom-corner
   *  overlay when this window's x-span crosses it. */
  const listFloor = (): number => {
    const screenH = ctx.screen().height;
    const reserve = ctx.overlayReserve?.() ?? null;
    if (reserve === null || origin.x >= reserve.x + reserve.w || windowRight <= reserve.x) return screenH;
    return Math.min(screenH, reserve.y);
  };

  /** The viewport height in rows, from the live floor (bounded to a tidy compact panel). */
  const listRows = (): number => {
    const avail = listFloor() - origin.y - (chromeH + LIST_BOTTOM_MARGIN) * scale;
    return Math.max(MIN_LIST_ROWS, Math.min(MAX_LIST_ROWS, Math.floor(avail / (ROW_H * scale))));
  };

  /** The item under a canvas point (null when it's not over a row). */
  const hoverAt = (x: number, y: number): Item | null => {
    if (layout === null) return null;
    const hit = hitTestTabbedList(layout, x, y);
    return hit !== null && hit.kind === 'row' ? hit.item : null;
  };

  const showReason = (item: Item | null, x: number, y: number): void => {
    const reason = item?.disabledReason?.();
    if (reason) {
      tooltip ??= createTooltip();
      const screen = ctx.screen();
      tooltip.show((x * window.innerWidth) / screen.width, (y * window.innerHeight) / screen.height, reason);
    } else tooltip?.hide();
  };

  const drawHover = (): void => paintHover(hoverG, layout, hovered, scale);

  const rebuild = (): void => {
    permissionKey = permissions();
    shell.clear();
    clearFills(back);
    builtRows = listRows();
    layout = layoutTabbedList({
      originX: origin.x,
      originY: origin.y,
      scale,
      tabs: source.tabs(),
      tabColumns: source.tabColumns,
      selected,
      items: source.items(selected),
      scrollTop,
      maxListRows: builtRows,
    });
    scrollTop = layout.scroll.top; // clamp back (a tab change can shrink the range)
    hovered = lastPointer === null ? null : hoverAt(lastPointer.x, lastPointer.y);

    if (lastPointer !== null) showReason(hovered, lastPointer.x, lastPointer.y);
    paintWindow(layers, layout, source.title());
    drawHover();
  };

  const clearHover = (): void => {
    tooltip?.hide();
    // `paintHover` clears before it draws, so nothing is painted while `hovered` is null.
    if (hovered === null && lastPointer === null) return;
    hovered = null;
    lastPointer = null; // a rebuild re-derives the highlight from it, so drop it with the highlight
    hoverG.clear();
  };

  const close = (): void => {
    shell.setOpen(false);
    clearHover();
    shell.clear();
    clearFills(back);
    layout = null;
  };

  const scrollBy = (rows: number): void => {
    if (layout === null || layout.scroll.max === 0) return;
    const next = Math.max(0, Math.min(layout.scroll.max, scrollTop + rows));
    if (next === scrollTop) return;
    scrollTop = next;
    rebuild();
  };

  return {
    isOpen: shell.isOpen,
    toggle: () => {
      if (shell.isOpen()) close();
      else {
        shell.setOpen(true);
        rebuild();
      }
    },
    close,
    claims: (x, y) => shell.claims(layout?.window ?? null, x, y),
    handleClick: (x, y): boolean => {
      if (!shell.isOpen() || layout === null) return false;
      const hit = hitTestTabbedList(layout, x, y);
      if (hit === null) return false;
      switch (hit.kind) {
        case 'close':
          close();
          break;
        case 'tab':
          selected = hit.tab;
          scrollTop = 0;
          rebuild();
          break;
        case 'scroll':
          scrollBy(hit.dir * layout.scroll.visible); // page toward the click
          break;
        case 'row': {
          const { item } = hit;
          if (item.disabledReason?.()) break;
          close();
          deps.onPick(item);
          break;
        }
        case 'window':
          break; // a click on the window body is consumed
        default: {
          const unreachable: never = hit;
          return unreachable;
        }
      }
      return true;
    },
    handleWheel: (x, y, deltaY): boolean => {
      if (!shell.isOpen() || layout === null || !contains(layout.window, x, y)) return false;
      scrollBy(Math.sign(deltaY) * WHEEL_ROWS);
      return true;
    },
    handleHover: (x, y): void => {
      if (!shell.isOpen() || layout === null) return;
      lastPointer = { x, y };
      const next = hoverAt(x, y);
      showReason(next, x, y);
      if (next === hovered) return;
      hovered = next;
      drawHover();
    },
    clearHover,
    refresh: (): void => {
      if (!shell.isOpen() || layout === null) return;
      if (listRows() !== builtRows || permissions() !== permissionKey) rebuild();
    },
    state: () => ({ selected, scrollTop }),
    restore: (state): void => {
      selected = state.selected;
      scrollTop = state.scrollTop;
    },
  };
}
