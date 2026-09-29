import { halfCellMapFromCells, playerCommand, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import { resolveWorldContent } from '../src/game/sandbox/index.js';
import { roadBuiltAt } from '../src/view/runtime/road-nodes.js';

const MAP_W = 24;
const MAP_H = 12;
/** The map's width in half-cell nodes. */
const NODE_W = 2 * MAP_W;
const VIKING = 1;
const SITE = { hx: 8, hy: 4 };

describe('roadBuiltAt', () => {
  it('reads a road site placed after an earlier snapshot, and nothing beside it or off the map', () => {
    const terrain = grassTerrain(MAP_W, MAP_H);
    const sim = new Simulation({
      seed: 1,
      content: resolveWorldContent(terrain, {}),
      map: halfCellMapFromCells(terrain),
    });
    sim.enqueueSetup({
      kind: 'setPlayerPlacementTribes',
      player: HUMAN_PLAYER,
      tribes: [VIKING],
    });
    sim.step();
    expect(roadBuiltAt(sim.snapshot(), NODE_W, SITE.hx, SITE.hy)).toBe(false);

    sim.enqueue(
      playerCommand(HUMAN_PLAYER, {
        kind: 'placeRoadSite',
        x: SITE.hx,
        y: SITE.hy,
        tribe: VIKING,
      }),
    );
    sim.step();
    const snapshot = sim.snapshot();
    expect(roadBuiltAt(snapshot, NODE_W, SITE.hx, SITE.hy)).toBe(true);
    expect(roadBuiltAt(snapshot, NODE_W, SITE.hx + 1, SITE.hy)).toBe(false);
    expect(roadBuiltAt(snapshot, NODE_W, SITE.hx + NODE_W, SITE.hy - 1)).toBe(false);
  });
});
