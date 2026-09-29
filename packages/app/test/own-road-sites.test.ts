import { halfCellMapFromCells, playerCommand, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import { resolveWorldContent } from '../src/game/sandbox/index.js';
import { ownRoadSiteAt } from '../src/view/runtime/own-road-sites.js';

const MAP_W = 24;
const MAP_H = 12;
const VIKING = 1;
const OTHER_PLAYER = HUMAN_PLAYER + 1;
const SITE = { hx: 8, hy: 4 };

describe('ownRoadSiteAt', () => {
  it("names the seat's road site on a node, and nothing beside it or for another seat", () => {
    const terrain = grassTerrain(MAP_W, MAP_H);
    const sim = new Simulation({
      seed: 1,
      content: resolveWorldContent(terrain, {}),
      map: halfCellMapFromCells(terrain),
    });
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: HUMAN_PLAYER, tribes: [VIKING] });
    sim.step();
    expect(ownRoadSiteAt(sim.snapshot(), HUMAN_PLAYER, SITE.hx, SITE.hy)).toBeNull();

    sim.enqueue(
      playerCommand(HUMAN_PLAYER, { kind: 'placeRoadSite', x: SITE.hx, y: SITE.hy, tribe: VIKING }),
    );
    sim.step();
    const snapshot = sim.snapshot();
    const site = ownRoadSiteAt(snapshot, HUMAN_PLAYER, SITE.hx, SITE.hy);
    expect(site).not.toBeNull();
    expect(snapshot.entities.find((e) => e.id === site)?.components.RoadSite).toBeDefined();
    expect(ownRoadSiteAt(snapshot, HUMAN_PLAYER, SITE.hx + 1, SITE.hy)).toBeNull();
    expect(ownRoadSiteAt(snapshot, OTHER_PLAYER, SITE.hx, SITE.hy)).toBeNull();
    expect(ownRoadSiteAt(snapshot, HUMAN_PLAYER, -1, SITE.hy)).toBeNull();
  });
});
