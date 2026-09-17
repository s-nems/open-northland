import type { UiCue } from '@open-northland/audio';
import { type HudLayout, terrainWorldBounds } from '@open-northland/render';
import type { Command, Paper } from '@open-northland/sim';
import { Container, Graphics, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/hud/geometry.js';
import { minimapLayout } from '../src/hud/minimap/model.js';
import { navBeamRect } from '../src/hud/nav-beam.js';
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
import { paperFace } from '../src/hud/tool-panel/extras-papers.js';
import {
  createExtrasWindow,
  type ExtrasCountersSeam,
  type ExtrasGrantsSeam,
} from '../src/hud/tool-panel/extras-window.js';
import { createHeldPaperController } from '../src/hud/tool-panel/held-paper.js';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';
import { createPlacementController } from '../src/hud/tool-panel/placement.js';
import { createStatsWindow } from '../src/hud/tool-panel/stats-window.js';
import {
  createTabbedListWindow,
  layoutTabbedList,
  type TabbedListSource,
} from '../src/hud/tool-panel/tabbed-list/index.js';
import { standardWindowWidth } from '../src/hud/tool-panel/window-family/index.js';
import { createToolWindows } from '../src/hud/tool-panel/windows.js';
import { messages } from '../src/i18n/index.js';
import { stubPendingWindow } from './support/pending-window-stub.js';

/**
 * Headless tests for the tool-panel WINDOW CONTROLLERS (menu / stats / placement) over a stubbed
 * {@link PanelContext} - the seams the package split opened up. These pin the input-routing contracts
 * the mount relies on (claim regions, close-on-pick, close-on-inside) and the stats change-key guard
 * (a tick-only change must NOT rebuild the glyph runs - the per-frame perf contract).
 */

const SCREEN = { width: 800, height: 600 };

/** A PanelContext whose text factory records what it was asked to build (no Pixi text, no fonts), and
 *  whose GUI cue records every click it was asked to play. */
function stubContext(overlayReserve?: () => Rect | null): {
  ctx: PanelContext;
  made: string[];
  cues: UiCue[];
} {
  const made: string[] = [];
  const cues: UiCue[] = [];
  const layout = buildToolPanelLayout(1);
  const ctx: PanelContext = {
    layout,
    scale: layout.scale,
    makeText: (text): TextRun => {
      made.push(text);
      return { container: new Container(), width: 0, place: () => undefined, destroy: () => undefined };
    },
    makeParagraph: () => ({
      container: new Container(),
      width: 0,
      height: 0,
      place: () => undefined,
      destroy: () => undefined,
    }),
    bitmaps: { bg: undefined, button: undefined, buttonHilite: undefined, headline: undefined },
    uiString: (_table, _id, fallback) => fallback,
    screen: () => SCREEN,
    cue: (cue) => {
      cues.push(cue);
    },
    ...(overlayReserve !== undefined ? { overlayReserve } : {}),
    atScale: (scale) => ({ ...ctx, scale }),
  };
  return { ctx, made, cues };
}

const BUILDINGS: readonly MenuBuildingEntry[] = [
  { typeId: 1, label: 'Headquarters', kind: 'storage' },
  { typeId: 23, label: 'Joinery', kind: 'workplace' },
];

/** The stats window's width, which `stats-window.ts` keeps private (design px). */
const STATS_WIDTH = 150;

/** Where a pop-up `width` screen px wide opens: centred in the window region the layout resolves for
 *  the stub screen (the shared origin rule of every controller). */
function windowOrigin(ctx: PanelContext, width: number): { x: number; y: number } {
  return ctx.layout.windowOrigin(ctx.screen(), width);
}

/** The stats window's origin; its content-sized sheet is far shorter than the region, so no lift. */
const statsOrigin = (ctx: PanelContext): { x: number; y: number } =>
  windowOrigin(ctx, STATS_WIDTH * ctx.scale);

/** The extras window's origin and scale, as its controller derives them: measured, then centred. */
function extrasGeometry(ctx: PanelContext) {
  const state = defaultAssistantState();
  const measured = layoutExtrasMenu({ originX: 0, originY: 0, scale: ctx.scale, tab: 'assistant', state });
  const origin = windowOrigin(ctx, measured.window.w);
  return { originX: origin.x, originY: origin.y, scale: ctx.scale, state };
}

function centreXY(r: { x: number; y: number; w: number; h: number }): [number, number] {
  return [r.x + r.w / 2, r.y + r.h / 2];
}

/** The centre of a rect (for synthetic clicks). */
function centreOf(r: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** The same layout the shared tabbed-list controller computes internally (same origin formula + inputs):
 *  the family's standard width centred in the window region. These fixtures are shorter than the
 *  stub screen's viewport, so the controller's row cap does not bind. */
function expectedListLayout<Id, Item extends { readonly label: string }>(
  ctx: PanelContext,
  source: TabbedListSource<Id, Item>,
) {
  const origin = windowOrigin(ctx, standardWindowWidth(ctx.scale));
  return layoutTabbedList({
    originX: origin.x,
    originY: origin.y,
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
  const origin = windowOrigin(ctx, standardWindowWidth(ctx.scale));
  return { x: origin.x + 20, y: origin.y + 45 * ctx.scale };
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

/** An empty papers list, for the windows that never open the plans tab. */
const NO_PAPERS = { read: (): readonly Paper[] => [] };

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

  it('clicks confirm for a row, a tab and the close box, but not for the window body', () => {
    const { ctx, cues } = stubContext();
    const menu = menuWindow(ctx, BUILDINGS, () => undefined);
    menu.toggle();
    const geo = expectedMenuLayout(ctx);
    // The window's bottom margin is consumed but is no button.
    const body = { x: geo.window.x + 2, y: geo.window.y + geo.window.h - 2 };
    expect(menu.handleClick(body.x, body.y)).toBe(true);
    expect(cues).toEqual([]);
    const row = centreOf(geo.rows[1]?.rect ?? { x: 0, y: 0, w: 0, h: 0 });
    menu.handleClick(row.x, row.y); // picks and closes
    expect(cues).toEqual(['confirm']);
    menu.toggle();
    const tab = centreOf(geo.tabs[1]?.rect ?? { x: 0, y: 0, w: 0, h: 0 });
    menu.handleClick(tab.x, tab.y);
    expect(cues).toEqual(['confirm', 'confirm']);
    const close = centreOf(expectedMenuLayout(ctx).closeRect);
    menu.handleClick(close.x, close.y);
    expect(cues).toEqual(['confirm', 'confirm', 'confirm']);
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

  it('restores the selected tab and scroll position into replacement chrome', () => {
    const { ctx } = stubContext();
    const original = menuWindow(ctx, MANY, () => undefined);
    const point = firstRowPoint(ctx);
    original.toggle();
    for (let i = 0; i < 5; i++) original.handleWheel(point.x, point.y, 120);

    const saved = original.state();
    const picks: number[] = [];
    const replacement = menuWindow(ctx, MANY, (typeId) => picks.push(typeId));
    replacement.restore(saved);
    replacement.toggle();
    replacement.handleClick(point.x, point.y);

    expect(saved).toEqual({ selected: 'all', scrollTop: 5 });
    expect(picks).toEqual([205]);
  });
});

describe('tabbed-list window bound by the beam and the bottom-corner overlay', () => {
  /** The lowest canvas y the open window still claims, probed down its own column: the controller keeps
   *  its layout private, and `claims` is the seam the panel routes presses through anyway. */
  function claimedBottom(
    menu: { claims(x: number, y: number): boolean },
    x: number,
    screenH: number,
  ): number {
    let last = -1;
    for (let y = 0; y < screenH; y++) {
      if (menu.claims(x, y)) last = y;
    }
    return last;
  }

  const columnX = (ctx: PanelContext): number => windowOrigin(ctx, standardWindowWidth(ctx.scale)).x + 1;

  it('shortens the list so no row is left under the navigation beam', () => {
    const { ctx } = stubContext();
    const menu = menuWindow(ctx, MANY, () => undefined);
    menu.toggle();
    const beam = navBeamRect(SCREEN, ctx.scale);
    const bottom = claimedBottom(menu, columnX(ctx), SCREEN.height);
    expect(bottom).toBeGreaterThan(0);
    expect(bottom).toBeLessThan(beam.y);
  });

  it('yields to the minimap where a window wider than the region crosses it', () => {
    // A screen so narrow the standard window centres over the bottom-left overlay.
    const screen = { width: 640, height: 600 };
    const overlay: Rect = { x: 0, y: 260, w: 224, h: screen.height - 260 };
    const free: PanelContext = { ...stubContext().ctx, screen: () => screen };
    const bounded: PanelContext = { ...stubContext(() => overlay).ctx, screen: () => screen };
    const wide = menuWindow(free, MANY, () => undefined);
    const clipped = menuWindow(bounded, MANY, () => undefined);
    wide.toggle();
    clipped.toggle();
    expect(windowOrigin(free, standardWindowWidth(1)).x).toBeLessThan(overlay.x + overlay.w);
    expect(claimedBottom(wide, columnX(free), screen.height)).toBeGreaterThanOrEqual(overlay.y);
    expect(claimedBottom(clipped, columnX(free), screen.height)).toBeLessThan(overlay.y);
  });

  it('clears the beam and the real minimap window across the reachable and pinned uiscales', () => {
    // The shipped bottom-left overlay, not a fixture: the wired reserve is exactly this rect.
    const bounds = terrainWorldBounds(200, 200);
    for (const uiscale of [1, 1.25, 1.4, 1.75, 2]) {
      const screen = { width: 1400, height: 900 };
      const panel = minimapLayout(bounds, screen.height, uiscale).panel;
      const layout = buildToolPanelLayout(uiscale);
      const ctx: PanelContext = { ...stubContext().ctx, layout, scale: layout.scale, screen: () => screen };
      const menu = menuWindow({ ...ctx, overlayReserve: () => panel }, MANY, () => {});
      menu.toggle();
      const x = columnX(ctx);
      const lowest = claimedBottom(menu, x, screen.height);
      const beam = navBeamRect(screen, layout.scale);
      const floor = Math.min(beam.y, x < panel.x + panel.w ? panel.y : screen.height);
      expect({ uiscale, covered: lowest >= floor }).toEqual({ uiscale, covered: false });
    }
  });

  it('re-fits on refresh when the screen changes', () => {
    // Short enough that the beam, not the row cap, bounds the list.
    let screen = { width: SCREEN.width, height: 420 };
    const live: PanelContext = { ...stubContext().ctx, screen: () => screen };
    const menu = menuWindow(live, MANY, () => undefined);
    menu.toggle();
    const before = claimedBottom(menu, columnX(live), 2000);

    screen = { width: SCREEN.width, height: SCREEN.height + 300 }; // a taller screen lowers the beam
    menu.refresh();
    expect(claimedBottom(menu, columnX(live), 2000)).toBeGreaterThan(before);
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
    const x = statsOrigin(ctx).x + 1;
    const y = statsOrigin(ctx).y + 1;
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
  const MOUNT_INDEX = { menu: 0, extras: 1, stats: 2, diplomacy: 3, mission: 4 } as const;

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
      pendingWindow: stubPendingWindow,
      grants: GRANTS,
      counters: stubCountersSeam().seam,
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      heldPaper: createHeldPaperController(ctx, new Container()), // the banner layer, not a pop-up
      diplomacyRows: () => [],
      art: null,
      missionBrief: () => null,
      missionBriefingHistory: () => [],
      missionReplayPage: () => null,
      history: null,
      onPickBuilding: (typeId) => picks.push(typeId),
      onPayTribute: () => undefined,
      onDeclareDiplomacy: () => undefined,
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

  it('a house paper goes straight to placement; a place-any paper opens the menu and rides its next pick', () => {
    const { ctx: base } = stubContext();
    const picks: [number, Paper | undefined][] = [];
    let firstBuildingLocked = true;
    const buildings = BUILDINGS.map((building, index) =>
      index === 0
        ? { ...building, disabledReason: () => (firstBuildingLocked ? 'technology locked' : null) }
        : building,
    );
    const papers: Paper[] = [
      { kind: 'placeHouse', param: 23 },
      { kind: 'placeAny', param: 0 },
    ];
    const heldPaper = createHeldPaperController(base, new Container());
    const windows = createToolWindows({
      ctx: base,
      container: new Container(),
      buildings,
      pendingWindow: stubPendingWindow,
      grants: GRANTS,
      counters: stubCountersSeam().seam,
      papers: { read: () => papers },
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      heldPaper,
      diplomacyRows: () => [],
      art: null,
      missionBrief: () => null,
      missionBriefingHistory: () => [],
      missionReplayPage: () => null,
      history: null,
      onPickBuilding: (typeId, paper) => picks.push([typeId, paper]),
      onPayTribute: () => undefined,
      onDeclareDiplomacy: () => undefined,
    });
    const extras = windows.byId.extras;
    extras.toggle();
    const plansTab = layoutExtrasMenu({ ...extrasGeometry(base), tab: 'assistant' }).tabs[1]?.rect;
    if (plansTab === undefined) throw new Error('no plans tab');
    extras.handleClick(...centreXY(plansTab));
    const plans = layoutExtrasMenu({
      ...extrasGeometry(base),
      tab: 'plans',
      papers: papers.map((p) => paperFace(p, `${p.kind}:${p.param}`)),
    });
    const houseRow = plans.papers[0]?.rect;
    const anyRow = plans.papers[1]?.rect;
    if (houseRow === undefined || anyRow === undefined) throw new Error('no paper rows');

    // The house paper: placement at once, window closed, menu untouched.
    expect(extras.handleClick(...centreXY(houseRow))).toBe(true);
    expect(picks).toEqual([[23, papers[0]]]);
    expect(extras.isOpen()).toBe(false);
    expect(windows.byId.menu.isOpen()).toBe(false);

    // The place-any paper: the build menu opens with the paper held (a banner up, a held mode), and its
    // pick carries the paper once.
    extras.toggle();
    extras.handleClick(...centreXY(plansTab));
    expect(extras.handleClick(...centreXY(anyRow))).toBe(true);
    expect(windows.byId.menu.isOpen()).toBe(true);
    expect(heldPaper.isActive()).toBe(true);
    const row = centreOf(expectedMenuLayout(base).rows[0]?.rect ?? { x: 0, y: 0, w: 0, h: 0 });
    expect(windows.handleClick(row.x, row.y)).toBe(true);
    expect(picks[1]).toEqual([BUILDINGS[0]?.typeId, papers[1]]);
    expect(windows.byId.menu.isOpen()).toBe(false); // a pick closes the menu
    expect(heldPaper.isActive()).toBe(false);

    // Closing the menu without a pick drops the held paper: the next pick is an ordinary site.
    firstBuildingLocked = false;
    extras.toggle();
    extras.handleClick(...centreXY(plansTab));
    extras.handleClick(...centreXY(anyRow));
    windows.byId.menu.toggle();
    windows.refresh(() => hud(1, 0));
    expect(heldPaper.isActive()).toBe(false);
    windows.byId.menu.toggle();
    windows.handleClick(row.x, row.y);
    expect(picks[2]).toEqual([BUILDINGS[0]?.typeId, undefined]);

    // A cancel (Esc, a right click) or a world click drops it too, and the menu stays open.
    extras.toggle();
    extras.handleClick(...centreXY(plansTab));
    extras.handleClick(...centreXY(anyRow));
    expect(heldPaper.handleClick(0, 0)).toBe(true); // a world press: consumed, the paper dropped
    expect(heldPaper.isActive()).toBe(false);
    expect(windows.byId.menu.isOpen()).toBe(true);
    expect(heldPaper.handleClick(0, 0)).toBe(false); // nothing held: the press is the world's
    heldPaper.hold(papers[1] as Paper);
    heldPaper.cancel();
    expect(windows.state().heldPaper).toBeNull();
    windows.restore({ ...windows.state(), heldPaper: papers[1] as Paper });
    expect(heldPaper.held()).toEqual(papers[1]);
  });

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
    const shared = { x: statsOrigin(ctx).x + 1, y: row.y + 1 };
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
    const covered = { x: statsOrigin(ctx).x + 1, y: row.y + 1 };
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
    windows.handleHover(statsOrigin(ctx).x + 1, row.y + 1);
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
      x: statsOrigin(ctx).x + 1,
      y: statsOrigin(ctx).y + 1,
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
    canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean = () => true,
  ) {
    const { ctx, cues } = stubContext();
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
    return { placement, commands, cues };
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

  it('a paper held into placement rides the command, and leaves with the mode', () => {
    const { placement, commands } = mount(() => ({ col: 4, row: 2 }));
    const paper = { kind: 'placeHouse', param: 23 } as const;
    placement.enter(23, paper);
    expect(placement.handleClick(10, 10)).toBe(true);
    expect(commands).toEqual([
      {
        kind: 'placeBuilding',
        buildingType: 23,
        x: 4,
        y: 2,
        tribe: 1,
        owner: 0,
        underConstruction: true,
        paper,
      },
    ]);
    placement.enter(23);
    placement.handleClick(10, 10);
    expect(commands[1]).not.toHaveProperty('paper');
  });

  it('passes a paper through the live gate so technology cannot reject its placement', () => {
    const paper = { kind: 'placeAny', param: 0 } as const;
    const seen: Array<typeof paper | undefined> = [];
    const { placement, commands } = mount(
      () => ({ col: 4, row: 2 }),
      (_type, _col, _row, activePaper) => {
        seen.push(activePaper as typeof paper | undefined);
        return activePaper !== undefined;
      },
    );

    placement.enter(23, paper);
    expect(placement.handleClick(10, 10)).toBe(true);
    expect(seen).toEqual([paper]);
    expect(commands).toHaveLength(1);
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

  it('clicks confirm when the site lands; the cancel itself is silent (the input layer fails it)', () => {
    const { placement, cues } = mount(() => ({ col: 4, row: 2 }));
    placement.enter(23);
    placement.handleClick(10, 10);
    expect(cues).toEqual(['confirm']);
    placement.enter(23);
    placement.cancel();
    expect(cues).toEqual(['confirm']);
  });

  it('a rejected tile clicks nothing: the world makes no sound for a site that did not land', () => {
    const { placement, cues } = mount(
      () => ({ col: 4, row: 2 }),
      () => false,
    );
    placement.enter(23);
    placement.handleClick(10, 10);
    expect(cues).toEqual([]);
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

  /** The same layout the controller builds internally (same origin formula + default state). */
  function expectedLayout(ctx: PanelContext) {
    return layoutExtrasMenu({ ...extrasGeometry(ctx), tab: 'assistant' });
  }

  it('opens on toggle, claims the window rect, and closes on the close box', () => {
    const { ctx } = stubContext();
    const extras = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: stubGrantsSeam().seam,
      counters: stubCountersSeam().seam,
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      onUsePaper: () => undefined,
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
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      onUsePaper: () => undefined,
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
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      onUsePaper: () => undefined,
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
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      onUsePaper: () => undefined,
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
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      onUsePaper: () => undefined,
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
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      onUsePaper: () => undefined,
    });
    const geo = expectedLayout(ctx);
    extras.toggle();

    const plansTab = centreOf(geo.tabs[1]?.rect ?? { x: 0, y: 0, w: 0, h: 0 });
    made.length = 0;
    expect(extras.handleClick(plansTab.x, plansTab.y)).toBe(true);
    expect(made).toContain(messages().hud.extras.plansEmpty);
    expect(made).not.toContain(messages().hud.extras.extraWomen);

    const replacement = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: stubGrantsSeam().seam,
      counters: stubCountersSeam().seam,
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      onUsePaper: () => undefined,
    });
    replacement.restore(extras.state());
    made.length = 0;
    replacement.toggle();
    expect(made).toContain(messages().hud.extras.plansEmpty);

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
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      onUsePaper: () => undefined,
    });
    extras.toggle();
    expect(extras.handleClick(SCREEN.width - 1, SCREEN.height - 1)).toBe(false);
    expect(extras.isOpen()).toBe(true);
  });

  /** A counter seam whose reads lag its writes, like the sim block that only moves on a later tick. */
  function laggingCountersSeam(): {
    seam: ExtrasCountersSeam;
    live: Record<AssistantCounterId, AssistantCounterFace>;
  } {
    const live: Record<AssistantCounterId, AssistantCounterFace> = { ...defaultAssistantState().counters };
    return { seam: { read: () => ({ ...live }), set: () => true }, live };
  }

  it('holds the clicked face per frame until the sim block moves, then follows it', () => {
    const { ctx, made } = stubContext();
    const { seam, live } = laggingCountersSeam();
    const extras = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: stubGrantsSeam().seam,
      counters: seam,
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      onUsePaper: () => undefined,
    });
    const geo = expectedLayout(ctx);
    extras.toggle();

    const plus = centreOf(geo.counters[0]?.plusRect ?? { x: 0, y: 0, w: 0, h: 0 });
    made.length = 0;
    extras.handleClick(plus.x, plus.y);
    expect(made).toContain('1'); // the echo, drawn before the command reaches the block

    made.length = 0;
    extras.refresh();
    expect(made).toEqual([]); // the block still reads pre-write: hold the echo, rebuild nothing

    live.extraWomen = { value: 4, infinite: false }; // the queue moved under the open window
    extras.refresh();
    expect(made).toContain('4');

    made.length = 0;
    extras.refresh();
    expect(made).toEqual([]); // nothing moved since: no per-frame glyph rebuild
  });

  /** How many tiled fills the open window laid down: `back`, the first child of its own container. */
  function tiledFills(ctx: PanelContext): number {
    const container = new Container();
    const extras = createExtrasWindow({
      ctx,
      container,
      grants: stubGrantsSeam().seam,
      counters: stubCountersSeam().seam,
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      onUsePaper: () => undefined,
    });
    extras.toggle();
    const shell = container.children[0];
    if (!(shell instanceof Container)) throw new Error('the extras window mounts no container');
    const back = shell.children[0];
    if (!(back instanceof Container)) throw new Error('the extras window owns no fill layer');
    return back.children.length;
  }

  it('tiles its plates from the decoded art, and lays none down without it', () => {
    const bare = stubContext().ctx;
    const decoded: PanelContext = {
      ...bare,
      bitmaps: {
        bg: Texture.EMPTY,
        button: Texture.EMPTY,
        buttonHilite: Texture.EMPTY,
        headline: Texture.EMPTY,
      },
    };

    expect(tiledFills(bare)).toBe(0); // flat Graphics fallback only
    expect(tiledFills(decoded)).toBeGreaterThan(0);
  });

  it('reads nothing per frame while closed', () => {
    const { ctx, made } = stubContext();
    let reads = 0;
    const counting: ExtrasCountersSeam = {
      read: () => {
        reads++;
        return defaultAssistantState().counters;
      },
      set: () => true,
    };
    const extras = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: stubGrantsSeam().seam,
      counters: counting,
      papers: NO_PAPERS,
      paperLabel: (paper) => `${paper.kind}:${paper.param}`,
      onUsePaper: () => undefined,
    });

    extras.refresh();
    expect(reads).toBe(0);
    expect(made).toEqual([]);
  });
});
