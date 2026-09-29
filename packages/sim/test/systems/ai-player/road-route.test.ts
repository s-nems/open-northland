import { describe, expect, it } from 'vitest';
import { buildTerrainGraph } from '../../../src/index.js';
import { hexDistanceBetween } from '../../../src/nav/halfcell.js';
import { ROAD_ROUTE_MAX_EXPLORED, roadRouteBudget } from '../../../src/systems/ai-player/road-build.js';
import { roadRoute } from '../../../src/systems/ai-player/road-route.js';
import { testContent } from '../../fixtures/content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

const SIDE = 200;
const LAID_STEP = 1;
const OPEN_STEP = 2;
const FROM = { hx: 20, hy: 20 };
// A far diagonal over open ground: the kind of link an outlying building or busy way asks for.
const TO = { hx: 90, hy: 90 };

describe('AI road route', () => {
  it('reaches a far node over open ground within its distance budget', () => {
    const terrain = buildTerrainGraph(testContent(), grassNodeMap(SIDE, SIDE));
    const from = terrain.nodeAt(FROM.hx, FROM.hy);
    const to = terrain.nodeAt(TO.hx, TO.hy);
    const distance = hexDistanceBetween(FROM.hx, FROM.hy, TO.hx, TO.hy);
    const route = roadRoute(terrain, from, to, () => OPEN_STEP, LAID_STEP, roadRouteBudget(distance));
    expect(route?.length).toBe(distance + 1);
    expect(roadRouteBudget(1)).toBe(ROAD_ROUTE_MAX_EXPLORED);
  });
});
