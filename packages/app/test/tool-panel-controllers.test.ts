import type { HudLayout } from '@vinland/render';
import type { Command } from '@vinland/sim';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { TextRun } from '../src/hud/bitmap-text.js';
import { WIN_PAD } from '../src/hud/chrome.js';
import { type MenuBuildingEntry, layoutBuildingMenu } from '../src/hud/tool-panel/building-menu.js';
import type { PanelContext } from '../src/hud/tool-panel/context.js';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';
import { createMenuWindow } from '../src/hud/tool-panel/menu-window.js';
import { createPlacementController } from '../src/hud/tool-panel/placement.js';
import { createStatsWindow } from '../src/hud/tool-panel/stats-window.js';

/**
 * Headless tests for the tool-panel WINDOW CONTROLLERS (menu / stats / placement) over a stubbed
 * {@link PanelContext} — the seams the package split opened up. These pin the input-routing contracts
 * the mount relies on (claim regions, close-on-pick, close-on-inside) and the stats change-key guard
 * (a tick-only change must NOT rebuild the glyph runs — the per-frame perf contract).
 */

const SCREEN = { width: 800, height: 600 };

/** A PanelContext whose text factory records what it was asked to build (no Pixi text, no fonts). */
function stubContext(): { ctx: PanelContext; made: string[] } {
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
  };
  return { ctx, made };
}

const BUILDINGS: readonly MenuBuildingEntry[] = [
  { typeId: 1, id: 'headquarters', label: 'Headquarters', kind: 'storage' },
  { typeId: 23, id: 'work_joinery_00', label: 'Joinery', kind: 'workplace' },
];

/** The centre of a rect (for synthetic clicks). */
function centreOf(r: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

describe('menu window controller', () => {
  /** The same layout the controller computes internally (same origin formula + inputs): to the right of
   *  the strip, dropping from the buildings button so it clears the top-left debug overlay. */
  function expectedLayout(ctx: PanelContext) {
    const buildingsY = ctx.layout.buttons.find((b) => b.id === 'buildings')?.placed.y ?? ctx.layout.strip.y;
    return layoutBuildingMenu(BUILDINGS, {
      originX: ctx.layout.width + WIN_PAD * ctx.scale,
      originY: buildingsY,
      scale: ctx.scale,
      selected: 'all',
    });
  }

  it('opens on toggle, claims the window rect, and closes on the close box', () => {
    const { ctx } = stubContext();
    const menu = createMenuWindow({
      ctx,
      buildings: BUILDINGS,
      container: new Container(),
      onPick: () => undefined,
    });
    const geo = expectedLayout(ctx);

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
    const menu = createMenuWindow({
      ctx,
      buildings: BUILDINGS,
      container: new Container(),
      onPick: (typeId) => picks.push({ typeId, menuOpenAtPick: menu.isOpen() }),
    });
    menu.toggle();
    const row = centreOf(expectedLayout(ctx).rows[1]?.rect ?? { x: 0, y: 0, w: 0, h: 0 });

    expect(menu.handleClick(row.x, row.y)).toBe(true);
    expect(picks).toEqual([{ typeId: 23, menuOpenAtPick: false }]);
  });

  it('does not consume clicks outside the open window', () => {
    const { ctx } = stubContext();
    const menu = createMenuWindow({
      ctx,
      buildings: BUILDINGS,
      container: new Container(),
      onPick: () => undefined,
    });
    menu.toggle();
    expect(menu.handleClick(SCREEN.width - 1, SCREEN.height - 1)).toBe(false);
    expect(menu.isOpen()).toBe(true);
  });
});

describe('stats window controller', () => {
  const hud = (tick: number, wood: number): HudLayout => ({
    width: 100,
    height: 40,
    rows: [
      { x: 0, y: 0, text: `Tribe 1 · tick ${tick}` },
      { x: 0, y: 12, text: `wood: ${wood}` },
    ],
  });

  it('rebuilds only when a tally row changes, never on the tick row alone', () => {
    const { ctx, made } = stubContext();
    const stats = createStatsWindow({ ctx, container: new Container() });

    stats.refresh(hud(1, 5));
    expect(made).toHaveLength(0); // closed → no build

    stats.toggle();
    stats.refresh(hud(1, 5));
    const builtOnce = made.length;
    expect(builtOnce).toBeGreaterThan(0); // first open refresh builds title + rows

    stats.refresh(hud(2, 5)); // only the tick advanced
    expect(made).toHaveLength(builtOnce); // ← the per-frame guard: no glyph rebuild

    stats.refresh(hud(3, 6)); // a tally changed
    expect(made.length).toBeGreaterThan(builtOnce);
  });

  it('claims only the drawn rect while open, and a click inside closes it', () => {
    const { ctx } = stubContext();
    const stats = createStatsWindow({ ctx, container: new Container() });
    stats.toggle();
    stats.refresh(hud(1, 5));

    // The drawn rect's origin mirrors the controller's own formula; probe just inside it.
    const x = ctx.layout.width + (WIN_PAD + 150 + 3 * WIN_PAD) * ctx.scale + 1;
    const y = ctx.layout.strip.y + 15 * ctx.scale + 1;
    expect(stats.claims(x, y)).toBe(true);
    expect(stats.handleClick(x, y)).toBe(true);
    expect(stats.isOpen()).toBe(false);
    expect(stats.claims(x, y)).toBe(false);
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

  it('places at an accepted tile and EXITS build mode (one click = one building)', () => {
    const { placement, commands } = mount(() => ({ col: 4, row: 2 }));
    expect(placement.handleClick(10, 10)).toBe(false); // not active yet → not consumed

    placement.enter(23);
    expect(placement.isActive()).toBe(true);
    expect(placement.handleClick(10, 10)).toBe(true);
    expect(commands).toEqual([{ kind: 'placeBuilding', buildingType: 23, x: 4, y: 2, tribe: 1, owner: 0 }]);
    expect(placement.isActive()).toBe(false); // landed → build mode over (the original's flow)
  });

  it('a click on ground the placement rule rejects is consumed but inert (mode survives)', () => {
    const { placement, commands } = mount(
      () => ({ col: 4, row: 2 }),
      () => false, // the probe says the anchor doesn't fit here
    );
    placement.enter(23);
    expect(placement.handleClick(10, 10)).toBe(true); // claimed — never falls through to picking
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
