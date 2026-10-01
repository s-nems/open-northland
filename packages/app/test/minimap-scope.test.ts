import { terrainWorldBounds } from '@open-northland/render';
import { type DiplomacyState, fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { forEachMinimapDot, scopeAdmits } from '../src/hud/minimap/dots.js';
import {
  DEFAULT_MINIMAP_FILTERS,
  type MinimapScope,
  withAllMinimapLayers,
} from '../src/hud/minimap/filters.js';
import type { MinimapMark } from '../src/hud/minimap/stamps.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

const VIEWER = 0;
const FRIEND = 1;
const NEUTRAL = 2;
const FOE = 3;
const STANCES: Readonly<Record<number, DiplomacyState>> = {
  [FRIEND]: 'friend',
  [NEUTRAL]: 'neutral',
  [FOE]: 'enemy',
};
const stanceToward = (owner: number): DiplomacyState => STANCES[owner] ?? 'neutral';

describe('scopeAdmits', () => {
  it.each<[MinimapScope, readonly number[]]>([
    ['everyone', [VIEWER, FRIEND, NEUTRAL, FOE]],
    ['mine', [VIEWER]],
    ['friendly', [FRIEND]],
    ['hostile', [FOE]],
  ])('%s shows the owners %j', (scope, shown) => {
    const admitted = [VIEWER, FRIEND, NEUTRAL, FOE].filter((owner) =>
      scopeAdmits(scope, owner, VIEWER, stanceToward),
    );
    expect(admitted).toEqual(shown);
  });

  it('shows every owner on a whole-map view, which has no seat to judge from', () => {
    for (const scope of ['mine', 'friendly', 'hostile'] as const) {
      expect([VIEWER, FRIEND, FOE].every((owner) => scopeAdmits(scope, owner, null, stanceToward))).toBe(
        true,
      );
    }
  });

  it("reads the viewer's own stance, not the other seat's", () => {
    const asked: [number][] = [];
    scopeAdmits('hostile', FOE, VIEWER, (owner) => {
      asked.push([owner]);
      return 'enemy';
    });
    expect(asked).toEqual([[FOE]]);
  });
});

describe('the owner scope on the plot', () => {
  const at = (x: number) => ({ Position: { x: fx.fromInt(x), y: fx.fromInt(1) } });
  const world: Ent[] = [
    {
      id: 1,
      components: { Settler: { jobType: 7 }, Person: { person: true }, Owner: { player: VIEWER }, ...at(1) },
    },
    { id: 2, components: { Building: {}, Owner: { player: FOE }, ...at(2) } },
    { id: 3, components: { Settler: { jobType: 0 }, ...at(3) } }, // wildlife
    { id: 4, components: { Settler: { jobType: 0 }, Livestock: {}, Owner: { player: FOE }, ...at(4) } },
    { id: 5, components: { RoadSite: {}, Owner: { player: FOE }, ...at(6) } },
    { id: 6, components: { Vehicle: { carrier: null }, Owner: { player: FRIEND }, ...at(5) } },
  ];
  const marksUnder = (scope: MinimapScope): MinimapMark[] => {
    const marks: MinimapMark[] = [];
    forEachMinimapDot(
      snapshotOf(world),
      {
        fog: null,
        bounds: terrainWorldBounds(8, 8),
        scale: 1,
        filters: { ...withAllMinimapLayers(DEFAULT_MINIMAP_FILTERS, true), scope },
        isFighterJob: () => false,
        viewer: VIEWER,
        stanceToward,
      },
      (_x, _y, mark, _colour, part) => {
        if (part === 'fills') marks.push(mark);
      },
    );
    return marks;
  };

  it('keeps wild animals under every scope and filters owned markers, road sites included', () => {
    expect(marksUnder('everyone')).toEqual([
      'roadSite',
      'building',
      'civilian',
      'animal',
      'animal',
      'vehicle',
    ]);
    expect(marksUnder('mine')).toEqual(['civilian', 'animal']);
    expect(marksUnder('friendly')).toEqual(['animal', 'vehicle']);
    expect(marksUnder('hostile')).toEqual(['roadSite', 'building', 'animal', 'animal']);
  });
});
