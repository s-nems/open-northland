// @vitest-environment jsdom
import type { HudModel } from '@open-northland/render';
import { afterEach, expect, it, vi } from 'vitest';
import {
  AVAILABILITY_REFRESH_MS,
  createConstructionWindow,
} from '../../../src/hud/dom/construction-window.js';
import {
  type BuildingAvailability,
  type MenuBuildingEntry,
  OPEN_AVAILABILITY,
} from '../../../src/hud/tool-panel/building-menu.js';

const VIKING = 1;
const FARM = 12;
const FORBIDDEN: BuildingAvailability = { kind: 'forbidden' };

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('lists a house a script allowed while the world is paused, once the answer lands', () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 40, 33));
  let availability: BuildingAvailability = FORBIDDEN;
  let answers = 0;
  const farm: MenuBuildingEntry = {
    typeId: FARM,
    label: 'Farm',
    kind: 'work',
    cost: [],
    trades: [],
    availability: () => availability,
  };
  const plane = document.createElement('div');
  document.body.append(plane);
  const window = createConstructionWindow({
    plane,
    entries: [farm],
    thumbs: { paint: () => false, holds: () => false },
    pack: null,
    goodIdOf: () => undefined,
    goodLabel: (goodType) => `#${goodType}`,
    papers: () => [],
    paperLabel: () => '',
    buildingLabel: (typeId) => `#${typeId}`,
    homeTribe: VIKING,
    buildTribes: () => [VIKING],
    answersVersion: () => answers,
    onPick: () => undefined,
    tools: [],
    onPickTool: () => undefined,
    onPickPaper: () => undefined,
    onHelp: () => undefined,
    cue: () => undefined,
  });
  const listed = (): number => plane.querySelectorAll('.on-bcard').length;
  try {
    // The paused world's one model: the window opens on the answer held from before the script's result.
    const model: HudModel = { tick: 8, player: 0, population: 0, jobs: [], stocks: [] };
    const opened = 1000;
    const now = vi.spyOn(performance, 'now').mockReturnValue(opened);
    window.update(model);
    window.toggle();
    expect(listed()).toBe(0);

    availability = OPEN_AVAILABILITY;
    window.update(model);
    expect(listed()).toBe(0);

    // The answer lands, but the entries' availability is read at most every quarter second.
    answers += 1;
    window.update(model);
    expect(listed()).toBe(0);
    now.mockReturnValue(opened + AVAILABILITY_REFRESH_MS);
    window.update(model);
    expect(listed()).toBe(1);
  } finally {
    window.dispose();
  }
});
