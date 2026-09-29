import {
  halfCellMapFromCells,
  playerCommand,
  roadShardKey,
  Simulation,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import { resolveWorldContent } from '../src/game/sandbox/index.js';
import { roadBuiltAt } from '../src/view/runtime/road-nodes.js';

const MAP_W = 40;
const MAP_H = 12;
/** The map's width in half-cell nodes. */
const NODE_W = 2 * MAP_W;
const VIKING = 1;
const SITE = { hx: 8, hy: 4 };
/** A laid road in the second road shard's block, 64 nodes wide. */
const ROAD = { hx: 70, hy: 6 };

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

  it('reads a laid road from the shard of its block, and nothing beside it', () => {
    const shard = {
      block: roadShardKey(ROAD.hx, ROAD.hy),
      nodes: [ROAD.hy * NODE_W + ROAD.hx],
      revision: 1,
    };
    const snapshot: WorldSnapshot = {
      tick: 0,
      entities: [{ id: 1, components: { RoadShard: shard } }],
      events: [],
    };
    expect(roadBuiltAt(snapshot, NODE_W, ROAD.hx, ROAD.hy)).toBe(true);
    expect(roadBuiltAt(snapshot, NODE_W, ROAD.hx - 1, ROAD.hy)).toBe(false);
    expect(roadBuiltAt(snapshot, NODE_W, SITE.hx, SITE.hy)).toBe(false);
  });
});
