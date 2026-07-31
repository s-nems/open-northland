import { Container, Graphics } from 'pixi.js';
import { WIN_PAD } from '../../chrome.js';
import { contains } from '../../geometry.js';
import type { PanelContext } from '../context.js';
import type { ToolButtonId } from '../layout.js';
import { createWindowShell, type ToolWindow } from '../window-shell.js';
import { clearFills, paintHover, paintWindow, placeRuns, type TabbedListLayers } from './chrome.js';
import {
  chromeAboveList,
  hitTestTabbedList,
  layoutTabbedList,
  ROW_H,
  type TabbedListItem,
  type TabbedListLayout,
  type TabbedListTab,
} from './model.js';

/** How many rows one mouse-wheel event scrolls the list. */
const WHEEL_ROWS = 1;
/** Bottom margin (design px) the list keeps clear of the screen foot. */
const LIST_BOTTOM_MARGIN = 24;
/** Hard cap on visible rows so the window stays a tidy panel even on a very tall screen (the rest scroll). */
const MAX_LIST_ROWS = 13;
/** Floor on visible rows so a short screen still shows a usable list. */
const MIN_LIST_ROWS = 3;

/**
 * What a tabbed-list window lists: its title, the strip button it drops from, its tab grid, and the
 * projection from a tab to the items shown under it. The tab set is fixed per source (only its labels
 * are localized), so the window reads its shape once at construction.
 */
export interface TabbedListSource<Id, Item extends TabbedListItem> {
  /** The headline text, resolved at rebuild time so a language change is picked up. */
  title(): string;
  /** The strip button the window anchors to — every pop-up drops from the button that toggles it. */
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
  /** The panel's window container the pop-up parents its layers under. */
  readonly container: Container;
  readonly source: TabbedListSource<Id, Item>;
  /** A row was clicked (the window closes itself first) — the panel enters the matching held mode. */
  readonly onPick: (item: Item) => void;
}

/** A pop-up tabbed list: open/close, tabs, scroll, row hover, and the pick hand-off. */
export interface TabbedListWindow extends ToolWindow {
  /** Route a wheel event; returns true when this window consumed it (scrolled its list). */
  handleWheel(x: number, y: number, deltaY: number): boolean;
  /** Update the row-hover highlight from a canvas-space point (no-op when closed). */
  handleHover(x: number, y: number): void;
  /** Drop the row-hover highlight, for when the pointer leaves the list or another pop-up covers it. */
  clearHover(): void;
  /** Per-frame hook: reflow the list only when a canvas resize changes how many rows fit. */
  refresh(): void;
}

/**
 * Build a tabbed-list window controller over the pure {@link layoutTabbedList} geometry. It adds `back`
 * (tiled fills) and `hoverG` (the row wash) around the shared shell, so the container child order stays
 * back < frame < hover. The chrome rebuilds on open, tab change and scroll; hover redraws on its own.
 */
export function createTabbedListWindow<Id, Item extends TabbedListItem>(
  deps: TabbedListWindowDeps<Id, Item>,
): TabbedListWindow {
  const { ctx, source } = deps;
  const { scale } = ctx;
  // Right of the strip, dropping from the button that opens it, so the window clears the top-left debug
  // overlay. Fixed for the controller's life (pinned strip geometry), so computed once.
  const origin = {
    x: ctx.layout.width + WIN_PAD * scale,
    y: ctx.layout.buttons.find((b) => b.id === source.anchor)?.placed.y ?? ctx.layout.strip.y,
  };

  // The tab set is fixed per source (only its labels are localized), so the chrome above the list is a
  // constant — resolved here, not in the per-frame `listRows`.
  const chromeH = chromeAboveList(source.tabs().length, source.tabColumns);

  let selected: Id = source.initialTab;
  let scrollTop = 0;
  let layout: TabbedListLayout<Id, Item> | null = null;
  let hovered: Item | null = null;
  // The last canvas cursor point, so a scroll/tab/resize can re-resolve which card the (stationary) cursor
  // is over — otherwise the highlight would stick to an item that scrolled away from under the pointer.
  let lastPointer: { x: number; y: number } | null = null;
  // The viewport row count the current layout was built for — a resize that changes it triggers a reflow.
  let builtRows = 0;

  const back = new Container();
  deps.container.addChild(back);
  const shell = createWindowShell(deps.container);
  const hoverG = new Graphics();
  deps.container.addChild(hoverG);
  const layers: TabbedListLayers = {
    ctx,
    container: deps.container,
    back,
    graphics: shell.graphics,
    runs: shell.runs,
  };

  /** The viewport height in rows, from the live screen height (bounded to a tidy compact panel). */
  const listRows = (): number => {
    const avail = ctx.screen().height - origin.y - (chromeH + LIST_BOTTOM_MARGIN) * scale;
    return Math.max(MIN_LIST_ROWS, Math.min(MAX_LIST_ROWS, Math.floor(avail / (ROW_H * scale))));
  };

  /** The item under a canvas point (null when it's not over a row). */
  const hoverAt = (x: number, y: number): Item | null => {
    if (layout === null) return null;
    const hit = hitTestTabbedList(layout, x, y);
    return hit !== null && hit.kind === 'row' ? hit.item : null;
  };

  const drawHover = (): void => paintHover(hoverG, layout, hovered, scale);

  const rebuild = (): void => {
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
    // Re-resolve which card the (possibly stationary) cursor is now over, so the highlight tracks the
    // content after a scroll / tab change instead of clinging to an item that moved.
    hovered = lastPointer === null ? null : hoverAt(lastPointer.x, lastPointer.y);

    paintWindow(layers, layout, source.title());
    placeRuns(layers, layout);
    drawHover();
  };

  const clearHover = (): void => {
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
          close();
          deps.onPick(item);
          break;
        }
        case 'window':
          break; // a click on the window body is consumed, nothing to do
        default: {
          const unreachable: never = hit; // exhaustive: a new hit kind fails to compile here
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
      if (next === hovered) return;
      hovered = next;
      drawHover();
    },
    clearHover,
    refresh: (): void => {
      // The text runs don't move between rebuilds, so the only per-frame work is reflowing the list when
      // a canvas resize changes how many rows fit.
      if (!shell.isOpen() || layout === null) return;
      if (listRows() !== builtRows) rebuild();
    },
  };
}
