import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { TextRun } from '../src/hud/text-run.js';
import type { PanelContext } from '../src/hud/tool-panel/context.js';
import { defaultAssistantState } from '../src/hud/tool-panel/extras-menu.js';
import { createHeldPaperController } from '../src/hud/tool-panel/held-paper.js';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';
import {
  applyNavEntry,
  NAV_ENTRY_IDS,
  type NavEntryId,
  navEntryEffect,
  navEntryForWindow,
} from '../src/hud/tool-panel/nav-effects.js';
import { createPlacementController } from '../src/hud/tool-panel/placement.js';
import { createToolWindows, type ToolWindowId, type ToolWindows } from '../src/hud/tool-panel/windows.js';
import { type ConstructionWindowStub, stubConstructionWindow } from './support/construction-window-stub.js';
import { stubPendingWindow } from './support/pending-window-stub.js';
import { stubPlacementStrip } from './support/placement-strip-stub.js';

const SCREEN = { width: 1280, height: 720 };
const BUILDING_JOINERY = 23;

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
    cue: () => undefined,
    atScale: (scale) => ({ ...ctx, scale }),
  };
  return ctx;
}

/** The window registry plus the held placement the mount wires, over a stubbed context (no Pixi text). */
function mountSurfaces() {
  const ctx = stubContext();
  const container = new Container();
  const strip = stubPlacementStrip();
  let windows: ToolWindows | null = null;
  const placement = createPlacementController({
    ctx,
    strip,
    labelByType: new Map([[BUILDING_JOINERY, 'Joinery']]),
    enqueue: () => undefined,
    screenToTile: () => ({ col: 1, row: 1 }),
    canPlaceAt: () => true,
    tribe: 1,
    owner: 0,
    // As the mount wires it: a cancelled placement brings the construction window back.
    onCancel: () => windows?.byId.menu.resume(),
  });
  let menu: ConstructionWindowStub | null = null;
  windows = createToolWindows({
    ctx,
    container,
    pendingWindow: stubPendingWindow,
    constructionWindow: (seam) => {
      menu = stubConstructionWindow(seam);
      return menu;
    },
    buildings: [{ typeId: BUILDING_JOINERY, label: 'Joinery', kind: 'workplace', cost: [] }],
    grants: {
      read: () => ({ giveBoots: true, giveWoodenTools: true, giveIronTools: true, giveMead: true }),
      set: () => true,
    },
    counters: {
      read: () => defaultAssistantState().counters,
      set: () => true,
    },
    heldPaper: createHeldPaperController(ctx, strip),
    diplomacyRows: () => [],
    art: null,
    missionBrief: () => null,
    missionBriefingHistory: () => [],
    missionReplayPage: () => null,
    history: null,
    onPickBuilding: (typeId) => {
      windows?.byId.menu.suspend();
      placement.enter(typeId);
    },
    onPayTribute: () => undefined,
    onDeclareDiplomacy: () => undefined,
  });
  if (menu === null) throw new Error('the registry did not mount the construction window');
  const surfaces = { windows: windows.byId, cancelHeld: () => placement.cancel() };
  const press = (id: NavEntryId): void => applyNavEntry(surfaces, id);
  return { press, windows, placement, pick: (menu as ConstructionWindowStub).seam.onPick };
}

describe('navigation entries', () => {
  it('lists the seven direct entries in beam order, each owning one central window', () => {
    expect(NAV_ENTRY_IDS).toEqual([
      'build',
      'residents',
      'assistant',
      'statistics',
      'mission',
      'diplomacy',
      'knowledge',
    ]);
    const windows = NAV_ENTRY_IDS.map((id) => navEntryEffect(id).window);
    expect(windows).toEqual(['menu', 'residents', 'extras', 'stats', 'mission', 'diplomacy', 'knowledge']);
    for (const id of NAV_ENTRY_IDS) expect(navEntryForWindow(navEntryEffect(id).window)).toBe(id);
  });

  it('drops a held placement only for the entries that start a pick or pause the game', () => {
    expect(navEntryEffect('build').cancelsHeld).toBe(true);
    expect(navEntryEffect('assistant').cancelsHeld).toBe(true);
    expect(navEntryEffect('mission').cancelsHeld).toBe(true);
    expect(navEntryEffect('statistics').cancelsHeld).toBe(false);
    expect(navEntryEffect('diplomacy').cancelsHeld).toBe(false);
    expect(navEntryEffect('residents').cancelsHeld).toBe(false);
    expect(navEntryEffect('knowledge').cancelsHeld).toBe(false);
  });
});

describe('applying a navigation entry', () => {
  it('keeps one central window open: a press replaces the other window, a repeat closes its own', () => {
    const { press, windows } = mountSurfaces();
    const open = (): ToolWindowId | null => windows.openId();

    press('mission');
    expect(open()).toBe('mission');
    press('build');
    expect(open()).toBe('menu');
    press('statistics');
    expect(open()).toBe('stats');
    press('residents');
    expect(open()).toBe('residents');
    press('knowledge');
    expect(open()).toBe('knowledge');
    press('knowledge');
    expect(open()).toBeNull();
    expect(windows.state().openIds).toEqual([]);
  });

  it('keeps a placement running under an informational window but drops it for a pick', () => {
    const { press, placement } = mountSurfaces();

    placement.enter(BUILDING_JOINERY);
    press('statistics');
    expect(placement.isActive()).toBe(true);
    press('diplomacy');
    expect(placement.isActive()).toBe(true);

    press('build');
    expect(placement.isActive()).toBe(false);
  });

  it('a pick hides the construction window; a cancelled placement brings it back, a landing does not', () => {
    const { press, windows, placement, pick } = mountSurfaces();
    press('build');
    pick(BUILDING_JOINERY);
    expect(windows.openId()).toBeNull(); // hidden for the placement: no window lit, the map takes presses
    expect(placement.isActive()).toBe(true);

    placement.cancel(); // Esc or the right button
    expect(windows.openId()).toBe('menu');
    expect(placement.isActive()).toBe(false);

    pick(BUILDING_JOINERY);
    placement.handleClick(0, 0); // the site lands
    expect(placement.isActive()).toBe(false);
    expect(windows.openId()).toBeNull(); // the window stays away after a placement
  });

  it('Buduj during a placement cancels it and shows the window; another entry replaces it', () => {
    const { press, windows, placement, pick } = mountSurfaces();
    press('build');
    pick(BUILDING_JOINERY);

    press('build');
    expect(placement.isActive()).toBe(false);
    expect(windows.openId()).toBe('menu');
    press('build');
    expect(windows.openId()).toBeNull();

    press('build');
    pick(BUILDING_JOINERY);
    press('assistant');
    expect(placement.isActive()).toBe(false);
    expect(windows.openId()).toBe('extras');
  });

  it('opens the mission window on a caller-supplied page and still closes the others', () => {
    const { press, windows } = mountSurfaces();
    press('build');
    let opened = 0;
    applyNavEntry({ windows: windows.byId, cancelHeld: () => undefined }, 'mission', () => {
      opened++;
      windows.byId.mission.toggle();
    });
    expect(opened).toBe(1);
    expect(windows.openId()).toBe('mission');
  });
});
