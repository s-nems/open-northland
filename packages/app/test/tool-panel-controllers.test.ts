import type { HudLayout } from '@open-northland/render';
import type { Command } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { WIN_PAD } from '../src/hud/chrome.js';
import type { Rect } from '../src/hud/geometry.js';
import { minimapLayout, terrainWorldBounds } from '../src/hud/minimap/model.js';
import type { TextRun } from '../src/hud/text-run.js';
import { buildingTabbedList, type MenuBuildingEntry } from '../src/hud/tool-panel/building-menu.js';
import type { PanelContext } from '../src/hud/tool-panel/context.js';
import {
  type AssistantCounterFace,
  type AssistantCounterId,
  type AssistantGrantId,
  defaultAssistantState,
  layoutExtrasMenu,
} from '../src/hud/tool-panel/extras-menu.js';
import {
  createExtrasWindow,
  type ExtrasCountersSeam,
  type ExtrasGrantsSeam,
} from '../src/hud/tool-panel/extras-window.js';
import { goodsTabbedList, type MenuGoodEntry } from '../src/hud/tool-panel/goods-menu.js';
import { buildToolPanelLayout, type ToolButtonId } from '../src/hud/tool-panel/layout.js';
import { createPlacementController } from '../src/hud/tool-panel/placement.js';
import { createStatsWindow } from '../src/hud/tool-panel/stats-window.js';
import {
  createTabbedListWindow,
  layoutTabbedList,
  type TabbedListSource,
} from '../src/hud/tool-panel/tabbed-list/index.js';
import { createToolWindows } from '../src/hud/tool-panel/windows.js';
import { messages } from '../src/i18n/index.js';

/**
 * Headless tests for the tool-panel WINDOW CONTROLLERS (menu / goods / stats / placement) over a stubbed
 * {@link PanelContext} - the seams the package split opened up. These pin the input-routing contracts
 * the mount relies on (claim regions, close-on-pick, close-on-inside) and the stats change-key guard
 * (a tick-only change must NOT rebuild the glyph runs - the per-frame perf contract).
 */

const SCREEN = { width: 800, height: 600 };

/** A PanelContext whose text factory records what it was asked to build (no Pixi text, no fonts). */
function stubContext(overlayReserve?: () => Rect | null): { ctx: PanelContext; made: string[] } {
  const made: string[] = [];
  const layout = buildToolPanelLayout(1);
  const ctx: PanelContext = {
    layout,
    scale: layout.scale,
    makeText: (text): TextRun => {
      made.push(text);
      return { container: new Container(), width: 0, place: () => undefined, destroy: () => undefined };
    },
    bitmaps: { bg: undefined, button: undefined, buttonHilite: undefined, headline: undefined },
    uiString: (_table, _id, fallback) => fallback,
    screen: () => SCREEN,
    ...(overlayReserve !== undefined ? { overlayReserve } : {}),
  };
  return { ctx, made };
}

const BUILDINGS: readonly MenuBuildingEntry[] = [
  { typeId: 1, label: 'Headquarters', kind: 'storage' },
  { typeId: 23, label: 'Joinery', kind: 'workplace' },
];

/** The stats window's placement, which `stats-window.ts` keeps private: past the menu column, dropped
 *  below the strip top (design px). */
const STATS_WIDTH = 150;
const STATS_GAP_X = WIN_PAD + STATS_WIDTH + 3 * WIN_PAD;
const STATS_OFFSET_Y = 15;

