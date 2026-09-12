import type { Graphics } from 'pixi.js';
import { drawHoverHighlight, drawScrollbar } from '../../chrome.js';
import {
  addRun,
  paintRowCard,
  paintTitledTabWindow,
  placeOnCard,
  ROW_PX,
  rowCardRect,
  type TitledTab,
  type WindowLayers,
} from '../window-family/index.js';
import type { TabbedListItem, TabbedListLayout } from './model.js';

/** Paint the window: the shared titled tab-grid part, then this list's row cards and scrollbar. */
export function paintWindow<Id, Item extends TabbedListItem>(
  layers: WindowLayers,
  layout: TabbedListLayout<Id, Item>,
  title: string,
): void {
  const { ctx, graphics } = layers;

  const tabs: TitledTab[] = layout.tabs.map((tab) => ({
    rect: tab.rect,
    selected: tab.selected,
    label: tab.stringId === undefined ? tab.label : ctx.uiString('miscwindow', tab.stringId, tab.label),
  }));
  paintTitledTabWindow(layers, layout, tabs, title);

  for (const row of layout.rows) {
    const card = paintRowCard(layers, row.rect);
    const reason = row.item.disabledReason?.();
    placeOnCard(layers, addRun(layers, row.item.label, reason ? 'dimmed' : 'white', ROW_PX), card);
  }
  if (layout.scrollbar !== undefined) {
    drawScrollbar(graphics, layout.scrollbar.track, layout.scrollbar.thumb, ctx.scale);
  }
}

/** Redraw only the hover wash over `hovered`'s card, leaving the painted chrome untouched. */
export function paintHover<Id, Item extends TabbedListItem>(
  hover: Graphics,
  layout: TabbedListLayout<Id, Item> | null,
  hovered: Item | null,
  scale: number,
): void {
  hover.clear();
  if (layout === null || hovered === null) return;
  const row = layout.rows.find((r) => r.item === hovered);
  if (row !== undefined) drawHoverHighlight(hover, rowCardRect(row.rect, scale));
}
