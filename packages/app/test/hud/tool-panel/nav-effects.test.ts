import { describe, expect, it } from 'vitest';
import type { PanelContext } from '../../../src/hud/tool-panel/context.js';
import { createHeldPaperController } from '../../../src/hud/tool-panel/held-paper.js';
import { applyNavEntry, type NavEntryId } from '../../../src/hud/tool-panel/nav-effects.js';
import { createPlacementController } from '../../../src/hud/tool-panel/placement.js';
import {
  createToolWindows,
  type ToolWindowId,
  type ToolWindows,
} from '../../../src/hud/tool-panel/windows.js';
import { stubAssistantWindow } from '../../support/tool-panel-stubs/assistant-window.js';
import {
  type ConstructionWindowStub,
  stubConstructionWindow,
} from '../../support/tool-panel-stubs/construction-window.js';
import { stubDiplomacyWindow } from '../../support/tool-panel-stubs/diplomacy-window.js';
import { stubKnowledgeWindow } from '../../support/tool-panel-stubs/knowledge-window.js';
import { stubMissionBook } from '../../support/tool-panel-stubs/mission-book.js';
import { stubPlacementStrip } from '../../support/tool-panel-stubs/placement-strip.js';
import { stubResidentsWindow } from '../../support/tool-panel-stubs/residents-window.js';
import { stubStatisticsWindow } from '../../support/tool-panel-stubs/statistics-window.js';

const BUILDING_JOINERY = 23;
const VIKING = 1;

function stubContext(): PanelContext {
  return { uiString: (_table, _id, fallback) => fallback, cue: () => undefined };
}

/** The window registry plus the held placement the mount wires, over a stubbed context and DOM-less
 *  windows. */
function mountSurfaces() {
  const ctx = stubContext();
  const strip = stubPlacementStrip();
  let windows: ToolWindows | null = null;
  const placement = createPlacementController({
    ctx,
    strip,
    labelByType: new Map([[BUILDING_JOINERY, 'Joinery']]),
    enqueue: () => undefined,
    screenToTile: () => ({ col: 1, row: 1 }),
    canPlaceAt: () => true,
    tribe: VIKING,
    owner: 0,
    // As the mount wires it: a cancelled placement brings the construction window back.
    onCancel: () => windows?.byId.menu.resume(),
  });
  let menu: ConstructionWindowStub | null = null;
  windows = createToolWindows({
    knowledgeWindow: stubKnowledgeWindow,
    residentsWindow: stubResidentsWindow,
    constructionWindow: (seam) => {
      menu = stubConstructionWindow(seam);
      return menu;
    },
    buildings: [{ typeId: BUILDING_JOINERY, label: 'Joinery', kind: 'workplace', cost: [], trades: [] }],
    assistantWindow: stubAssistantWindow,
    statisticsWindow: stubStatisticsWindow,
    heldPaper: createHeldPaperController(ctx, strip),
    diplomacyWindow: stubDiplomacyWindow,
    missionBook: stubMissionBook,
    onPickBuilding: (pick) => {
      windows?.byId.menu.suspend();
      placement.enter(pick);
    },
  });
  if (menu === null) throw new Error('the registry did not mount the construction window');
  const surfaces = { windows: windows.byId, cancelHeld: () => placement.cancel() };
  const press = (id: NavEntryId): void => applyNavEntry(surfaces, id);
  const { onPick } = (menu as ConstructionWindowStub).seam;
  return { press, windows, placement, pick: (typeId: number) => onPick(typeId, VIKING) };
}

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
  });

  it('keeps a placement running under an informational window but drops it for a pick', () => {
    const { press, placement } = mountSurfaces();

    placement.enter({ typeId: BUILDING_JOINERY, tribe: VIKING, paper: null });
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
    press('mission');
    expect(placement.isActive()).toBe(false);
    expect(windows.openId()).toBe('mission');
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
