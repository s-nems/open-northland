import type { UiCue } from '@open-northland/audio';
import type { HudLayout } from '@open-northland/render';
import type { Command, Entity, Paper } from '@open-northland/sim';
import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/hud/geometry.js';
import type { TextRun } from '../src/hud/text-run.js';
import {
  type BuildingAvailability,
  type MenuBuildingEntry,
  OPEN_AVAILABILITY,
} from '../src/hud/tool-panel/building-menu.js';
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
import { createHeldPaperController } from '../src/hud/tool-panel/held-paper.js';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';
import { createPlacementController, PALISADE_LINE_MAX_EDGES } from '../src/hud/tool-panel/placement.js';
import { INITIAL_RESIDENTS_STATE, NO_RESIDENT_FILTERS } from '../src/hud/tool-panel/residents/rows.js';
import { createStatsWindow } from '../src/hud/tool-panel/stats-window.js';
import { createToolWindows } from '../src/hud/tool-panel/windows.js';
import { messages } from '../src/i18n/index.js';
import { type ConstructionWindowStub, stubConstructionWindow } from './support/construction-window-stub.js';
import { stubPendingWindow } from './support/pending-window-stub.js';
import { stubPlacementStrip } from './support/placement-strip-stub.js';
import { stubResidentsWindow } from './support/residents-window-stub.js';

