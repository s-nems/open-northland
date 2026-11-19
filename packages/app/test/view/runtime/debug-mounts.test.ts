// @vitest-environment jsdom
import { BUILDING_KIND } from '@open-northland/data';
import { afterEach, expect, it, vi } from 'vitest';
import { FRANK } from '../../../src/catalog/civilizations.js';
import { WONDER_TRIBE } from '../../../src/catalog/wonders.js';
import { PRIMARY_TRIBE } from '../../../src/game/rules.js';
import type { StandingStructure } from '../../../src/hud/tool-panel/placement.js';
import { type DebugMountsOptions, mountDebugOverlays } from '../../../src/view/runtime/debug-mounts.js';

afterEach(() => {
  document.body.replaceChildren();
});

function mounts(allowWorldEdits: boolean, content: { buildings?: unknown[]; buildingBobs?: unknown[] } = {}) {
  const plane = document.createElement('div');
  const barLead = document.createElement('div');
  document.body.append(plane, barLead);
  const cancelStanding = vi.fn();
  const enterStanding = vi.fn((_structure: StandingStructure, _owner: number, _tribe: number) => true);
  const opts = {
    canvas: document.createElement('canvas'),
    params: new URLSearchParams(),
    plane,
    barLead,
    initialToolsEnabled: true,
    allowWorldEdits,
    host: {
      content: {
        goods: [],
        animals: [],
        tribes: [],
        vehicles: [],
        armor: [],
        buildings: content.buildings ?? [],
        buildingBobs: content.buildingBobs ?? [],
        jobExperience: [],
      },
      needsEnabled: () => true,
      fogMode: () => 0,
      snapshot: () => ({ tick: 0, entities: [] }),
    },
    renderer: { setGeometryDebug: () => undefined },
    cameraCtl: { setZoomOutUnlocked: () => undefined },
    clientToTile: () => null,
    claimPointer: () => false,
    goodLabel: () => undefined,
    seatTribeOf: () => 0,
    cancelStanding,
    enterStanding,
  } as unknown as DebugMountsOptions;
  return { debug: mountDebugOverlays(opts), plane, barLead, cancelStanding, enterStanding };
}

it('stands the tools toggle in the bar and hides it with the HUD or the setting', () => {
  const { debug, plane, barLead } = mounts(true);
  const toggle = barLead.querySelector<HTMLButtonElement>('.on-admin-toggle');
  const panel = plane.querySelector<HTMLElement>('.on-admin');
  expect(toggle?.hidden).toBe(false);
  expect(panel?.hidden).toBe(true);

  toggle?.click();
  expect(panel?.hidden).toBe(false);

  debug.setHudHidden(true);
  expect(toggle?.hidden).toBe(true);
  expect(panel?.hidden).toBe(true);
  debug.setToolsEnabled(false);
  debug.setToolsEnabled(true);
  expect(toggle?.hidden).toBe(true);
  debug.setHudHidden(false);
  expect(toggle?.hidden).toBe(false);

  debug.setToolsEnabled(false);
  debug.setHudHidden(true);
  debug.setHudHidden(false);
  expect(toggle?.hidden).toBe(true);

  debug.dispose();
  expect(barLead.childElementCount).toBe(0);
  expect(plane.querySelector('.on-admin')).toBeNull();
});

it('drops a finished structure held for placement as the tools are switched off', () => {
  const { debug, cancelStanding } = mounts(true);
  debug.setHudHidden(true);
  expect(cancelStanding).not.toHaveBeenCalled();
  debug.setToolsEnabled(false);
  expect(cancelStanding).toHaveBeenCalledTimes(1);
  debug.dispose();
});

it('mounts no tools where world edits are off', () => {
  const { debug, plane, barLead } = mounts(false);
  expect(barLead.childElementCount).toBe(0);
  expect(plane.childElementCount).toBe(0);
  debug.dispose();
});

it("offers each building with every tribe's record at its top level, by ascending tribe", () => {
  const WONDER = 900;
  const HALL = 901;
  const SHIP = 902;
  const FOOTPRINT = { cells: [] };
  const bob = (typeId: number, tribeId: number, level: number) => ({ typeId, tribeId, level });
  const { debug, plane, enterStanding } = mounts(true, {
    buildings: [
      { typeId: WONDER, id: 'test_wonder', kind: BUILDING_KIND.wonder, footprint: FOOTPRINT },
      { typeId: HALL, id: 'test_hall', kind: BUILDING_KIND.workplace, footprint: FOOTPRINT },
      { typeId: SHIP, id: 'test_ship', kind: BUILDING_KIND.vehicle, footprint: FOOTPRINT },
    ],
    buildingBobs: [
      bob(WONDER, WONDER_TRIBE, 1),
      bob(WONDER, WONDER_TRIBE, 3),
      bob(WONDER, WONDER_TRIBE, 0),
      bob(HALL, FRANK, 1),
      bob(HALL, PRIMARY_TRIBE, 0),
      bob(SHIP, PRIMARY_TRIBE, 0),
    ],
  });
  const tiles = [...plane.querySelectorAll<HTMLElement>('.on-admin__tile')];
  const tileOf = (label: string) => tiles.find((t) => t.textContent?.includes(label));
  // A vehicle's workshop site has no body to stand.
  expect(tileOf('test_ship')).toBeUndefined();
  tileOf('test_wonder')?.click();
  tileOf('test_hall')?.click();
  expect(enterStanding.mock.calls.map(([structure]) => structure)).toEqual([
    { kind: 'building', typeId: WONDER, records: [{ tribe: WONDER_TRIBE, topLevel: 3 }] },
    {
      kind: 'building',
      typeId: HALL,
      records: [
        { tribe: PRIMARY_TRIBE, topLevel: 0 },
        { tribe: FRANK, topLevel: 1 },
      ],
    },
  ]);
  debug.dispose();
});
