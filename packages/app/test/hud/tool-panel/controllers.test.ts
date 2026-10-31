import type { UiCue } from '@open-northland/audio';
import type { Command, Entity, Paper } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  type BuildingAvailability,
  type MenuBuildingEntry,
  OPEN_AVAILABILITY,
} from '../../../src/hud/tool-panel/building-menu.js';
import type { PanelContext } from '../../../src/hud/tool-panel/context.js';
import { createHeldPaperController } from '../../../src/hud/tool-panel/held-paper.js';
import {
  type BuildingPick,
  createPlacementController,
  PALISADE_LINE_MAX_EDGES,
} from '../../../src/hud/tool-panel/placement.js';
import { createToolWindows } from '../../../src/hud/tool-panel/windows.js';
import { formatMessage, messages } from '../../../src/i18n/index.js';
import { stubAssistantWindow } from '../../support/tool-panel-stubs/assistant-window.js';
import {
  type ConstructionWindowStub,
  stubConstructionWindow,
} from '../../support/tool-panel-stubs/construction-window.js';
import { stubDiplomacyWindow } from '../../support/tool-panel-stubs/diplomacy-window.js';
import { stubMissionBook } from '../../support/tool-panel-stubs/mission-book.js';
import { stubKnowledgeWindow } from '../../support/tool-panel-stubs/knowledge-window.js';
import { stubPlacementStrip } from '../../support/tool-panel-stubs/placement-strip.js';
import { stubResidentsWindow } from '../../support/tool-panel-stubs/residents-window.js';
import { stubStatisticsWindow } from '../../support/tool-panel-stubs/statistics-window.js';

/**
 * Headless tests for the tool-panel WINDOW CONTROLLERS (registry / placement) over a stubbed
 * {@link PanelContext} and DOM-less windows. These pin the contracts the mount relies on: one central
 * window at a time, the paper flow and the placement clicks.
 */

const VIKING = 1;
const FRANK = 2;
const JOINERY = 23;
/** The joinery held for placement, the seat's own unless another nation is named. */
const joinery = (paper: Paper | null = null, tribe = VIKING): BuildingPick => ({
  typeId: JOINERY,
  tribe,
  paper,
});

/** A PanelContext whose GUI cue records every click it was asked to play. */
function stubContext(): { ctx: PanelContext; cues: UiCue[] } {
  const cues: UiCue[] = [];
  const ctx: PanelContext = {
    uiString: (_table, _id, fallback) => fallback,
    cue: (cue) => {
      cues.push(cue);
    },
  };
  return { ctx, cues };
}

const BUILDINGS: readonly MenuBuildingEntry[] = [
  { typeId: 7, label: 'Stock', kind: 'storage', cost: [], trades: [] },
  { typeId: 23, label: 'Joinery', kind: 'workplace', cost: [], trades: [] },
];