/**
 * Headless tests for the tool-panel WINDOW CONTROLLERS (registry / stats / placement / chest) over a
 * stubbed {@link PanelContext} and a DOM-less construction window. These pin the input-routing
 * contracts the mount relies on (claim regions, close-on-inside, the paper flow) and the stats
 * change-key guard (a tick-only change remakes only the tick run - the per-frame perf contract).
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
  { typeId: 7, label: 'Stock', kind: 'storage', cost: [] },
  { typeId: 23, label: 'Joinery', kind: 'workplace', cost: [] },
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
  const measured = layoutExtrasMenu({ originX: 0, originY: 0, scale: ctx.scale, state });
  const origin = windowOrigin(ctx, measured.window.w);
  return { originX: origin.x, originY: origin.y, scale: ctx.scale, state };
}

/** The centre of a rect (for synthetic clicks). */
function centreOf(r: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
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

/** A read-view with enough tallies that the content-sized stats window reaches down into the chest
 *  window (both centre in the region, so they overlap). */
const TALL_HUD: HudLayout = {
  width: 100,
  height: 80,
  rows: ['Tribe 1 · tick 1', 'wood: 5', 'stone: 2', 'grain: 9'].map((text, i) => ({
    x: 0,
    y: i * 12,
    text,
  })),
};

describe('stats window controller', () => {
  it('rebuilds only when a tally row changes, and remakes the tick run alone on a tick', () => {
    const { ctx, made } = stubContext();
    const stats = createStatsWindow({ ctx, container: new Container() });

    stats.refresh(() => hud(1, 5));
    expect(made).toHaveLength(0); // closed → no build

    stats.toggle();
    stats.refresh(() => hud(1, 5));
    const builtOnce = made.length;
    expect(builtOnce).toBeGreaterThan(0); // first open refresh builds title + rows

    stats.refresh(() => hud(1, 5)); // the same frame again: nothing to make
    expect(made).toHaveLength(builtOnce);

    stats.refresh(() => hud(2, 5)); // only the tick advanced: its run alone, not the tallies
    expect(made).toHaveLength(builtOnce + 1);
    expect(made.at(-1)).toBe('Tribe 1 · tick 2');
    const reticked = made.length;

    stats.refresh(() => hud(3, 6)); // a tally changed
    expect(made.length).toBeGreaterThan(reticked + 1);
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

  function mountWindows(buildings: readonly MenuBuildingEntry[] = BUILDINGS) {
    const { ctx } = stubContext();
    const picks: [number, Paper | undefined][] = [];
    const container = new Container();
    let menu: ConstructionWindowStub | null = null;
    const heldPaper = createHeldPaperController(ctx, stubPlacementStrip());
    const windows = createToolWindows({
      ctx,
      container,
      buildings,
      pendingWindow: stubPendingWindow,
      residentsWindow: stubResidentsWindow,
      constructionWindow: (seam) => {
        menu = stubConstructionWindow(seam);
        return menu;
      },
      grants: GRANTS,
      counters: stubCountersSeam().seam,
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
    if (menu === null) throw new Error('the registry did not mount the construction window');
    return { ctx, windows, picks, container, heldPaper, menu: menu as ConstructionWindowStub };
  }

  it('a house plan goes straight to placement; a place-any plan is held for the next catalogue pick, which spends it once', () => {
    let firstBuildingLocked = true;
    const buildings = BUILDINGS.map((building, index) =>
      index === 0
        ? {
            ...building,
            availability: (): BuildingAvailability =>
              firstBuildingLocked ? { kind: 'locked' } : OPEN_AVAILABILITY,
          }
        : building,
    );
    const housePlan: Paper = { kind: 'placeHouse', param: 23 };
    const anyPlan: Paper = { kind: 'placeAny', param: 0 };
    const { windows, picks, heldPaper, menu } = mountWindows(buildings);

    // The house plan: placement at once with the plan riding it; nothing is held.
    menu.toggle();
    menu.seam.onPickPaper(housePlan);
    expect(picks).toEqual([[23, housePlan]]);
    expect(heldPaper.isActive()).toBe(false);

    // The place-any plan: held (the strip up, a held mode) for the window's next pick, which carries
    // it once. The plan pays for the house and lifts no technology lock: the catalogue reads as it is.
    menu.seam.onPickPaper(anyPlan);
    expect(heldPaper.isActive()).toBe(true);
    expect(menu.seam.entries[0]?.availability?.()).toEqual({ kind: 'locked' });
    menu.seam.onPick(BUILDINGS[1]?.typeId ?? 0);
    expect(picks[1]).toEqual([BUILDINGS[1]?.typeId, anyPlan]);
    expect(heldPaper.isActive()).toBe(false);

    // Closing the window without a pick drops the held plan: the next pick is an ordinary site.
    firstBuildingLocked = false;
    menu.seam.onPickPaper(anyPlan);
    menu.toggle();
    windows.refresh(() => hud(1, 0));
    expect(heldPaper.isActive()).toBe(false);
    menu.toggle();
    menu.seam.onPick(BUILDINGS[0]?.typeId ?? 0);
    expect(picks[2]).toEqual([BUILDINGS[0]?.typeId, undefined]);

    // A cancel (Esc, a right click) or a world click drops it too, and the window stays open.
    menu.seam.onPickPaper(anyPlan);
    expect(heldPaper.handleClick(0, 0)).toBe(true); // a world press: consumed, the plan dropped
    expect(heldPaper.isActive()).toBe(false);
    expect(menu.isOpen()).toBe(true);
    expect(heldPaper.handleClick(0, 0)).toBe(false); // nothing held: the press is the world's
    heldPaper.hold(anyPlan);
    heldPaper.cancel();
    expect(windows.state().heldPaper).toBeNull();
    windows.restore({ ...windows.state(), heldPaper: anyPlan });
    expect(heldPaper.held()).toEqual(anyPlan);
  });

  it("closes every open window at once, keeping a placement's pending return to the catalogue", () => {
    const { windows, menu } = mountWindows();
    windows.byId.stats.toggle();
    windows.closeAll();
    expect(windows.openId()).toBeNull();

    menu.toggle();
    menu.suspend();
    windows.closeAll();
    menu.resume();
    expect(menu.isOpen()).toBe(true);
  });

  it("a card's help opens the knowledge note in place of the catalogue", () => {
    const { windows, menu } = mountWindows();
    menu.toggle();
    menu.seam.onHelp(23);
    expect(menu.isOpen()).toBe(false);
    expect(windows.openId()).toBe('knowledge');
  });

  it("hands the tick's stocks to the construction window and carries its state through a remount", () => {
    const { windows, menu } = mountWindows();
    const model = { tick: 1, player: 0, population: 0, jobs: [], stocks: [] };
    windows.presentStocks(model);
    expect(menu.models).toEqual([model]);

    menu.toggle();
    menu.restore({
      page: 'papers',
      category: 'home',
      view: 'list',
      scrollTop: 40,
      picked: 23,
      suspended: false,
    });
    const saved = windows.state();
    expect(saved.openIds).toEqual(['menu']);
    expect(saved.buildings).toEqual({
      page: 'papers',
      category: 'home',
      view: 'list',
      scrollTop: 40,
      picked: 23,
      suspended: false,
    });

    const again = mountWindows();
    again.windows.restore(saved);
    expect(again.menu.isOpen()).toBe(true);
    expect(again.menu.state()).toEqual(saved.buildings);
  });

  it('keeps an open residents filter through a HUD remount', () => {
    const { windows } = mountWindows();
    windows.byId.residents.toggle();
    windows.restore({
      ...windows.state(),
      residents: {
        ...INITIAL_RESIDENTS_STATE,
        filters: { ...NO_RESIDENT_FILTERS, query: 'Astrid' },
        scrollTop: 24,
      },
    });
    const saved = windows.state();
    const again = mountWindows();
    again.windows.restore(saved);
    expect(again.windows.byId.residents.isOpen()).toBe(true);
    expect(again.windows.state().residents).toEqual(saved.residents);
  });

  it('claims a point only while a pop-up is open under it', () => {
    const { ctx, windows } = mountWindows();
    const inside = { x: statsOrigin(ctx).x + 1, y: statsOrigin(ctx).y + 1 };

    expect(windows.claims(inside.x, inside.y)).toBe(false); // all closed → the world keeps the point
    windows.byId.stats.toggle();
    windows.refresh(() => hud(1, 5));
    expect(windows.claims(inside.x, inside.y)).toBe(true);
    expect(windows.claims(SCREEN.width - 1, SCREEN.height - 1)).toBe(false);
    // The construction window lives on the DOM plane, which routes its own presses.
    windows.byId.menu.toggle();
    expect(windows.claims(SCREEN.width - 1, SCREEN.height - 1)).toBe(false);
  });

  it('probes the pop-ups in draw order, so an overlap goes to the top-drawn window', () => {
    const { ctx, windows } = mountWindows();
    windows.byId.extras.toggle();
    windows.byId.stats.toggle();
    windows.refresh(() => TALL_HUD); // the stats window draws (and gains its rect) on its first refresh

    // Statistics draws after (over) the chest window and both centre in the same region: a point
    // inside the statistics panel is inside the chest window too.
    const shared = { x: statsOrigin(ctx).x + 1, y: statsOrigin(ctx).y + 1 };
    expect(windows.byId.extras.claims(shared.x, shared.y)).toBe(true);
    expect(windows.byId.stats.claims(shared.x, shared.y)).toBe(true);

    expect(windows.handleClick(shared.x, shared.y)).toBe(true);
    expect(windows.byId.stats.isOpen()).toBe(false); // statistics took the press and closed on inside
    expect(windows.byId.extras.isOpen()).toBe(true); // the covered chest window saw nothing
    // Nothing open under the point: the press falls through to placement / world picking.
    expect(windows.handleClick(SCREEN.width - 1, SCREEN.height - 1)).toBe(false);
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
    canPlacePalisadeAt: (gfxIndex: number, col: number, row: number) => boolean = () => true,
    palisadeGateProbe?: Parameters<typeof createPlacementController>[0]['palisadeGateProbe'],
    extra: Partial<Parameters<typeof createPlacementController>[0]> = {},
  ) {
    const { ctx, cues } = stubContext();
    const commands: Command[] = [];
    const strip = stubPlacementStrip();
    const cancels: (Paper | null)[] = [];
    const placement = createPlacementController({
      ctx,
      strip,
      labelByType: new Map([[23, 'Joinery']]),
      enqueue: (c) => commands.push(c),
      screenToTile,
      canPlaceAt,
      canPlacePalisadeAt,
      ...(palisadeGateProbe !== undefined ? { palisadeGateProbe } : {}),
      tribe: 1,
      owner: 0,
      onCancel: (paper) => cancels.push(paper),
      ...extra,
    });
    return { placement, commands, cues, strip, cancels };
  }

  it('names the held building on the strip, clears it with the mode, and reports only a cancel, with its unspent plan', () => {
    const { placement, strip, cancels } = mount(() => ({ col: 4, row: 2 }));
    placement.enter(23);
    expect(strip.shown).toEqual({ label: 'Joinery', hint: messages().hud.construction.placeHint });
    placement.handleClick(10, 10);
    expect(strip.shown).toBeNull();
    expect(cancels).toEqual([]); // a landing is not a cancel: the window stays away

    const plan: Paper = { kind: 'placeHouse', param: 23 };
    placement.enter(23, plan);
    expect(strip.shown?.hint).toBe(messages().hud.construction.placePaperHint);
    placement.cancel();
    expect(strip.shown).toBeNull();
    expect(cancels).toEqual([plan]); // the owner takes the plan back: nothing was spent
    placement.cancel(); // nothing held: nothing to report
    expect(cancels).toEqual([plan]);
    placement.enter(23);
    placement.cancel();
    expect(cancels).toEqual([plan, null]);
  });

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

  it('starts a wall line on the first click, lays the capped line on the second and stays armed', () => {
    let tile = { col: 4, row: 2 };
    const { placement, commands, cues, strip } = mount(() => tile);

    placement.enterPalisade(691, 'wall');
    expect(strip.shown).toEqual({
      label: messages().hud.palisade,
      hint: messages().hud.construction.placeWallHint,
    });
    expect(placement.handleClick(10, 10)).toBe(true);
    expect(commands).toEqual([]);
    expect(placement.activeLine()?.anchor).toEqual({ col: 4, row: 2 });
    expect(strip.shown?.hint).toBe(messages().hud.construction.placeWallLineHint);
    tile = { col: 40, row: 2 };
    expect(placement.palisadePreview(tile)).toHaveLength(PALISADE_LINE_MAX_EDGES + 1);
    expect(placement.handleClick(20, 10)).toBe(true);

    expect(commands).toHaveLength(PALISADE_LINE_MAX_EDGES + 1);
    expect(commands[0]).toMatchObject({ kind: 'placePalisade', x: 4, y: 2 });
    expect(commands[20]).toMatchObject({ kind: 'placePalisade', x: 24, y: 2 });
    expect(cues).toEqual(['confirm']);
    expect(placement.isActive()).toBe(true);
    expect(placement.activeLine()).toBeNull();
    placement.cancel();
    expect(placement.activePalisade()).toBeNull();
  });

  it('stops a wall line at the first rejected site instead of placing across a gap', () => {
    let tile = { col: 4, row: 2 };
    const { placement, commands } = mount(
      () => tile,
      () => true,
      (_gfxIndex, col) => col < 7,
    );
    placement.enterPalisade(691, 'wall');
    placement.handleClick(0, 0);
    tile = { col: 10, row: 2 };
    placement.handleClick(10, 0);
    expect(commands.map((command) => ('x' in command ? command.x : null))).toEqual([4, 5, 6]);
  });

  it('starts a wall line on a standing wall and lays only the new segments past it', () => {
    let tile = { col: 4, row: 2 };
    const { placement, commands } = mount(
      () => tile,
      () => true,
      // The standing wall's own node refuses a new segment, so only the built test lets the line start.
      (_gfxIndex, col) => col > 4,
      undefined,
      { palisadeBuiltAt: (col, row) => col === 4 && row === 2 },
    );
    placement.enterPalisade(691, 'wall');
    placement.handleClick(0, 0);
    expect(placement.activeLine()?.anchor).toEqual({ col: 4, row: 2 });
    tile = { col: 7, row: 2 };
    expect(placement.palisadePreview(tile)?.map((node) => node.state)).toEqual([
      'built',
      'open',
      'open',
      'open',
    ]);
    placement.handleClick(10, 0);
    expect(commands.map((command) => ('x' in command ? command.x : null))).toEqual([5, 6, 7]);
  });

  it('lays an admin standing-wall line finished for the chosen owner through the trusted channel', () => {
    let tile = { col: 4, row: 2 };
    const trusted: Command[] = [];
    const { placement, commands, strip } = mount(() => tile, undefined, undefined, undefined, {
      enqueueTrusted: (command) => trusted.push(command),
    });
    placement.enterPalisade(691, 'standingWall', { owner: 3, tribe: 2 });
    expect(strip.shown?.label).toBe(messages().admin.standingPalisade);
    placement.handleClick(0, 0);
    tile = { col: 6, row: 2 };
    placement.handleClick(10, 0);
    expect(commands).toEqual([]);
    expect(trusted).toEqual(
      [4, 5, 6].map((x) => ({
        kind: 'placePalisade',
        gfxIndex: 691,
        x,
        y: 2,
        owner: 3,
        tribe: 2,
        underConstruction: false,
      })),
    );
  });

  it('steps back from a started line to the armed tool, then leaves it for the map, not the window', () => {
    const { placement, commands, cancels } = mount(() => ({ col: 4, row: 2 }));
    placement.enterPalisade(691, 'wall');
    expect(placement.stepBack()).toBe(false);
    placement.handleClick(0, 0);
    expect(placement.stepBack()).toBe(true);
    expect(placement.activeLine()).toBeNull();
    expect(placement.isActive()).toBe(true);
    placement.cancel();
    expect(placement.isActive()).toBe(false);
    expect(cancels).toEqual([]);
    expect(commands).toEqual([]);

    placement.enterPalisade(696, 'gate');
    placement.cancel();
    expect(placement.isActive()).toBe(false);
    expect(cancels).toEqual([]);
  });

  it('converts a valid hovered five-wall span with the probe-selected gate orientation', () => {
    const center = 17 as Entity;
    const { placement, commands } = mount(
      () => ({ col: 8, row: 6 }),
      () => true,
      () => true,
      () => ({
        canConvert: true,
        center,
        gfxIndex: 698,
        span: [4, 5, 6, 7, 8].map((col) => ({ hx: col, hy: 6 })),
      }),
    );
    placement.enterPalisade(696, 'gate');
    expect(placement.palisadePreview({ col: 8, row: 6 })).toEqual(
      [4, 5, 6, 7, 8].map((col) => ({ col, row: 6, state: 'open' })),
    );
    placement.handleClick(0, 0);
    expect(commands).toEqual([{ kind: 'convertPalisadeGate', palisade: center, gfxIndex: 698 }]);
    // One gate per pick: the tool leaves like a placed building.
    expect(placement.isActive()).toBe(false);
  });

  it('aims a gate at the centre of the lit span a hovered wall belongs to', () => {
    const center = 17 as Entity;
    const probed: { col: number; row: number }[] = [];
    const sites = {
      key: 'gate',
      has: (col: number, row: number) => row === 6 && col >= 4 && col <= 8,
      centerFor: (col: number, row: number) => (sites.has(col, row) ? { col: 6, row: 6 } : null),
      highlight: [],
    };
    const { placement, commands } = mount(
      () => ({ col: 8, row: 6 }),
      () => true,
      () => true,
      (_gfxIndex, col, row) => {
        probed.push({ col, row });
        return {
          canConvert: col === 6,
          center,
          gfxIndex: 698,
          span: [-2, -1, 0, 1, 2].map((offset) => ({ hx: col + offset, hy: row })),
        };
      },
      { palisadeGateSites: () => sites },
    );
    placement.enterPalisade(696, 'gate');
    expect(placement.gateSites()).toBe(sites);
    expect(placement.activeLine()).toBeNull();
    placement.handleClick(0, 0);
    expect(probed).toEqual([{ col: 6, row: 6 }]);
    expect(commands).toEqual([{ kind: 'convertPalisadeGate', palisade: center, gfxIndex: 698 }]);
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
    return layoutExtrasMenu(extrasGeometry(ctx));
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

  it('holds a flipped switch until the sim applies it, and follows a grant that moved under the open window', () => {
    const { ctx, made } = stubContext();
    const live: Record<AssistantGrantId, boolean> = {
      giveBoots: true,
      giveWoodenTools: true,
      giveIronTools: true,
      giveMead: true,
    };
    // The command applies on a later tick, as a queued `setAssistantGrant` does.
    const lagging: ExtrasGrantsSeam = { read: () => ({ ...live }), set: () => true };
    const extras = createExtrasWindow({
      ctx,
      container: new Container(),
      grants: lagging,
      counters: stubCountersSeam().seam,
    });
    const geo = expectedLayout(ctx);
    extras.toggle();
    const mead = geo.grants.find((g) => g.id === 'giveMead')?.switchRect;
    expect(mead).toBeDefined();
    if (mead === undefined) return;

    made.length = 0;
    extras.handleClick(centreOf(mead).x, centreOf(mead).y);
    expect(made).toContain(messages().hud.extras.off); // the echo
    made.length = 0;
    extras.refresh();
    expect(made).toEqual([]); // the sim still reads pre-write: the echo holds

    live.giveMead = false; // applied
    extras.refresh();
    live.giveBoots = false; // a write an earlier mount of the window echoed, applied only now
    made.length = 0;
    extras.refresh();
    expect(made.filter((text) => text === messages().hud.extras.off)).toHaveLength(2);
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
    });

    extras.refresh();
    expect(reads).toBe(0);
    expect(made).toEqual([]);
  });
});
