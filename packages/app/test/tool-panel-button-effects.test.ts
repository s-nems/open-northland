import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { TextRun } from '../src/hud/text-run.js';
import {
  applyToolButtonEffect,
  type ToolButtonEffect,
  type ToolButtonSurfaces,
  toolButtonEffect,
} from '../src/hud/tool-panel/button-effects.js';
import type { PanelContext } from '../src/hud/tool-panel/context.js';
import { createExtrasWindow } from '../src/hud/tool-panel/extras-window.js';
import { createGoodsDropController } from '../src/hud/tool-panel/goods-drop.js';
import { createGoodsWindow } from '../src/hud/tool-panel/goods-window.js';
import { buildToolPanelLayout, type ToolButtonId } from '../src/hud/tool-panel/layout.js';
import { createMenuWindow } from '../src/hud/tool-panel/menu-window.js';
import { createPlacementController } from '../src/hud/tool-panel/placement.js';
import { createStatsWindow } from '../src/hud/tool-panel/stats-window.js';

const SCREEN = { width: 800, height: 600 };
const BUILDING_JOINERY = 23;
const GOOD_WOOD = 10;

function stubContext(): PanelContext {
  const layout = buildToolPanelLayout(1);
  return {
    layout,
    scale: layout.scale,
    makeText: (): TextRun => ({
      container: new Container(),
      width: 0,
      place: () => undefined,
      destroy: () => undefined,
    }),
    bitmaps: { bg: undefined, button: undefined, buttonHilite: undefined, headline: undefined },
    uiString: (_table, _id, fallback) => fallback,
    screen: () => SCREEN,
  };
}

/** The four windows plus the two held modes the mount wires, over a stubbed context (no Pixi text). */
function mountSurfaces() {
  const ctx = stubContext();
  const container = new Container();
  const menu = createMenuWindow({
    ctx,
    buildings: [{ typeId: BUILDING_JOINERY, label: 'Joinery', kind: 'workplace' }],
    container,
    onPick: () => undefined,
  });
  const goodsWindow = createGoodsWindow({
    ctx,
    goods: [{ goodType: GOOD_WOOD, id: 'wood', label: 'Wood' }],
    container,
    onPick: () => undefined,
  });
  const extras = createExtrasWindow({
    ctx,
    container,
    grants: {
      read: () => ({ giveBoots: true, giveWoodenTools: true, giveIronTools: true, giveMead: true }),
      set: () => true,
    },
  });
  const stats = createStatsWindow({ ctx, container });
  const placement = createPlacementController({
    ctx,
    container,
    labelByType: new Map([[BUILDING_JOINERY, 'Joinery']]),
    enqueue: () => undefined,
    screenToTile: () => ({ col: 1, row: 1 }),
    canPlaceAt: () => true,
    tribe: 1,
    owner: 0,
  });
  const goodsDrop = createGoodsDropController({
    ctx,
    container,
    labelByGood: new Map([[GOOD_WOOD, 'Wood']]),
    enqueue: () => undefined,
    screenToTile: () => ({ col: 1, row: 1 }),
  });
  const pressed: string[] = [];
  const surfaces: ToolButtonSurfaces = {
    windows: { menu, goods: goodsWindow, extras, stats },
    cancelHeld: () => {
      placement.cancel();
      goodsDrop.cancel();
    },
    cycleSpeed: () => pressed.push('speed'),
    openSystemMenu: () => pressed.push('systemMenu'),
  };
  const press = (id: ToolButtonId): void => applyToolButtonEffect(surfaces, id);
  const open = (): Record<string, boolean> => ({
    menu: menu.isOpen(),
    goods: goodsWindow.isOpen(),
    extras: extras.isOpen(),
    stats: stats.isOpen(),
  });
  return { press, open, placement, goodsDrop, pressed };
}

const windowEffect = (id: ToolButtonId): Extract<ToolButtonEffect, { kind: 'window' }> => {
  const effect = toolButtonEffect(id);
  if (effect?.kind !== 'window') throw new Error(`expected ${id} to open a window`);
  return effect;
};

describe('tool panel button effects', () => {
  it('pins which pop-ups each window button drops', () => {
    expect(windowEffect('buildings').closes).toEqual(['goods', 'extras']);
    expect(windowEffect('mission').closes).toEqual(['menu', 'extras']);
    expect(windowEffect('extras').closes).toEqual(['menu', 'goods', 'stats']);
    // Statistics only drops the chest window, whose rect it collides with; the picking windows stay.
    expect(windowEffect('statistics').closes).toEqual(['extras']);
  });

  it('drops a held placement only for the buttons that open a picking window', () => {
    expect(windowEffect('buildings').cancelsHeld).toBe(true);
    expect(windowEffect('mission').cancelsHeld).toBe(true);
    expect(windowEffect('extras').cancelsHeld).toBe(true);
    expect(windowEffect('statistics').cancelsHeld).toBe(false);
  });

  it('stands help in for statistics until it has a window of its own', () => {
    expect(toolButtonEffect('help')).toEqual(toolButtonEffect('statistics'));
  });
});

describe('applying a tool button press', () => {
  it('toggles the pressed window and closes the ones it would cover', () => {
    const { press, open } = mountSurfaces();

    press('mission');
    expect(open()).toEqual({ menu: false, goods: true, extras: false, stats: false });

    press('buildings');
    expect(open()).toEqual({ menu: true, goods: false, extras: false, stats: false });

    press('extras');
    expect(open()).toEqual({ menu: false, goods: false, extras: true, stats: false });

    press('statistics');
    expect(open()).toEqual({ menu: false, goods: false, extras: false, stats: true });

    press('help'); // the stand-in toggles the same window back shut
    expect(open()).toEqual({ menu: false, goods: false, extras: false, stats: false });
  });

  it('leaves the picking windows open when statistics opens over them', () => {
    const { press, open } = mountSurfaces();

    press('buildings');
    press('statistics');
    expect(open()).toEqual({ menu: true, goods: false, extras: false, stats: true });
  });

  it('drops a held building on a picking press but keeps it for statistics', () => {
    const { press, placement } = mountSurfaces();

    placement.enter(BUILDING_JOINERY);
    press('statistics');
    expect(placement.isActive()).toBe(true);

    press('buildings');
    expect(placement.isActive()).toBe(false);
  });

  it('drops a held good drop on a picking press', () => {
    const { press, goodsDrop } = mountSurfaces();

    goodsDrop.enter(GOOD_WOOD);
    press('extras');
    expect(goodsDrop.isActive()).toBe(false);
  });

  it('routes the speed and options buttons past the windows, and leaves the unwired ones inert', () => {
    const { press, open, pressed } = mountSurfaces();

    press('speed');
    press('options');
    press('diplomacy');
    press('population');
    press('tech_tree');

    expect(pressed).toEqual(['speed', 'systemMenu']);
    expect(open()).toEqual({ menu: false, goods: false, extras: false, stats: false });
  });
});
