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
import { defaultAssistantState } from '../src/hud/tool-panel/extras-menu.js';
import { createGoodsDropController } from '../src/hud/tool-panel/goods-drop.js';
import { createHeldPaperController } from '../src/hud/tool-panel/held-paper.js';
import { buildToolPanelLayout, type ToolButtonId } from '../src/hud/tool-panel/layout.js';
import { createPlacementController } from '../src/hud/tool-panel/placement.js';
import { createToolWindows, type ToolWindowId } from '../src/hud/tool-panel/windows.js';

const SCREEN = { width: 800, height: 600 };
const BUILDING_JOINERY = 23;
const GOOD_WOOD = 10;

function stubContext(): PanelContext {
  const layout = buildToolPanelLayout(1);
  const ctx: PanelContext = {
    layout,
    scale: layout.scale,
    makeText: (): TextRun => ({
      container: new Container(),
      width: 0,
      place: () => undefined,
      destroy: () => undefined,
    }),
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
    atScale: (scale) => ({ ...ctx, scale }),
  };
  return ctx;
}

/** The pop-up window layer plus the two held modes the mount wires, over a stubbed context (no Pixi text). */
function mountSurfaces() {
  const ctx = stubContext();
  const container = new Container();
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
  const windows = createToolWindows({
    ctx,
    container,
    buildings: [{ typeId: BUILDING_JOINERY, label: 'Joinery', kind: 'workplace' }],
    goods: [{ goodType: GOOD_WOOD, id: 'wood', label: 'Wood' }],
    grants: {
      read: () => ({ giveBoots: true, giveWoodenTools: true, giveIronTools: true, giveMead: true }),
      set: () => true,
    },
    counters: {
      read: () => defaultAssistantState().counters,
      set: () => true,
    },
    papers: { read: () => [] },
    paperLabel: (paper) => `${paper.kind}:${paper.param}`,
    heldPaper: createHeldPaperController(ctx, container),
    diplomacyRows: () => [],
    art: null,
    missionBrief: () => null,
    missionReplayPage: () => null,
    history: null,
    onPickBuilding: (typeId) => placement.enter(typeId),
    onPickGood: (goodType) => goodsDrop.enter(goodType),
    onPayTribute: () => undefined,
  });
  const pressed: string[] = [];
  const surfaces: ToolButtonSurfaces = {
    windows: windows.byId,
    cancelHeld: () => {
      placement.cancel();
      goodsDrop.cancel();
    },
    cycleSpeed: () => pressed.push('speed'),
    openSystemMenu: () => pressed.push('systemMenu'),
    cycleMessagePriority: () => pressed.push('messagePriority'),
  };
  const press = (id: ToolButtonId): void => applyToolButtonEffect(surfaces, id);
  const open = (): Record<ToolWindowId, boolean> => ({
    menu: windows.byId.menu.isOpen(),
    goods: windows.byId.goods.isOpen(),
    extras: windows.byId.extras.isOpen(),
    stats: windows.byId.stats.isOpen(),
    diplomacy: windows.byId.diplomacy.isOpen(),
    mission: windows.byId.mission.isOpen(),
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
    expect(windowEffect('buildings').closes).toEqual(['goods', 'extras', 'mission']);
    expect(windowEffect('help').closes).toEqual(['menu', 'extras', 'mission']);
    expect(windowEffect('extras').closes).toEqual(['menu', 'goods', 'stats', 'diplomacy', 'mission']);
    // The informational windows only drop the chest window, whose rect they collide with, and the
    // mission sheet, which holds the pause; the picking windows stay.
    expect(windowEffect('statistics').closes).toEqual(['extras', 'mission']);
    expect(windowEffect('diplomacy').closes).toEqual(['extras', 'mission']);
    // The sheet covers the middle of the screen, so everything goes.
    expect(windowEffect('mission').closes).toEqual(['menu', 'goods', 'extras', 'stats', 'diplomacy']);
  });

  it('drops a held placement only for the buttons that open a picking window', () => {
    expect(windowEffect('buildings').cancelsHeld).toBe(true);
    expect(windowEffect('mission').cancelsHeld).toBe(true);
    expect(windowEffect('help').cancelsHeld).toBe(true);
    expect(windowEffect('extras').cancelsHeld).toBe(true);
    expect(windowEffect('statistics').cancelsHeld).toBe(false);
    expect(windowEffect('diplomacy').cancelsHeld).toBe(false);
  });

  it('lends the help button to the goods drop palette until it has a window of its own', () => {
    expect(windowEffect('help').toggles).toBe('goods');
    expect(windowEffect('mission').toggles).toBe('mission');
  });
});

describe('applying a tool button press', () => {
  it('toggles the pressed window and closes the ones it would cover', () => {
    const { press, open } = mountSurfaces();
    const closed = {
      menu: false,
      goods: false,
      extras: false,
      stats: false,
      diplomacy: false,
      mission: false,
    };

    press('mission');
    expect(open()).toEqual({ ...closed, mission: true });

    press('buildings');
    expect(open()).toEqual({ ...closed, menu: true });

    press('extras');
    expect(open()).toEqual({ ...closed, extras: true });

    press('statistics');
    expect(open()).toEqual({ ...closed, stats: true });

    press('help');
    expect(open()).toEqual({ ...closed, goods: true, stats: true });

    press('help'); // a second press toggles its own window back shut
    expect(open()).toEqual({ ...closed, stats: true });
  });

  it('leaves the picking windows open when statistics opens over them', () => {
    const { press, open } = mountSurfaces();

    press('buildings');
    press('statistics');
    expect(open()).toEqual({
      menu: true,
      goods: false,
      extras: false,
      stats: true,
      diplomacy: false,
      mission: false,
    });
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

  it('opens the diplomacy window over the pickers and closes it with the chest', () => {
    const { press, open } = mountSurfaces();

    press('buildings');
    press('diplomacy');
    expect(open()).toEqual({
      menu: true,
      goods: false,
      extras: false,
      stats: false,
      diplomacy: true,
      mission: false,
    });

    press('extras'); // the chest drops every other pop-up, diplomacy included
    expect(open()).toEqual({
      menu: false,
      goods: false,
      extras: true,
      stats: false,
      diplomacy: false,
      mission: false,
    });
  });

  it('routes the speed and options buttons past the windows, and leaves the unwired ones inert', () => {
    const { press, open, pressed } = mountSurfaces();

    press('speed');
    press('options');
    press('population');
    press('tech_tree');

    expect(pressed).toEqual(['speed', 'systemMenu']);
    expect(open()).toEqual({
      menu: false,
      goods: false,
      extras: false,
      stats: false,
      diplomacy: false,
      mission: false,
    });
  });
});