/** The centre of a rect (for synthetic clicks). */
function centreOf(r: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** The y a pop-up drops from: its own strip button (the shared window's anchor rule). */
function anchorY(ctx: PanelContext, anchor: ToolButtonId): number {
  return ctx.layout.buttons.find((b) => b.id === anchor)?.placed.y ?? ctx.layout.strip.y;
}

/** The same layout the shared tabbed-list controller computes internally (same origin formula + inputs):
 *  to the right of the strip, dropping from the button that opens it. These fixtures are shorter than the
 *  stub screen's viewport, so the controller's row cap does not bind. */
function expectedListLayout<Id, Item extends { readonly label: string }>(
  ctx: PanelContext,
  source: TabbedListSource<Id, Item>,
) {
  return layoutTabbedList({
    originX: ctx.layout.width + WIN_PAD * ctx.scale,
    originY: anchorY(ctx, source.anchor),
    scale: ctx.scale,
    tabs: source.tabs(),
    tabColumns: source.tabColumns,
    selected: source.initialTab,
    items: source.items(source.initialTab),
  });
}

const expectedMenuLayout = (ctx: PanelContext, buildings: readonly MenuBuildingEntry[] = BUILDINGS) =>
  expectedListLayout(ctx, buildingTabbedList(buildings));

// A category longer than the viewport (stub screen fits MAX_LIST_ROWS = 13), so the scroll path engages.
const MANY: readonly MenuBuildingEntry[] = Array.from({ length: 20 }, (_, i) => ({
  typeId: 200 + i,
  label: `B${i}`,
  kind: 'workplace',
}));

/** A canvas point inside the build menu's first list row (past the headline + tab band). */
function firstRowPoint(ctx: PanelContext): { x: number; y: number } {
  return {
    x: ctx.layout.width + WIN_PAD * ctx.scale + 20,
    y: anchorY(ctx, 'buildings') + 45 * ctx.scale,
  };
}

/** Build the shared tabbed-list window the panel mounts for the build menu. */
function menuWindow(ctx: PanelContext, buildings: readonly MenuBuildingEntry[], onPick: (t: number) => void) {
  return createTabbedListWindow({
    ctx,
    container: new Container(),
    source: buildingTabbedList(buildings),
    onPick: (b) => onPick(b.typeId),
  });
}

/** A HUD read-view: the volatile `tick` row the stats window excludes from its change key, then a tally. */
const hud = (tick: number, wood: number): HudLayout => ({
  width: 100,
  height: 40,
  rows: [
    { x: 0, y: 0, text: `Tribe 1 · tick ${tick}` },
    { x: 0, y: 12, text: `wood: ${wood}` },
  ],
});

/** A read-view with enough tallies that the content-sized stats window reaches down over the build
 *  menu's first list row (both windows size themselves from their content, so they can overlap). */
const TALL_HUD: HudLayout = {
  width: 100,
  height: 80,
  rows: ['Tribe 1 · tick 1', 'wood: 5', 'stone: 2', 'grain: 9'].map((text, i) => ({
    x: 0,
    y: i * 12,
    text,
  })),
};

describe('tabbed-list window controller (build menu)', () => {
  it('opens on toggle, claims the window rect, and closes on the close box', () => {
    const { ctx } = stubContext();
    const menu = menuWindow(ctx, BUILDINGS, () => undefined);
    const geo = expectedMenuLayout(ctx);

    expect(menu.isOpen()).toBe(false);
    expect(menu.claims(geo.window.x + 1, geo.window.y + 1)).toBe(false); // closed → no claim

    menu.toggle();
    expect(menu.isOpen()).toBe(true);
    expect(menu.claims(geo.window.x + 1, geo.window.y + 1)).toBe(true);
    expect(menu.claims(geo.window.x - 1, geo.window.y - 1)).toBe(false); // outside the window

    const close = centreOf(geo.closeRect);
    expect(menu.handleClick(close.x, close.y)).toBe(true);
    expect(menu.isOpen()).toBe(false);
  });

  it('closes itself BEFORE handing a picked building to onPick', () => {
    const { ctx } = stubContext();
    const picks: Array<{ typeId: number; menuOpenAtPick: boolean }> = [];
    const menu = menuWindow(ctx, BUILDINGS, (typeId) =>
      picks.push({ typeId, menuOpenAtPick: menu.isOpen() }),
    );
    menu.toggle();
    const row = centreOf(expectedMenuLayout(ctx).rows[1]?.rect ?? { x: 0, y: 0, w: 0, h: 0 });

    expect(menu.handleClick(row.x, row.y)).toBe(true);
    expect(picks).toEqual([{ typeId: 23, menuOpenAtPick: false }]);
  });

  it('does not consume clicks outside the open window', () => {
    const { ctx } = stubContext();
    const menu = menuWindow(ctx, BUILDINGS, () => undefined);
    menu.toggle();
    expect(menu.handleClick(SCREEN.width - 1, SCREEN.height - 1)).toBe(false);
    expect(menu.isOpen()).toBe(true);
  });

  it('consumes the wheel over the open window and ignores it outside', () => {
    const { ctx } = stubContext();
    const menu = menuWindow(ctx, MANY, () => undefined);
    menu.toggle();
    const p = firstRowPoint(ctx);
    expect(menu.handleWheel(p.x, p.y, 120)).toBe(true); // over the window → scrolls, consumed
    expect(menu.handleWheel(5000, 5000, 120)).toBe(false); // off the window → not consumed
  });

  it('wheel-scrolls the overflowing list so a fixed point clicks the scrolled-in building', () => {
    const { ctx } = stubContext();
    const picks: number[] = [];
    const menu = menuWindow(ctx, MANY, (t) => picks.push(t));
    const p = firstRowPoint(ctx);

    // Baseline: at rest the top row is the first building.
    menu.toggle();
    menu.handleClick(p.x, p.y); // a building pick closes the menu
    const top = picks.at(-1) ?? -1;

    // Scroll five rows; the SAME screen point now lands five buildings later (the list moved under it).
    menu.toggle();
    for (let i = 0; i < 5; i++) menu.handleWheel(p.x, p.y, 120);
    menu.handleClick(p.x, p.y);
    expect(picks.at(-1)).toBe(top + 5);
  });
});

describe('tabbed-list window bound by a bottom-corner overlay', () => {
  /** A bottom-left overlay reaching high enough to bite at the stub scale - the minimap's framed window
   *  is the real one. Its x-span covers the pop-up column (`origin.x` = strip width + WIN_PAD = 56). */
  const OVERLAY: Rect = { x: 0, y: 260, w: 224, h: SCREEN.height - 260 };

  /** The lowest canvas y the open window still claims, probed down its own column: the controller keeps
   *  its layout private, and `claims` is the seam the panel routes presses through anyway. */
  function claimedBottom(menu: { claims(x: number, y: number): boolean }, x: number): number {
    let last = -1;
    for (let y = 0; y < SCREEN.height; y++) {
      if (menu.claims(x, y)) last = y;
    }
    return last;
  }

  const columnX = (ctx: PanelContext): number => ctx.layout.width + WIN_PAD * ctx.scale + 1;

  it('shortens the list so no row is left under the overlay', () => {
    const unbounded = stubContext().ctx;
    const bounded = stubContext(() => OVERLAY).ctx;
    const free = menuWindow(unbounded, MANY, () => undefined);
    const clipped = menuWindow(bounded, MANY, () => undefined);
    free.toggle();
    clipped.toggle();

    // Without the reserve the same list reaches into the overlay - the bug this bounds.
    expect(claimedBottom(free, columnX(unbounded))).toBeGreaterThanOrEqual(OVERLAY.y);
    expect(claimedBottom(clipped, columnX(bounded))).toBeLessThan(OVERLAY.y);
  });

  it('keeps the full screen-foot height when the overlay is clear of the window x-span', () => {
    const unbounded = stubContext().ctx;
    // Right edge exactly at the window's left edge: rects are half-open, so this is no overlap.
    const narrow: Rect = { ...OVERLAY, w: unbounded.layout.width + WIN_PAD * unbounded.scale };
    const beside = stubContext(() => narrow).ctx;
    const free = menuWindow(unbounded, MANY, () => undefined);
    const other = menuWindow(beside, MANY, () => undefined);
    free.toggle();
    other.toggle();

    expect(claimedBottom(other, columnX(beside))).toBe(claimedBottom(free, columnX(unbounded)));
  });

  it('clears the real minimap window at the shipped uiscales', () => {
    // The shipped bottom-left overlay, not a fixture: the wired reserve is exactly this rect.
    const bounds = terrainWorldBounds(200, 200);
    for (const uiscale of [1, 1.25, 1.4, 1.75, 2]) {
      const screen = { width: 1400, height: 900 };
      const panel = minimapLayout(bounds, screen.height, uiscale).panel;
      const layout = buildToolPanelLayout(uiscale);
      const ctx: PanelContext = { ...stubContext().ctx, layout, scale: layout.scale };
      const menu = menuWindow({ ...ctx, screen: () => screen, overlayReserve: () => panel }, MANY, () => {});
      menu.toggle();
      const x = layout.width + WIN_PAD * layout.scale + 1;
      let lowest = -1;
      for (let y = 0; y < screen.height; y++) {
        if (menu.claims(x, y)) lowest = y;
      }
      expect({ uiscale, covered: lowest >= panel.y }).toEqual({ uiscale, covered: false });
    }
  });

  it('re-fits on refresh when the overlay moves', () => {
    let overlay: Rect | null = OVERLAY;
    const { ctx } = stubContext(() => overlay);
    const menu = menuWindow(ctx, MANY, () => undefined);
    menu.toggle();
    const clipped = claimedBottom(menu, columnX(ctx));

    overlay = null; // the overlay went away - the next frame must grow the list back
    menu.refresh();
    expect(claimedBottom(menu, columnX(ctx))).toBeGreaterThan(clipped);
  });
});

describe('tabbed-list window controller (goods palette)', () => {
  // Both sit in the default 'Surowce' tab (category 2, see good-categories.ts), so they list on open.
  const GOODS: readonly MenuGoodEntry[] = [
    { goodType: 10, id: 'wood', label: 'Drewno' },
    { goodType: 11, id: 'stone', label: 'Kamień' },
  ];

  /** The same layout the controller builds internally - dropping from the palette's own strip button. */
  const expectedLayout = (ctx: PanelContext) => expectedListLayout(ctx, goodsTabbedList(GOODS));

  const goodsWindow = (ctx: PanelContext, onPick: (goodType: number) => void) =>
    createTabbedListWindow({
      ctx,
      container: new Container(),
      source: goodsTabbedList(GOODS),
      onPick: (g) => onPick(g.goodType),
    });

  it('opens on toggle, claims the window rect, and closes on the close box', () => {
    const { ctx } = stubContext();
    const goods = goodsWindow(ctx, () => undefined);
    const geo = expectedLayout(ctx);

    expect(goods.isOpen()).toBe(false);
    expect(goods.claims(geo.window.x + 1, geo.window.y + 1)).toBe(false); // closed → no claim

    goods.toggle();
    expect(goods.isOpen()).toBe(true);
    expect(goods.claims(geo.window.x + 1, geo.window.y + 1)).toBe(true);
    expect(goods.claims(geo.window.x - 1, geo.window.y - 1)).toBe(false); // outside the window

    const close = centreOf(geo.closeRect);
    expect(goods.handleClick(close.x, close.y)).toBe(true);
    expect(goods.isOpen()).toBe(false);
  });

  it('closes itself BEFORE handing a picked good to onPick', () => {
    const { ctx } = stubContext();
    const picks: Array<{ goodType: number; openAtPick: boolean }> = [];
    const goods = goodsWindow(ctx, (goodType) => picks.push({ goodType, openAtPick: goods.isOpen() }));
    goods.toggle();
    const row = centreOf(expectedLayout(ctx).rows[0]?.rect ?? { x: 0, y: 0, w: 0, h: 0 });

    expect(goods.handleClick(row.x, row.y)).toBe(true);
    expect(picks).toEqual([{ goodType: 10, openAtPick: false }]);
  });

  it('does not consume clicks outside the open window', () => {
    const { ctx } = stubContext();
    const goods = goodsWindow(ctx, () => undefined);
    goods.toggle();
    expect(goods.handleClick(SCREEN.width - 1, SCREEN.height - 1)).toBe(false);
    expect(goods.isOpen()).toBe(true);
  });

  it('drops from the mission button that opens it, not from the strip top', () => {
    const { ctx } = stubContext();
    const goods = goodsWindow(ctx, () => undefined);
    goods.toggle();
    const x = ctx.layout.width + WIN_PAD * ctx.scale + 1;
    expect(goods.claims(x, anchorY(ctx, 'mission') + 1)).toBe(true);
    // Where the palette used to open: above its button, so nothing of it may reach up there.
    expect(goods.claims(x, ctx.layout.strip.y + 1)).toBe(false);
  });
});

describe('stats window controller', () => {
  it('rebuilds only when a tally row changes, never on the tick row alone', () => {
    const { ctx, made } = stubContext();
    const stats = createStatsWindow({ ctx, container: new Container() });

    stats.refresh(() => hud(1, 5));
    expect(made).toHaveLength(0); // closed → no build

    stats.toggle();
    stats.refresh(() => hud(1, 5));
    const builtOnce = made.length;
    expect(builtOnce).toBeGreaterThan(0); // first open refresh builds title + rows

    stats.refresh(() => hud(2, 5)); // only the tick advanced
    expect(made).toHaveLength(builtOnce); // ← the per-frame guard: no glyph rebuild

    stats.refresh(() => hud(3, 6)); // a tally changed
    expect(made.length).toBeGreaterThan(builtOnce);
  });

  it('pulls the HUD read-view only while open', () => {
    const { ctx } = stubContext();
    const stats = createStatsWindow({ ctx, container: new Container() });
    let builds = 0;
    const pull = (): HudLayout => {
      builds++;
      return hud(1, 5);
    };

    stats.refresh(pull);
    stats.refresh(pull);
    expect(builds).toBe(0); // the frame must not pay buildHud's entity scan for a closed window

    stats.toggle();
    stats.refresh(pull);
    expect(builds).toBe(1);
  });

  it('claims only the drawn rect while open, and a click inside closes it', () => {
    const { ctx } = stubContext();
    const stats = createStatsWindow({ ctx, container: new Container() });
    stats.toggle();
    stats.refresh(() => hud(1, 5));

    // The drawn rect's origin mirrors the controller's own formula; probe just inside it.
    const x = ctx.layout.width + STATS_GAP_X * ctx.scale + 1;
    const y = ctx.layout.strip.y + STATS_OFFSET_Y * ctx.scale + 1;
    expect(stats.claims(x, y)).toBe(true);
    expect(stats.handleClick(x, y)).toBe(true);
    expect(stats.isOpen()).toBe(false);
    expect(stats.claims(x, y)).toBe(false);
  });
});

/** A stateful stand-in for the sim counter seam: `read()` serves what `set()` stored (as if the
 *  command already applied), and `writes` records every absolute face the window pushed through. */
function stubCountersSeam(): {
  seam: ExtrasCountersSeam;
  writes: [AssistantCounterId, number, boolean][];
} {
  const faces: Record<AssistantCounterId, AssistantCounterFace> = { ...defaultAssistantState().counters };
  const writes: [AssistantCounterId, number, boolean][] = [];
  return {
    seam: {
      read: () => ({ ...faces }),
      set: (id, value, infinite) => {
        writes.push([id, value, infinite]);
        faces[id] = { value, infinite };
        return true;
      },
    },
    writes,
  };
}

describe('tool windows registry', () => {
  const GRANTS: ExtrasGrantsSeam = {
    read: () => ({ giveBoots: true, giveWoodenTools: true, giveIronTools: true, giveMead: true }),
    set: () => true,
  };
  /** `windows.ts`'s mount order: each pop-up's child index in the panel's window container, which is the
   *  order they draw in. */
  const MOUNT_INDEX = { menu: 0, goods: 1, extras: 2, stats: 3 } as const;

  function mountWindows(buildings: readonly MenuBuildingEntry[] = BUILDINGS) {
    const { ctx: base } = stubContext();
    const picks: number[] = [];
    const container = new Container();
    /** Every text run built so far, to check which pop-up ends up drawing it. */
    const textRuns: Container[] = [];
    const ctx: PanelContext = {
      ...base,
      makeText: (text, color, px) => {
        const run = base.makeText(text, color, px);
        textRuns.push(run.container);
        return run;
      },
    };
    const windows = createToolWindows({
      ctx,
      container,
      buildings,
      goods: [{ goodType: 10, id: 'wood', label: 'Drewno' }],
      grants: GRANTS,
      counters: stubCountersSeam().seam,
      onPickBuilding: (typeId) => picks.push(typeId),
      onPickGood: () => undefined,
    });
    return { ctx, windows, picks, container, textRuns };
  }

  /** The row-wash layer's index inside a tabbed list's own container (back < frame < hover < labels). */
  const HOVER_LAYER = 2;

  /** The container one pop-up draws everything inside, by its mount index. */
  function popupContainer(container: Container, at: number): Container {
    const win = container.children[at];
    if (!(win instanceof Container)) throw new Error(`no pop-up mounted at index ${at}`);
    return win;
  }

  /** Whether the build menu's row-hover highlight is drawn. */
  function hasRowHighlight(container: Container): boolean {
    const layer = popupContainer(container, MOUNT_INDEX.menu).children[HOVER_LAYER];
    if (!(layer instanceof Graphics)) throw new Error('the build menu no longer owns its hover layer');
    return layer.context.instructions.length > 0;
  }

  it('claims a point only while a pop-up is open under it', () => {
    const { ctx, windows } = mountWindows();
    const inside = centreOf(expectedMenuLayout(ctx).window);

    expect(windows.claims(inside.x, inside.y)).toBe(false); // all closed → the world keeps the point
    windows.byId.menu.toggle();
    expect(windows.claims(inside.x, inside.y)).toBe(true);
    expect(windows.claims(SCREEN.width - 1, SCREEN.height - 1)).toBe(false);
  });

  it('routes a click to the open pop-up under the point and passes on the rest', () => {
    const { ctx, windows, picks } = mountWindows();
    windows.byId.menu.toggle();
    const row = centreOf(expectedMenuLayout(ctx).rows[1]?.rect ?? { x: 0, y: 0, w: 0, h: 0 });

    expect(windows.handleClick(row.x, row.y)).toBe(true);
    expect(picks).toEqual([23]); // reached the build menu's pick → the panel's placement mode
    // Nothing open under the point: the press falls through to placement / world picking.
    expect(windows.handleClick(SCREEN.width - 1, SCREEN.height - 1)).toBe(false);
  });

  it('probes the pop-ups in draw order, so an overlap goes to the top-drawn window', () => {
    const { ctx, windows, picks } = mountWindows();
    windows.byId.menu.toggle();
    windows.byId.stats.toggle();
    windows.refresh(() => TALL_HUD); // the stats window draws (and gains its rect) on its first refresh

    // Statistics draws after (over) the build menu and its column overlaps the menu's list: a point
    // inside the statistics panel and inside the menu's first building row.
    const row = expectedMenuLayout(ctx).rows[0]?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    const shared = { x: ctx.layout.width + STATS_GAP_X * ctx.scale + 1, y: row.y + 1 };
    expect(windows.byId.menu.claims(shared.x, shared.y)).toBe(true);
    expect(windows.byId.stats.claims(shared.x, shared.y)).toBe(true);

    expect(windows.handleClick(shared.x, shared.y)).toBe(true);
    expect(windows.byId.stats.isOpen()).toBe(false); // statistics took the press and closed on inside
    expect(windows.byId.menu.isOpen()).toBe(true);
    expect(picks).toEqual([]); // the covered menu row must not enter building placement
  });

  it('gives the wheel to the top-drawn window instead of scrolling a covered list', () => {
    const { ctx, windows, picks } = mountWindows(MANY);
    windows.byId.menu.toggle();
    windows.byId.stats.toggle();
    windows.refresh(() => TALL_HUD);

    const row = expectedMenuLayout(ctx, MANY).rows[0]?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    const covered = { x: ctx.layout.width + STATS_GAP_X * ctx.scale + 1, y: row.y + 1 };
    expect(windows.byId.stats.claims(covered.x, covered.y)).toBe(true);

    expect(windows.handleWheel(covered.x, covered.y, 120)).toBe(true); // statistics owns the wheel there
    // The list did not move under the cursor: the uncovered part of the same row still picks the first
    // building (a scroll would have paged it forward).
    const uncovered = firstRowPoint(ctx);
    windows.handleClick(uncovered.x, uncovered.y);
    expect(picks).toEqual([MANY[0]?.typeId]);
  });

  it('drops the build-menu row highlight where another pop-up covers the point', () => {
    const { ctx, windows, container } = mountWindows();
    windows.byId.menu.toggle();
    windows.byId.stats.toggle();
    windows.refresh(() => TALL_HUD);

    const row = expectedMenuLayout(ctx).rows[0]?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    windows.handleHover(row.x + 1, row.y + 1);
    expect(hasRowHighlight(container)).toBe(true);

    // The same row, but under the statistics window: highlighting it would promise a pick the press
    // no longer makes.
    windows.handleHover(ctx.layout.width + STATS_GAP_X * ctx.scale + 1, row.y + 1);
    expect(hasRowHighlight(container)).toBe(false);
  });

  it('keeps a rebuilt menu below a pop-up mounted after it', () => {
    const { ctx, windows, container, textRuns } = mountWindows(MANY);
    windows.byId.menu.toggle();
    windows.byId.stats.toggle();
    windows.refresh(() => TALL_HUD); // the per-frame pass refreshes in mount order, statistics last
    expect(textRuns.at(-1)?.parent).toBe(popupContainer(container, MOUNT_INDEX.stats));

    textRuns.length = 0; // from here only the menu rebuilds, so every new run is one of its labels
    const p = firstRowPoint(ctx);
    expect(windows.handleWheel(p.x, p.y, 120)).toBe(true); // a scroll repaints its chrome and labels
    expect(textRuns.length).toBeGreaterThan(0);

    // Each pop-up draws inside one child of the panel's container, so the menu's labels stay under the
    // statistics frame mounted after them instead of landing on top of it.
    expect(container.children).toHaveLength(Object.keys(MOUNT_INDEX).length);
    const menu = popupContainer(container, MOUNT_INDEX.menu);
    for (const run of textRuns) expect(run.parent).toBe(menu);
  });

  it('consumes the wheel over any open pop-up, list or not', () => {
    const { ctx, windows } = mountWindows();
    const overStats = {
      x: ctx.layout.width + STATS_GAP_X * ctx.scale + 1,
      y: ctx.layout.strip.y + STATS_OFFSET_Y * ctx.scale + 1,
    };
    expect(windows.handleWheel(overStats.x, overStats.y, 120)).toBe(false); // closed → the camera zooms

    windows.byId.stats.toggle();
    windows.refresh(() => hud(1, 5));
    // The statistics window has no scrollable list, but the wheel must not page the document behind it.
    expect(windows.handleWheel(overStats.x, overStats.y, 120)).toBe(true);
  });

  it('scrolls the build menu with the wheel it consumed', () => {
    const { ctx, windows, picks } = mountWindows(MANY);
    const p = firstRowPoint(ctx);

    // Baseline: at rest the top row is the first building (a pick closes the menu).
    windows.byId.menu.toggle();
    windows.handleClick(p.x, p.y);
    const top = picks.at(-1) ?? -1;

    // Five wheels through the registry; the SAME point now clicks five buildings later.
    windows.byId.menu.toggle();
    for (let i = 0; i < 5; i++) expect(windows.handleWheel(p.x, p.y, 120)).toBe(true);
    windows.handleClick(p.x, p.y);
    expect(picks.at(-1)).toBe(top + 5);
  });

  it('pulls the HUD read-view in the per-frame pass only for an open window', () => {
    const { windows } = mountWindows();
    let builds = 0;
    const pull = (): HudLayout => {
      builds++;
      return hud(1, 5);
    };

    windows.refresh(pull);
    expect(builds).toBe(0); // a closed statistics window must not cost the frame its entity scan

    windows.byId.stats.toggle();
    windows.refresh(pull);
    expect(builds).toBe(1);
  });
});

describe('placement controller', () => {
  function mount(
    screenToTile: (x: number, y: number) => { col: number; row: number } | null,
    canPlaceAt: (typeId: number, col: number, row: number) => boolean = () => true,
  ) {
    const { ctx } = stubContext();
    const commands: Command[] = [];
    const placement = createPlacementController({
      ctx,
      container: new Container(),
      labelByType: new Map([[23, 'Joinery']]),
      enqueue: (c) => commands.push(c),
      screenToTile,
      canPlaceAt,
      tribe: 1,
      owner: 0,
    });
    return { placement, commands };
  }

  it('places a construction site at an accepted tile and EXITS build mode (one click = one foundation)', () => {
    const { placement, commands } = mount(() => ({ col: 4, row: 2 }));
    expect(placement.handleClick(10, 10)).toBe(false); // not active yet → not consumed

    placement.enter(23);
    expect(placement.isActive()).toBe(true);
    expect(placement.handleClick(10, 10)).toBe(true);
    // Player placement is always a construction site (`underConstruction`) - builders raise it globally.
    expect(commands).toEqual([
      { kind: 'placeBuilding', buildingType: 23, x: 4, y: 2, tribe: 1, owner: 0, underConstruction: true },
    ]);
    expect(placement.isActive()).toBe(false); // landed → build mode over (the original's flow)
  });

  it('a click on ground the placement rule rejects is consumed but inert (mode survives)', () => {
    const { placement, commands } = mount(
      () => ({ col: 4, row: 2 }),
      () => false, // the probe says the anchor doesn't fit here
    );
    placement.enter(23);
    expect(placement.handleClick(10, 10)).toBe(true); // claimed - never falls through to picking
    expect(commands).toHaveLength(0); // nothing enqueued: the sim would drop it anyway
    expect(placement.isActive()).toBe(true); // a mis-click on the dim wash doesn't end the mode
  });

  it('consumes an off-map click without enqueuing, and cancel exits the mode', () => {
    const { placement, commands } = mount(() => null);
    placement.enter(23);
    expect(placement.handleClick(10, 10)).toBe(true); // claimed, but nothing placed
    expect(commands).toHaveLength(0);

    placement.cancel();
    expect(placement.isActive()).toBe(false);
    expect(placement.handleClick(10, 10)).toBe(false);
  });
});

describe('extras window controller', () => {
  /** A stateful stand-in for the sim grant seam: `read()` serves what `set()` stored (as if the
   *  command already applied), and `writes` records every toggle the window pushed through. */
  function stubGrantsSeam(initial?: Partial<Record<AssistantGrantId, boolean>>): {
    seam: ExtrasGrantsSeam;
    writes: [AssistantGrantId, boolean][];
  } {
    const state: Record<AssistantGrantId, boolean> = {
      giveBoots: true,
      giveWoodenTools: true,
      giveIronTools: true,
      giveMead: true,
      ...initial,
    };
    const writes: [AssistantGrantId, boolean][] = [];
    return {
      seam: {
        read: () => ({ ...state }),
        set: (id, enabled) => {
          writes.push([id, enabled]);
          state[id] = enabled;
          return true;
        },
      },
      writes,
    };
  }

  /** The same layout the controller builds internally (same origin formula + default state):
   *  right of the strip, dropping from the extras (chest) button. */
  function expectedLayout(ctx: PanelContext) {
    const extrasY = ctx.layout.buttons.find((b) => b.id === 'extras')?.placed.y ?? ctx.layout.strip.y;
    return layoutExtrasMenu({
      originX: ctx.layout.width + WIN_PAD * ctx.scale,
      originY: extrasY,
      scale: ctx.scale,
      tab: 'assistant',
      state: defaultAssistantState(),
    });
  }

  it('opens on toggle, claims the window rect, and closes on the close box', () => {
    const { ctx } = stubContext();
    const extras = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: stubGrantsSeam().seam,
      counters: stubCountersSeam().seam,
    });
    const geo = expectedLayout(ctx);

    expect(extras.isOpen()).toBe(false);
    expect(extras.claims(geo.window.x + 1, geo.window.y + 1)).toBe(false); // closed → no claim

    extras.toggle();
    expect(extras.isOpen()).toBe(true);
    expect(extras.claims(geo.window.x + 1, geo.window.y + 1)).toBe(true);
    expect(extras.claims(geo.window.x - 1, geo.window.y - 1)).toBe(false); // outside the window

    const close = centreOf(geo.closeRect);
    expect(extras.handleClick(close.x, close.y)).toBe(true);
    expect(extras.isOpen()).toBe(false);
  });

  it('steppers and switches write their seams; both faces read back on reopen', () => {
    const { ctx, made } = stubContext();
    const { seam, writes } = stubGrantsSeam();
    const counters = stubCountersSeam();
    const extras = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: seam,
      counters: counters.seam,
    });
    const geo = expectedLayout(ctx);
    extras.toggle();

    // + on the first counter: the rebuilt window draws "1" and one absolute face went to the sim.
    const plus = centreOf(geo.counters[0]?.plusRect ?? { x: 0, y: 0, w: 0, h: 0 });
    made.length = 0;
    expect(extras.handleClick(plus.x, plus.y)).toBe(true);
    expect(made).toContain('1');
    expect(counters.writes).toEqual([['extraWomen', 1, false]]);

    // The mead switch flips its face to OFF and writes the toggle through the seam.
    const sw = centreOf(geo.grants[3]?.switchRect ?? { x: 0, y: 0, w: 0, h: 0 });
    made.length = 0;
    expect(extras.handleClick(sw.x, sw.y)).toBe(true);
    expect(made).toContain(messages().hud.extras.off);
    expect(writes).toEqual([['giveMead', false]]);

    // Close and reopen: both blocks read back from their seams.
    extras.toggle();
    made.length = 0;
    extras.toggle();
    expect(made).toContain('1');
    expect(made).toContain(messages().hud.extras.off);
  });

  it('Ctrl-click steps by ten and the infinity toggle writes the flag', () => {
    const { ctx, made } = stubContext();
    const counters = stubCountersSeam();
    const extras = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: stubGrantsSeam().seam,
      counters: counters.seam,
    });
    const geo = expectedLayout(ctx);
    extras.toggle();

    const plus = centreOf(geo.counters[1]?.plusRect ?? { x: 0, y: 0, w: 0, h: 0 });
    made.length = 0;
    expect(extras.handleClick(plus.x, plus.y, { bigStep: true })).toBe(true);
    expect(made).toContain('10');
    expect(counters.writes).toEqual([['extraMen', 10, false]]);

    // The infinity toggle keeps the stored value and flips the flag; the first step off it only
    // surfaces that hidden value (the lemniscate covers the number), the next one moves it.
    const infinity = centreOf(geo.counters[1]?.infinityRect ?? { x: 0, y: 0, w: 0, h: 0 });
    expect(extras.handleClick(infinity.x, infinity.y)).toBe(true);
    expect(counters.writes.at(-1)).toEqual(['extraMen', 10, true]);
    expect(extras.handleClick(plus.x, plus.y)).toBe(true);
    expect(counters.writes.at(-1)).toEqual(['extraMen', 10, false]);
    expect(extras.handleClick(plus.x, plus.y)).toBe(true);
    expect(counters.writes.at(-1)).toEqual(['extraMen', 11, false]);
  });

  it('a rejected write (a read-only session) leaves the switch face untouched', () => {
    const { ctx, made } = stubContext();
    const rejecting: ExtrasGrantsSeam = { read: stubGrantsSeam().seam.read, set: () => false };
    const extras = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: rejecting,
      counters: stubCountersSeam().seam,
    });
    const geo = expectedLayout(ctx);
    extras.toggle();

    const sw = centreOf(geo.grants[3]?.switchRect ?? { x: 0, y: 0, w: 0, h: 0 });
    made.length = 0;
    expect(extras.handleClick(sw.x, sw.y)).toBe(true); // still consumed by the window
    expect(made).toEqual([]); // no rebuild: the face never flipped, so it cannot lie
  });

  it('reads the switch faces from the sim seam on every open', () => {
    const { ctx, made } = stubContext();
    const { seam } = stubGrantsSeam({ giveIronTools: false });
    const extras = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: seam,
      counters: stubCountersSeam().seam,
    });

    extras.toggle();
    expect(made).toContain(messages().hud.extras.off); // the iron-tools switch mirrors the sim

    extras.toggle(); // close
    seam.set('giveIronTools', true); // the sim state moved while the window was closed
    made.length = 0;
    extras.toggle();
    expect(made).not.toContain(messages().hud.extras.off); // every switch reads back ON
  });

  it('the plans tab replaces the controls with the placeholder; clicks there are inert but consumed', () => {
    const { ctx, made } = stubContext();
    const extras = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: stubGrantsSeam().seam,
      counters: stubCountersSeam().seam,
    });
    const geo = expectedLayout(ctx);
    extras.toggle();

    const plansTab = centreOf(geo.tabs[1]?.rect ?? { x: 0, y: 0, w: 0, h: 0 });
    made.length = 0;
    expect(extras.handleClick(plansTab.x, plansTab.y)).toBe(true);
    expect(made).toContain(messages().hud.extras.plansEmpty);
    expect(made).not.toContain(messages().hud.extras.extraWomen);

    // A click where a stepper used to sit is now bare chrome or outside the shrunken window - never a step.
    const plus = centreOf(geo.counters[0]?.plusRect ?? { x: 0, y: 0, w: 0, h: 0 });
    made.length = 0;
    extras.handleClick(plus.x, plus.y);
    expect(made).not.toContain('1');
  });

  it('does not consume clicks outside the open window', () => {
    const { ctx } = stubContext();
    const extras = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: stubGrantsSeam().seam,
      counters: stubCountersSeam().seam,
    });
    extras.toggle();
    expect(extras.handleClick(SCREEN.width - 1, SCREEN.height - 1)).toBe(false);
    expect(extras.isOpen()).toBe(true);
  });
});
