// @vitest-environment jsdom
import type { UiCue } from '@open-northland/audio';
import { terrainWorldBounds, tileToScreen } from '@open-northland/render';
import { fx, type WorldSnapshot } from '@open-northland/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiplomacyMap } from '../../../src/hud/diplomacy-map/index.js';
import type { DiplomacyMapNation } from '../../../src/hud/diplomacy-map/labels.js';
import { type MinimapLayout, overviewLayout, zoomMinimapLayout } from '../../../src/hud/minimap/model.js';
import { messages } from '../../../src/i18n/index.js';
import { type Ent, snapshotOf } from '../../support/snapshot.js';

const MAP_CELLS = 64;
const SCREEN_W = 1280;
const SCREEN_H = 720;
const UI_SCALE = 2;
const BOUNDS = terrainWorldBounds(MAP_CELLS, MAP_CELLS);
const WHOLE_MAP = overviewLayout(BOUNDS, SCREEN_H, UI_SCALE, SCREEN_W);
/** The hole's centre in design px from its corner, where a settlement stands when the map zooms on it. */
const HOLE_CENTRE_X = WHOLE_MAP.inner.w / 2 / UI_SCALE;
/** The map's wall-clock pace between two reads of who stands where. */
const READ_INTERVAL_MS = 1000;
const ZOOM_IN = 2;
const FULL_ZOOM = 4;
/** An even row, which the raster's stagger leaves unshifted, near the middle of the map. */
const MID = 32;

const VIEWER = 0;
const ALLY = 1;
const FOE = 2;

const OWN_NATION: DiplomacyMapNation = {
  player: VIEWER,
  name: 'Vikings',
  colour: 0x112233,
  own: true,
  hasPage: false,
};
const ALLY_NATION: DiplomacyMapNation = {
  player: ALLY,
  name: 'Forest folk',
  colour: 0x445566,
  own: false,
  hasPage: true,
  relation: { towardYou: 'friend', yourStance: 'enemy' },
};
const FOE_NATION: DiplomacyMapNation = {
  player: FOE,
  name: 'Raiders',
  colour: 0x778899,
  own: false,
  hasPage: true,
  relation: { towardYou: 'enemy', yourStance: 'neutral' },
};

const owned = (player: number, col: number, row: number) => ({
  Owner: { player },
  Position: { x: fx.fromInt(col), y: fx.fromInt(row) },
});
const hut = (id: number, player: number, col: number, row: number): Ent => ({
  id,
  components: { Building: {}, ...owned(player, col, row) },
});
const person = (id: number, player: number, col: number, row: number): Ent => ({
  id,
  components: { Settler: {}, Person: {}, ...owned(player, col, row) },
});

const zoomedOn = (col: number, row: number, zoom = ZOOM_IN): MinimapLayout =>
  zoomMinimapLayout(WHOLE_MAP, BOUNDS, zoom, tileToScreen(col, row));

afterEach(() => document.body.replaceChildren());

function mount(startNations: readonly DiplomacyMapNation[], startWorld: readonly Ent[] = []) {
  const overviewHost = document.createElement('div');
  document.body.append(overviewHost);
  const world = { nations: startNations, snapshot: snapshotOf(startWorld) };
  const state = { layout: WHOLE_MAP, clock: 0, unavailable: false };
  const minimap = {
    setOverview: vi.fn<(open: boolean) => void>(),
    placement: () => ({ layout: state.layout, bounds: BOUNDS }),
    focusOverviewButton: vi.fn<() => void>(),
    overviewHost,
    overviewCanvas: document.createElement('canvas'),
  };
  const nations = vi.fn(() => world.nations);
  const snapshot = vi.fn((): WorldSnapshot => world.snapshot);
  const onNation = vi.fn<(player: number) => void>();
  const cue = vi.fn<(cue: UiCue) => void>();
  const map = createDiplomacyMap({
    minimap,
    nations,
    snapshot,
    fog: () => null,
    memory: undefined,
    paintEmblem: () => false,
    uiScale: () => UI_SCALE,
    unavailable: () => state.unavailable,
    onNation,
    cue,
    now: () => state.clock,
  });
  const all = <T extends HTMLElement>(selector: string): T[] => [
    ...overviewHost.querySelectorAll<T>(selector),
  ];
  const one = <T extends HTMLElement>(selector: string): T => {
    const found = overviewHost.querySelector<T>(selector);
    if (found === null) throw new Error(`no ${selector}`);
    return found;
  };
  return {
    map,
    minimap,
    nations,
    snapshot,
    onNation,
    cue,
    state,
    world,
    closeButton: () => one<HTMLButtonElement>('.on-dipmap__close'),
    unknownStrip: () => one('.on-dipmap__unknown'),
    stripPlaques: () => all('.on-dipmap__unknown .on-dipmap-plaque'),
    plaques: () => all<HTMLButtonElement>('.on-dipmap-plaque--map'),
    pins: () => all('.on-dipmap__pin'),
    nextRead: (): void => {
      state.clock += READ_INTERVAL_MS;
      map.refresh();
    },
  };
}

