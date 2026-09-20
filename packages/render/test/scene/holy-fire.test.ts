import { ONE, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { collectSpriteScene, type HolyFireLookup, holyFireOverlays } from '../../src/data/scene/index.js';

const HOME = 7;
const components = {
  Building: { buildingType: 4, tribe: 1, level: 2, built: ONE },
  Owner: { player: 0 },
  Position: { x: 10 * ONE, y: 10 * ONE },
  HomeQuality: { cooking: 0, rest: 0, piety: 40 },
};
const lookup: HolyFireLookup = (tribe, typeId, level) =>
  tribe === 1 && typeId === 4 && level === 2
    ? { name: 'fx fire incense', points: [{ x: -80, y: 24 }] }
    : undefined;

const snapshot = (
  home: Readonly<Record<string, unknown>> = components,
  policy: { cooking: boolean; rest: boolean; piety: boolean } | null = null,
): WorldSnapshot => ({
  tick: 0,
  events: [],
  entities: [
    { id: HOME, components: home },
    ...(policy === null ? [] : [{ id: 99, components: { HouseholdGoodPolicy: { player: 0, ...policy } } }]),
  ],
});

describe('home holy fire projection', () => {
  it('stages the source-bound loop only for a finished eligible home with live enabled oil', () => {
    expect(holyFireOverlays(snapshot(), HOME, components, lookup)).toEqual([
      { name: 'fx fire incense', dx: -80, dy: 24 },
    ]);
    expect(
      holyFireOverlays(
        snapshot(components, { cooking: true, rest: true, piety: false }),
        HOME,
        components,
        lookup,
      ),
    ).toEqual([]);
    const empty = {
      ...components,
      HomeQuality: { cooking: 0, rest: 0, piety: 0 },
    };
    expect(holyFireOverlays(snapshot(empty), HOME, empty, lookup)).toEqual([]);
    const site = { ...components, UnderConstruction: { labor: 0 } };
    expect(holyFireOverlays(snapshot(site), HOME, site, lookup)).toEqual([]);
    expect(holyFireOverlays(snapshot(), HOME, components, () => undefined)).toEqual([]);
  });

  it('emits retained effect refs only while the home survives the existing viewport cull', () => {
    const visible = collectSpriteScene(snapshot(), { holyFire: lookup });
    const building = visible.items.find((item) => item.kind === 'building');
    const fire = visible.items.find((item) => item.kind === 'craftfx');
    if (building === undefined || fire === undefined) throw new Error('expected home and holy fire');
    expect(fire).toMatchObject({ fxName: 'fx fire incense', x: building.x - 80, y: building.y + 24 });
    expect(fire === undefined ? false : visible.liveRefs.has(fire.ref)).toBe(true);

    const culled = collectSpriteScene(snapshot(), {
      holyFire: lookup,
      viewport: { minX: 10_000, maxX: 10_100, minY: 10_000, maxY: 10_100 },
    });
    expect(culled.items).toEqual([]);
  });
});