describe('tool windows registry', () => {
  function mountWindows(buildings: readonly MenuBuildingEntry[] = BUILDINGS) {
    const { ctx } = stubContext();
    const picks: BuildingPick[] = [];
    let menu: ConstructionWindowStub | null = null;
    const stats = stubStatisticsWindow();
    const heldPaper = createHeldPaperController(ctx, stubPlacementStrip());
    const knowledge = stubKnowledgeWindow();
    const windows = createToolWindows({
      buildings,
      knowledgeWindow: () => knowledge,
      residentsWindow: stubResidentsWindow,
      constructionWindow: (seam) => {
        menu = stubConstructionWindow(seam);
        return menu;
      },
      assistantWindow: stubAssistantWindow,
      statisticsWindow: () => stats,
      heldPaper,
      diplomacyWindow: stubDiplomacyWindow,
      missionBook: stubMissionBook,
      onPickBuilding: (pick) => picks.push(pick),
    });
    if (menu === null) throw new Error('the registry did not mount the construction window');
    return { windows, picks, heldPaper, stats, knowledge, menu: menu as ConstructionWindowStub };
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

    // The house plan: placement at once in the window's nation with the plan riding it; nothing is held.
    menu.toggle();
    menu.seam.onPickPaper(housePlan, FRANK);
    expect(picks).toEqual([joinery(housePlan, FRANK)]);
    expect(heldPaper.isActive()).toBe(false);

    // The place-any plan: held (the strip up, a held mode) for the window's next pick, which carries
    // it once in the nation picked. The plan pays for the house and lifts no technology lock: the
    // catalogue reads as it is.
    menu.seam.onPickPaper(anyPlan, VIKING);
    expect(heldPaper.isActive()).toBe(true);
    expect(menu.seam.entries[0]?.availability?.(VIKING)).toEqual({ kind: 'locked' });
    menu.seam.onPick(BUILDINGS[1]?.typeId ?? 0, FRANK);
    expect(picks[1]).toEqual({ typeId: BUILDINGS[1]?.typeId, tribe: FRANK, paper: anyPlan });
    expect(heldPaper.isActive()).toBe(false);

    // Closing the window without a pick drops the held plan: the next pick is an ordinary site.
    firstBuildingLocked = false;
    menu.seam.onPickPaper(anyPlan, VIKING);
    menu.toggle();
    windows.refresh();
    expect(heldPaper.isActive()).toBe(false);
    menu.toggle();
    menu.seam.onPick(BUILDINGS[0]?.typeId ?? 0, VIKING);
    expect(picks[2]).toEqual({ typeId: BUILDINGS[0]?.typeId, tribe: VIKING, paper: null });

    // A cancel (Esc, a right click) or a world click drops it too, and the window stays open.
    menu.seam.onPickPaper(anyPlan, VIKING);
    expect(heldPaper.handleClick(0, 0)).toBe(true); // a world press: consumed, the plan dropped
    expect(heldPaper.isActive()).toBe(false);
    expect(menu.isOpen()).toBe(true);
    expect(heldPaper.handleClick(0, 0)).toBe(false); // nothing held: the press is the world's
    heldPaper.hold(anyPlan);
    heldPaper.cancel();
    expect(heldPaper.held()).toBeNull();
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

  it("a card's help opens that building's entry in place of the catalogue", () => {
    const { windows, menu, knowledge } = mountWindows();
    menu.toggle();
    menu.seam.onHelp(23);
    expect(menu.isOpen()).toBe(false);
    expect(windows.openId()).toBe('knowledge');
    expect(knowledge.shown).toEqual([23]);
  });
});

describe('placement controller', () => {
  function mount(
    screenToTile: (x: number, y: number) => { col: number; row: number } | null,
    canPlaceAt: (
      typeId: number,
      tribe: number,
      col: number,
      row: number,
      techWaived?: boolean,
      owner?: number,
    ) => boolean = () => true,
    canPlacePalisadeAt: (gfxIndex: number, owner: number, col: number, row: number) => boolean = () => true,
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
      tribe: VIKING,
      owner: 0,
      onCancel: (paper) => cancels.push(paper),
      ...extra,
    });
    return { placement, commands, cues, strip, cancels };
  }

  it('places a building once the sim answers the click, and orders once for clicks made meanwhile', async () => {
    let answer: (ok: boolean) => void = () => undefined;
    const asked: number[] = [];
    const { placement, commands } = mount(
      () => ({ col: 4, row: 2 }),
      () => false, // the cursor's last answer refuses; the click asks afresh
      undefined,
      undefined,
      {
        clickAsks: {
          askPlaceAt: (typeId) => {
            asked.push(typeId);
            return new Promise((resolve) => {
              answer = resolve;
            });
          },
          palisadeLineReady: () => Promise.resolve(),
          roadLineReady: () => Promise.resolve(),
          askPalisadeGate: () => Promise.resolve(null),
        },
      },
    );
    placement.enter(joinery());
    expect(placement.handleClick(10, 10)).toBe(true);
    expect(placement.handleClick(10, 10)).toBe(true);
    expect(asked).toEqual([23]);
    answer(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(commands.map((command) => command.kind)).toEqual(['placeBuilding']);
    expect(placement.isActive()).toBe(false);
  });

  it('drops an answered click once the panel is gone', async () => {
    const { placement, commands } = mount(() => ({ col: 4, row: 2 }), undefined, undefined, undefined, {
      clickAsks: {
        askPlaceAt: () => Promise.resolve(true),
        palisadeLineReady: () => Promise.resolve(),
        roadLineReady: () => Promise.resolve(),
        askPalisadeGate: () => Promise.resolve(null),
      },
    });
    placement.enter(joinery());
    placement.handleClick(10, 10);
    placement.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(commands).toEqual([]);
  });

  it('names the held building on the strip, clears it with the mode, and reports only a cancel, with its unspent plan', () => {
    const { placement, strip, cancels } = mount(() => ({ col: 4, row: 2 }));
    placement.enter(joinery());
    expect(strip.shown).toEqual({ label: 'Joinery', hint: messages().hud.construction.placeHint });
    placement.handleClick(10, 10);
    expect(strip.shown).toBeNull();
    expect(cancels).toEqual([]); // a landing is not a cancel: the window stays away

    const plan: Paper = { kind: 'placeHouse', param: 23 };
    placement.enter(joinery(plan));
    expect(strip.shown?.hint).toBe(messages().hud.construction.placePaperHint);
    placement.cancel();
    expect(strip.shown).toBeNull();
    expect(cancels).toEqual([plan]); // the owner takes the plan back: nothing was spent
    placement.cancel(); // nothing held: nothing to report
    expect(cancels).toEqual([plan]);
    placement.enter(joinery());
    placement.cancel();
    expect(cancels).toEqual([plan, null]);
  });

  it('places a construction site at an accepted tile and EXITS build mode (one click = one foundation)', () => {
    const { placement, commands } = mount(() => ({ col: 4, row: 2 }));
    expect(placement.handleClick(10, 10)).toBe(false); // not active yet → not consumed

    placement.enter(joinery());
    expect(placement.isActive()).toBe(true);
    expect(placement.handleClick(10, 10)).toBe(true);
    // Player placement is always a construction site (`underConstruction`) - builders raise it globally.
    expect(commands).toEqual([
      { kind: 'placeBuilding', buildingType: 23, x: 4, y: 2, tribe: 1, owner: 0, underConstruction: true },
    ]);
    expect(placement.isActive()).toBe(false); // landed → build mode over (the original's flow)
  });

  it('keeps the building held for each Shift click, and letting Shift go brings the window back', () => {
    let tile = { col: 4, row: 2 };
    const { placement, commands, cancels } = mount(() => tile);
    placement.enter(joinery());
    placement.setShift(true);
    placement.handleClick(10, 10);
    tile = { col: 8, row: 2 };
    placement.handleClick(20, 10);
    expect(commands.map((c) => (c.kind === 'placeBuilding' ? c.x : null))).toEqual([4, 8]);
    expect(placement.activeBuilding()?.typeId).toBe(JOINERY);
    placement.setShift(false);
    expect(placement.isActive()).toBe(false);
    expect(cancels).toEqual([null]); // the construction window comes back for the next pick

    // Shift held without a placement ends nothing; a plan pays for one house, Shift or not.
    placement.enter(joinery());
    placement.setShift(true);
    placement.setShift(false);
    expect(placement.isActive()).toBe(true);
    placement.cancel();
    placement.enter(joinery({ kind: 'placeHouse', param: JOINERY }));
    placement.setShift(true);
    placement.handleClick(10, 10);
    expect(placement.isActive()).toBe(false);
    expect(cancels).toEqual([null, null]);
  });

  it('a Shift click still waiting on the sim places before letting Shift go ends the run', async () => {
    let answer: (ok: boolean) => void = () => undefined;
    const { placement, commands, cancels } = mount(
      () => ({ col: 4, row: 2 }),
      undefined,
      undefined,
      undefined,
      {
        clickAsks: {
          askPlaceAt: () =>
            new Promise((resolve) => {
              answer = resolve;
            }),
          palisadeLineReady: () => Promise.resolve(),
          roadLineReady: () => Promise.resolve(),
          askPalisadeGate: () => Promise.resolve(null),
        },
      },
    );
    placement.enter(joinery());
    placement.setShift(true);
    placement.handleClick(10, 10);
    answer(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    placement.handleClick(10, 10);
    placement.setShift(false);
    expect(placement.isActive()).toBe(true);
    answer(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(commands.map((c) => c.kind)).toEqual(['placeBuilding', 'placeBuilding']);
    expect(placement.isActive()).toBe(false);
    expect(cancels).toEqual([null]);
  });

  it("places another nation's house as that nation, asking its own rule, while roads stay the seat's", () => {
    const asked: number[] = [];
    let tile = { col: 4, row: 2 };
    const { placement, commands } = mount(
      () => tile,
      (_type, tribe) => {
        asked.push(tribe);
        return true;
      },
      undefined,
      undefined,
      { canPlaceRoadAt: () => true },
    );
    placement.enter(joinery(null, FRANK));
    expect(placement.activeBuilding()?.tribe).toBe(FRANK);
    placement.handleClick(10, 10);
    expect(asked).toEqual([FRANK]);
    expect(commands).toEqual([
      {
        kind: 'placeBuilding',
        buildingType: JOINERY,
        x: 4,
        y: 2,
        tribe: FRANK,
        owner: 0,
        underConstruction: true,
      },
    ]);

    placement.enterRoad();
    placement.handleClick(10, 10);
    tile = { col: 5, row: 2 };
    placement.handleClick(20, 10);
    expect(commands.slice(1)).toEqual(
      [4, 5].map((x) => ({ kind: 'placeRoadSite', x, y: 2, tribe: VIKING, owner: 0 })),
    );
  });

  it('a paper held into placement rides the command, and leaves with the mode', () => {
    const { placement, commands } = mount(() => ({ col: 4, row: 2 }));
    const paper = { kind: 'placeHouse', param: 23 } as const;
    placement.enter(joinery(paper));
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
    placement.enter(joinery());
    placement.handleClick(10, 10);
    expect(commands[1]).not.toHaveProperty('paper');
  });

  it('waives the live gate for a paper so technology cannot reject its placement', () => {
    const paper = { kind: 'placeAny', param: 0 } as const;
    const seen: Array<boolean | undefined> = [];
    const { placement, commands } = mount(
      () => ({ col: 4, row: 2 }),
      (_type, _tribe, _col, _row, techWaived) => {
        seen.push(techWaived);
        return techWaived === true;
      },
    );

    placement.enter(joinery(paper));
    expect(placement.handleClick(10, 10)).toBe(true);
    expect(seen).toEqual([true]);
    expect(commands).toHaveLength(1);
  });

  it('a click on ground the placement rule rejects is consumed but inert and silent (mode survives)', () => {
    const { placement, commands, cues } = mount(
      () => ({ col: 4, row: 2 }),
      () => false, // the probe says the anchor doesn't fit here
    );
    placement.enter(joinery());
    expect(placement.handleClick(10, 10)).toBe(true); // claimed - never falls through to picking
    expect(commands).toHaveLength(0); // nothing enqueued: the sim would drop it anyway
    expect(cues).toEqual([]); // the world makes no sound for a site that did not land
    expect(placement.isActive()).toBe(true); // a mis-click on the dim wash doesn't end the mode
  });

  it('consumes an off-map click without enqueuing, and cancel exits the mode', () => {
    const { placement, commands } = mount(() => null);
    placement.enter(joinery());
    expect(placement.handleClick(10, 10)).toBe(true); // claimed, but nothing placed
    expect(commands).toHaveLength(0);

    placement.cancel();
    expect(placement.isActive()).toBe(false);
    expect(placement.handleClick(10, 10)).toBe(false);
  });

  it('clicks confirm when the site lands; the cancel itself is silent (the input layer fails it)', () => {
    const { placement, cues } = mount(() => ({ col: 4, row: 2 }));
    placement.enter(joinery());
    placement.handleClick(10, 10);
    expect(cues).toEqual(['confirm']);
    placement.enter(joinery());
    placement.cancel();
    expect(cues).toEqual(['confirm']);
  });

  it('starts a wall line on the first click, lays the capped line on the second and exits', () => {
    let tile = { col: 4, row: 2 };
    const { placement, commands, cues, strip } = mount(() => tile);

    placement.enterPalisade(691, 'wall');
    expect(strip.shown).toEqual({
      label: messages().hud.palisade,
      hint: messages().hud.construction.placeWallHint,
    });
    expect(placement.lineStarts()).not.toBeNull();
    expect(placement.handleClick(10, 10)).toBe(true);
    expect(commands).toEqual([]);
    expect(placement.activeLine()?.anchor).toEqual({ col: 4, row: 2 });
    expect(placement.lineStarts()).toBeNull();
    expect(strip.shown?.hint).toBe(messages().hud.construction.placeWallLineHint);
    tile = { col: 40, row: 2 };
    expect(placement.palisadePreview(tile)).toHaveLength(PALISADE_LINE_MAX_EDGES + 1);
    expect(placement.handleClick(20, 10)).toBe(true);

    expect(commands).toHaveLength(PALISADE_LINE_MAX_EDGES + 1);
    expect(commands[0]).toMatchObject({ kind: 'placePalisade', x: 4, y: 2 });
    expect(commands[20]).toMatchObject({ kind: 'placePalisade', x: 24, y: 2 });
    expect(cues).toEqual(['confirm']);
    expect(placement.isActive()).toBe(false);
    expect(strip.shown).toBeNull();
  });

  it('draws on from the end of a line laid with Ctrl held, and ends after a plain one', () => {
    let tile = { col: 4, row: 2 };
    const { placement, commands } = mount(() => tile);
    placement.enterPalisade(691, 'wall');
    placement.handleClick(0, 0, { keep: true });
    tile = { col: 6, row: 2 };
    placement.handleClick(10, 0, { keep: true });
    expect(commands).toHaveLength(3);
    expect(placement.activePalisade()).toBe(691);
    expect(placement.activeLine()?.anchor).toEqual({ col: 6, row: 2 });

    tile = { col: 8, row: 2 };
    placement.handleClick(10, 0);
    expect(commands.slice(3)).toMatchObject([
      { kind: 'placePalisade', x: 7, y: 2 },
      { kind: 'placePalisade', x: 8, y: 2 },
    ]);
    expect(placement.isActive()).toBe(false);
  });

  it('stops a wall line at the first rejected site instead of placing across a gap', () => {
    let tile = { col: 4, row: 2 };
    const { placement, commands } = mount(
      () => tile,
      () => true,
      (_gfxIndex, _owner, col) => col < 7,
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
      (_gfxIndex, _owner, col) => col > 4,
      undefined,
      { palisadeBuiltAt: (_owner, col, row) => col === 4 && row === 2 },
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

  it('lays one road site per open node of a road line, passing a laid road, and stays held', () => {
    let tile = { col: 4, row: 2 };
    const { placement, commands, cues, strip } = mount(
      () => tile,
      undefined,
      () => false,
      undefined,
      {
        canPlaceRoadAt: (col) => col !== 6,
        roadBuiltAt: (col) => col === 6,
      },
    );

    placement.enterRoad();
    expect(placement.activeRoad()).toBe(true);
    expect(strip.shown).toEqual({
      label: messages().hud.construction.road,
      hint: messages().hud.construction.placeRoadHint,
    });
    expect(placement.lineStarts()).not.toBeNull();
    placement.handleClick(0, 0);
    expect(placement.activeLine()?.anchor).toEqual({ col: 4, row: 2 });
    expect(strip.shown?.hint).toBe(messages().hud.construction.placeRoadLineHint);
    tile = { col: 8, row: 2 };
    expect(placement.roadPreview(tile)?.nodes.map((node) => node.state)).toEqual([
      'open',
      'open',
      'built',
      'open',
      'open',
    ]);
    expect(placement.palisadePreview(tile)).toBeNull();
    placement.handleClick(10, 0);

    expect(commands).toEqual(
      [4, 5, 7, 8].map((x) => ({ kind: 'placeRoadSite', x, y: 2, tribe: 1, owner: 0 })),
    );
    expect(cues).toEqual(['confirm']);
    expect(placement.activeRoad()).toBe(true);
    expect(placement.activeLine()).toBeNull();
    expect(strip.shown?.hint).toBe(messages().hud.construction.placeRoadHint);
  });

  it('fails a line start on a refused node, for the road and the wall tool alike', () => {
    const tile = { col: 4, row: 2 };
    const { placement, cues } = mount(
      () => tile,
      undefined,
      () => false,
      undefined,
      { canPlaceRoadAt: () => false },
    );
    placement.enterRoad();
    placement.handleClick(0, 0);
    expect(placement.activeLine()).toBeNull();
    placement.enterPalisade(691, 'wall');
    placement.handleClick(0, 0);
    expect(placement.activeLine()).toBeNull();
    expect(cues).toEqual(['fail', 'fail']);
  });

  it('runs a road over upgrade ground only while its key is switched on, and orders it so', () => {
    let tile = { col: 4, row: 2 };
    /** Column 6 of row 2 is a building's upgrade ground. */
    const growth = (col: number, row: number): boolean => col === 6 && row === 2;
    const { placement, commands, strip } = mount(() => tile, undefined, undefined, undefined, {
      canPlaceRoadAt: (col, row, overUpgradeGround) => overUpgradeGround === true || !growth(col, row),
      upgradeGroundKey: () => 'F',
    });
    const copy = messages().hud.construction;
    expect(placement.toggleUpgradeGround()).toBe(false);
    placement.enterRoad();
    expect(strip.shown?.hint).toBe(
      `${copy.placeRoadHint}, ${formatMessage(copy.overUpgradeGroundHint, { key: 'F' })}`,
    );
    placement.handleClick(0, 0);
    tile = { col: 8, row: 2 };
    expect(placement.roadPreview(tile)?.nodes.some((node) => growth(node.col, node.row))).toBe(false);

    expect(placement.toggleUpgradeGround()).toBe(true);
    expect(strip.shown?.label).toBe(`${copy.road}: ${copy.overUpgradeGround}`);
    expect(placement.roadPreview(tile)?.nodes.map((node) => [node.col, node.row])).toEqual(
      [4, 5, 6, 7, 8].map((col) => [col, 2]),
    );
    placement.handleClick(10, 0);
    expect(commands).toEqual(
      [4, 5, 6, 7, 8].map((x) => ({
        kind: 'placeRoadSite',
        x,
        y: 2,
        tribe: 1,
        owner: 0,
        overUpgradeGround: true,
      })),
    );

    // Picking the tool up again starts with the switch off.
    placement.enterRoad();
    expect(strip.shown?.label).toBe(copy.road);
  });

  it('orders a wall line over upgrade ground once switched, but not a gate', () => {
    let tile = { col: 4, row: 2 };
    const growth = (col: number, row: number): boolean => col === 6 && row === 2;
    const { placement, commands } = mount(() => tile, undefined, undefined, undefined, {
      canPlacePalisadeAt: (_gfx, _owner, col, row, overUpgradeGround) =>
        overUpgradeGround === true || !growth(col, row),
    });
    placement.enterPalisade(691, 'gate');
    expect(placement.toggleUpgradeGround()).toBe(false);
    placement.enterPalisade(691, 'wall');
    expect(placement.toggleUpgradeGround()).toBe(true);
    placement.handleClick(0, 0);
    tile = { col: 8, row: 2 };
    placement.handleClick(10, 0);
    expect(
      commands.map((command) => command.kind === 'placePalisade' && [command.x, command.overUpgradeGround]),
    ).toEqual([4, 5, 6, 7, 8].map((x) => [x, true]));
  });

  it('cancels the own road sites under an Alt line and keeps the road tool', () => {
    let tile = { col: 4, row: 2 };
    // Own sites on columns 5 and 7 of row 2; column 9 lies past the line's end.
    const sites = new Map([
      [5, 105],
      [7, 107],
      [9, 109],
    ]);
    const { placement, commands, cues, strip } = mount(() => tile, undefined, undefined, undefined, {
      canPlaceRoadAt: () => true,
      ownRoadSiteAt: (col, row) => (row === 2 ? (sites.get(col) ?? null) : null),
    });
    placement.enterRoad();
    placement.setErase(true);
    expect(strip.shown).toEqual({
      label: messages().hud.cancelRoadSite,
      hint: messages().hud.construction.cancelRoadHint,
    });
    expect(placement.activeLine()).toBeNull();
    expect(placement.lineStarts()).toBeNull();
    placement.handleClick(0, 0);
    expect(strip.shown?.hint).toBe(messages().hud.construction.cancelRoadLineHint);
    tile = { col: 8, row: 2 };
    const preview = placement.roadPreview(tile);
    expect(preview?.cancel).toBe(true);
    expect(preview?.anchored).toBe(true);
    expect(preview?.nodes.map((node) => node.state)).toEqual(['built', 'open', 'built', 'open', 'built']);
    placement.handleClick(10, 0);
    expect(commands).toEqual([
      { kind: 'cancelRoadSite', roadSite: 105 },
      { kind: 'cancelRoadSite', roadSite: 107 },
    ]);
    expect(cues).toEqual(['confirm']);
    expect(placement.activeRoad()).toBe(true);

    // A line over no site of the seat's fails, and letting go of Alt lays road again.
    tile = { col: 4, row: 6 };
    placement.handleClick(0, 0);
    tile = { col: 8, row: 6 };
    placement.handleClick(10, 0);
    expect(cues).toEqual(['confirm', 'fail']);
    placement.setErase(false);
    expect(placement.roadPreview(tile)?.cancel).toBe(false);
    expect(strip.shown?.hint).toBe(messages().hud.construction.placeRoadHint);
  });

  it('cancels from a started road line when Alt comes down, and drops that line', () => {
    let tile = { col: 4, row: 2 };
    const { placement, commands } = mount(() => tile, undefined, undefined, undefined, {
      canPlaceRoadAt: () => true,
      ownRoadSiteAt: (col) => (col === 6 ? 106 : null),
    });
    placement.enterRoad();
    placement.handleClick(0, 0);
    placement.setErase(true);
    tile = { col: 7, row: 2 };
    expect(placement.roadPreview(tile)?.nodes[0]).toMatchObject({ col: 4, row: 2 });
    placement.handleClick(10, 0);
    expect(commands).toEqual([{ kind: 'cancelRoadSite', roadSite: 106 }]);
    placement.setErase(false);
    expect(placement.activeLine()).toBeNull();
  });

  it('stops a road line at the first refused node', () => {
    let tile = { col: 4, row: 2 };
    const { placement, commands } = mount(() => tile, undefined, undefined, undefined, {
      canPlaceRoadAt: (col) => col < 6,
    });
    placement.enterRoad();
    placement.handleClick(0, 0);
    tile = { col: 9, row: 2 };
    placement.handleClick(10, 0);
    expect(commands.map((command) => ('x' in command ? command.x : null))).toEqual([4, 5]);
  });

  it('lays an admin standing-wall line finished for the chosen owner through the trusted channel', () => {
    let tile = { col: 4, row: 2 };
    const trusted: Command[] = [];
    const builtOwners = new Set<number>();
    const { placement, commands, strip } = mount(() => tile, undefined, undefined, undefined, {
      enqueueTrusted: (command) => trusted.push(command),
      palisadeBuiltAt: (owner) => {
        builtOwners.add(owner);
        return false;
      },
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
    // The line joins the chosen owner's walls, not the seat's.
    expect([...builtOwners]).toEqual([3]);
  });

  it('stands an admin building finished for the chosen owner past the technology gate, cancelling quietly', () => {
    const trusted: Command[] = [];
    const asked: [boolean | undefined, number | undefined][] = [];
    const { placement, commands, strip, cancels } = mount(
      () => ({ col: 4, row: 2 }),
      (_type, _tribe, _col, _row, techWaived, owner) => {
        asked.push([techWaived, owner]);
        return true;
      },
      undefined,
      undefined,
      { enqueueTrusted: (command) => trusted.push(command) },
    );
    placement.enter({ typeId: 23, tribe: 2, paper: null, standing: { owner: 3 } });
    expect(strip.shown?.label).toBe(formatMessage(messages().admin.standingBuilding, { name: 'Joinery' }));
    placement.handleClick(0, 0);
    // The chosen owner's ground decides, as the sim's rule for that owner will.
    expect(asked).toEqual([[true, 3]]);
    expect(commands).toEqual([]);
    expect(trusted).toEqual([
      {
        kind: 'placeBuilding',
        buildingType: 23,
        x: 4,
        y: 2,
        tribe: 2,
        owner: 3,
        underConstruction: false,
        ignoreTechnology: true,
      },
    ]);
    placement.enter({ typeId: 23, tribe: 2, paper: null, standing: { owner: 3 } });
    expect(placement.activeStanding()).toBe(true);
    placement.cancel();
    expect(cancels).toEqual([]);
    placement.enter({ typeId: 23, tribe: 1, paper: null });
    expect(placement.activeStanding()).toBe(false);
    placement.enterRoad({ owner: 3, tribe: 2 });
    expect(placement.activeStanding()).toBe(true);
    placement.enterRoad();
    expect(placement.activeStanding()).toBe(false);
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
    // The gate itself previews at the span's centre, so no span markers show.
    expect(placement.gatePreview({ col: 8, row: 6 })).toEqual({
      col: 6,
      row: 6,
      gfxIndex: 698,
      ok: true,
    });
    expect(placement.palisadePreview({ col: 8, row: 6 })).toBeNull();
    placement.handleClick(0, 0);
    expect(commands).toEqual([{ kind: 'convertPalisadeGate', palisade: center, gfxIndex: 698 }]);
    // One gate per pick: the tool leaves like a placed building.
    expect(placement.isActive()).toBe(false);
  });

  it('previews a refused gate red, and marks the span of a run no gate row suits', () => {
    const center = 17 as Entity;
    let gfxIndex: number | null = 698;
    const { placement } = mount(
      () => ({ col: 8, row: 6 }),
      () => true,
      () => true,
      () => ({
        canConvert: false,
        center,
        gfxIndex,
        span: [4, 5, 6, 7, 8].map((col) => ({ hx: col, hy: 6 })),
      }),
    );
    placement.enterPalisade(696, 'gate');
    expect(placement.gatePreview({ col: 8, row: 6 })).toEqual({
      col: 6,
      row: 6,
      gfxIndex: 698,
      ok: false,
    });
    gfxIndex = null;
    expect(placement.gatePreview({ col: 8, row: 6 })).toBeNull();
    expect(placement.palisadePreview({ col: 8, row: 6 })).toEqual(
      [4, 5, 6, 7, 8].map((col) => ({ col, row: 6, state: 'blocked' })),
    );
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
      (col, row) => {
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