const nameOn = (plaque: HTMLElement | undefined): string | null | undefined =>
  plaque?.querySelector('.on-dipmap-plaque__name')?.textContent;

const pinX = (pin: HTMLElement | undefined): number => Number.parseFloat(pin?.style.left ?? '');

describe('createDiplomacyMap', () => {
  it('opens by showing the overview, leaving the keyboard where it is', () => {
    const { map, minimap, closeButton } = mount([OWN_NATION]);
    map.open();
    expect(map.isOpen()).toBe(true);
    expect(document.activeElement).not.toBe(closeButton());
    expect(minimap.setOverview).toHaveBeenLastCalledWith(true);
  });

  it('closes by shutting the overview, handing back the focus it held through the button', () => {
    const { map, minimap, closeButton } = mount([OWN_NATION]);
    map.open();
    map.close();
    expect(minimap.focusOverviewButton).not.toHaveBeenCalled();
    map.open();
    closeButton().focus();
    closeButton().click();
    expect(map.isOpen()).toBe(false);
    expect(minimap.setOverview).toHaveBeenLastCalledWith(false);
    expect(minimap.focusOverviewButton).toHaveBeenCalledOnce();
  });

  it('hands back the focus a control of the overview held, not only one on the labels', () => {
    const { map, minimap } = mount([OWN_NATION]);
    const zoomButton = document.createElement('button');
    minimap.overviewHost.append(zoomButton);
    map.open();
    zoomButton.focus();
    map.close();
    expect(minimap.focusOverviewButton).toHaveBeenCalledOnce();
  });

  it('reads nothing while shut', () => {
    const { map, nations, snapshot } = mount([OWN_NATION]);
    map.refresh();
    map.open();
    map.close();
    nations.mockClear();
    snapshot.mockClear();
    map.refresh();
    expect(nations).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('reads again only once a read interval has passed, however often it refreshes', () => {
    const { map, nations, state } = mount([OWN_NATION]);
    map.open();
    expect(nations).toHaveBeenCalledOnce();
    state.clock = READ_INTERVAL_MS - 1;
    map.refresh();
    expect(nations).toHaveBeenCalledOnce();
    state.clock = READ_INTERVAL_MS;
    map.refresh();
    map.refresh();
    expect(nations).toHaveBeenCalledTimes(2);
  });

  it("plaques a listed nation's settlement with its name and both stances", () => {
    const { map, plaques } = mount([ALLY_NATION], [hut(1, ALLY, MID, MID)]);
    map.open();
    const [plaque] = plaques();
    expect(plaques()).toHaveLength(1);
    expect(nameOn(plaque)).toBe(ALLY_NATION.name);
    const copy = messages().hud;
    const { stances, theirs, ours } = copy.diplomacyWindow;
    expect(plaque?.querySelector('.on-dipmap-plaque__relation')?.textContent).toBe(
      `${stances.friend}${stances.enemy}`,
    );
    expect(plaque?.getAttribute('aria-label')).toContain(
      `${theirs}: ${stances.friend}\n${ours}: ${stances.enemy}`,
    );
  });

  it('strips a listed nation with no known building, and hides the strip once none is left', () => {
    const { map, world, plaques, stripPlaques, unknownStrip, nextRead } = mount(
      [ALLY_NATION, FOE_NATION],
      [hut(1, ALLY, MID, MID)],
    );
    map.open();
    expect(stripPlaques().map(nameOn)).toEqual([FOE_NATION.name]);
    expect(unknownStrip().hidden).toBe(false);

    world.snapshot = snapshotOf([hut(1, ALLY, MID, MID), hut(2, FOE, MID, MID)]);
    nextRead();
    expect(stripPlaques()).toEqual([]);
    expect(unknownStrip().hidden).toBe(true);
    expect(plaques().map(nameOn)).toEqual([ALLY_NATION.name, FOE_NATION.name]);
  });

  it('gives no plaque or pin to a nation absent from the list, its buildings standing or not', () => {
    const { map, plaques, pins, stripPlaques } = mount(
      [ALLY_NATION],
      [hut(1, ALLY, MID, MID), hut(2, FOE, 1, 1)],
    );
    map.open();
    expect(plaques().map(nameOn)).toEqual([ALLY_NATION.name]);
    expect(pins()).toHaveLength(1);
    expect(stripPlaques()).toEqual([]);
  });

  it("answers a press on a nation's plaque with its player, and none on the viewer's own", () => {
    const { map, onNation, plaques } = mount(
      [OWN_NATION, ALLY_NATION],
      [hut(1, VIEWER, MID, MID), hut(2, ALLY, 1, 1)],
    );
    map.open();
    const byName = (name: string | undefined) => plaques().find((plaque) => nameOn(plaque) === name);
    byName(OWN_NATION.name)?.click();
    expect(onNation).not.toHaveBeenCalled();
    byName(ALLY_NATION.name)?.click();
    expect(onNation.mock.calls).toEqual([[ALLY]]);
  });

  it("places the viewer's buildingless nation by its people, but no other nation", () => {
    const { map, state, plaques, pins, stripPlaques } = mount(
      [OWN_NATION, FOE_NATION],
      [person(1, VIEWER, MID - 1, MID), person(2, VIEWER, MID + 1, MID), person(3, FOE, 1, 1)],
    );
    state.layout = zoomedOn(MID, MID);
    map.open();
    expect(plaques().map(nameOn)).toEqual([OWN_NATION.name]);
    expect(pinX(pins()[0])).toBeCloseTo(HOLE_CENTRE_X);
    expect(stripPlaques().map(nameOn)).toEqual([FOE_NATION.name]);
  });

  it('hides a plaque and its pin while the zoomed map holds its settlement out of view', () => {
    const NEAR_CORNER = 2;
    const { map, state, plaques, pins } = mount([ALLY_NATION], [hut(1, ALLY, NEAR_CORNER, NEAR_CORNER)]);
    map.open();
    expect(plaques()[0]?.hidden).toBe(false);

    state.layout = zoomedOn(MAP_CELLS, MAP_CELLS, FULL_ZOOM);
    map.refresh();
    expect(plaques()[0]?.hidden).toBe(true);
    expect(pins()[0]?.hidden).toBe(true);

    state.layout = WHOLE_MAP;
    map.refresh();
    expect(plaques()[0]?.hidden).toBe(false);
    expect(pins()[0]?.hidden).toBe(false);
  });

  it('shuts on the next refresh once it is unavailable, without reading', () => {
    const { map, state, minimap, nations } = mount([OWN_NATION]);
    map.open();
    state.unavailable = true;
    state.clock = READ_INTERVAL_MS;
    map.refresh();
    expect(map.isOpen()).toBe(false);
    expect(minimap.setOverview).toHaveBeenLastCalledWith(false);
    expect(minimap.focusOverviewButton).not.toHaveBeenCalled();
    expect(nations).toHaveBeenCalledOnce();
  });

  it('stays shut when asked to open while unavailable, leaving the minimap alone', () => {
    const { map, state, minimap, nations } = mount([OWN_NATION]);
    state.unavailable = true;
    map.open();
    expect(map.isOpen()).toBe(false);
    expect(minimap.setOverview).not.toHaveBeenCalled();
    expect(nations).not.toHaveBeenCalled();
  });

  it('sounds the refusal when a toggle cannot open it, and the confirmation when it can', () => {
    const { map, state, cue } = mount([OWN_NATION]);
    state.unavailable = true;
    map.toggle();
    expect(cue).toHaveBeenLastCalledWith('fail');
    expect(map.isOpen()).toBe(false);
    state.unavailable = false;
    map.toggle();
    expect(cue).toHaveBeenLastCalledWith('confirm');
    expect(map.isOpen()).toBe(true);
  });

  it('stands the plaques anew on a new layout object, without a read', () => {
    const { map, state, nations, pins } = mount([ALLY_NATION], [hut(1, ALLY, MID, MID)]);
    map.open();
    expect(pinX(pins()[0])).not.toBeCloseTo(HOLE_CENTRE_X);

    state.layout = zoomedOn(MID, MID);
    map.refresh();
    expect(pinX(pins()[0])).toBeCloseTo(HOLE_CENTRE_X);
    expect(nations).toHaveBeenCalledOnce();
  });
});
