import { describe, expect, it } from 'vitest';
import {
  type NodeArea,
  type NodeGridAnswer,
  nodeGridAccepts,
  type ScriptLandscapeType,
  type Simulation,
} from '../../src/index.js';
import { createSignpost } from '../../src/systems/index.js';
import { grassMap, HUT, mappedSim, terrainOf, VIKING } from '../footprint/building-placement/support.js';

/** Each probe's plain-data answer must match its live probe on every node it covers. */

const P0 = 0;
const P1 = 1;
/** Nodes past the map edge the answers are asked over too, where the live probes still answer. */
const EDGE_MARGIN = 2;
const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: { maxHitpoints: 100, repairPerStrike: 3, construction: [{ goodType: 5, amount: 1 }] },
};
const HUT_AT = { x: 10, y: 10 };
const OWN_POST = { x: 20, y: 18 };
const RIVAL_POST = { x: 6, y: 24 };
const WALL_AT = { x: 24, y: 8 };

function settledWorld(): Simulation {
  const sim = mappedSim({ ...grassMap(16, 16), landscapes: { types: [WALL], placements: [] } });
  const terrain = terrainOf(sim);
  createSignpost(sim.world, terrain, terrain.nodeAt(OWN_POST.x, OWN_POST.y), P0);
  createSignpost(sim.world, terrain, terrain.nodeAt(RIVAL_POST.x, RIVAL_POST.y), P1);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HUT,
    x: HUT_AT.x,
    y: HUT_AT.y,
    tribe: VIKING,
    owner: P1,
  });
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: WALL.typeId,
    x: WALL_AT.x,
    y: WALL_AT.y,
    tribe: VIKING,
  });
  sim.step();
  return sim;
}

function wholeMap(sim: Simulation): NodeArea {
  const terrain = terrainOf(sim);
  return {
    minHx: -EDGE_MARGIN,
    minHy: -EDGE_MARGIN,
    maxHx: terrain.width - 1 + EDGE_MARGIN,
    maxHy: terrain.height - 1 + EDGE_MARGIN,
  };
}

/** The nodes where the answer and the live probe part, empty when they agree everywhere. */
function disagreements(answer: NodeGridAnswer | null, live: (hx: number, hy: number) => boolean): string[] {
  if (answer === null) throw new Error('no answer');
  const { area } = answer;
  const parted: string[] = [];
  for (let hy = area.minHy; hy <= area.maxHy; hy++) {
    for (let hx = area.minHx; hx <= area.maxHx; hx++) {
      if (nodeGridAccepts(answer, hx, hy) !== live(hx, hy)) parted.push(`${hx},${hy}`);
    }
  }
  return parted;
}

describe('probe answers', () => {
  it('answer the building rule as the live probe does, with and without a seat and its tribe', () => {
    const sim = settledWorld();
    const area = wholeMap(sim);
    for (const [player, tribe] of [
      [undefined, undefined],
      [P0, undefined],
      [P0, VIKING],
      [P1, VIKING],
    ] as const) {
      const live = sim.placementProbe(HUT, player, tribe);
      if (live === null) throw new Error('no probe');
      const answer = sim.placementAnswer(HUT, area, player, tribe);
      expect(disagreements(answer, (hx, hy) => live.canPlace(hx, hy))).toEqual([]);
      expect(answer?.accepted.some((node) => node === 1)).toBe(true);
      expect(answer?.accepted.some((node) => node === 0)).toBe(true);
    }
  });

  it('answer the signpost and wall rules as the live probes do', () => {
    const sim = settledWorld();
    const area = wholeMap(sim);
    for (const player of [P0, P1]) {
      const live = sim.signpostProbe(player);
      if (live === null) throw new Error('no probe');
      expect(disagreements(sim.signpostAnswer(player, area), (hx, hy) => live.canPlace(hx, hy))).toEqual([]);
    }
    const wall = sim.palisadeProbe(WALL.typeId);
    if (wall === null) throw new Error('no probe');
    expect(disagreements(sim.palisadeAnswer(WALL.typeId, area), (hx, hy) => wall.canPlace(hx, hy))).toEqual(
      [],
    );
  });

  it('keep an answer key until a blocker changes', () => {
    const sim = settledWorld();
    const area: NodeArea = { minHx: 0, minHy: 0, maxHx: 7, maxHy: 7 };
    const before = sim.placementAnswer(HUT, area, P0)?.key;
    expect(sim.placementAnswer(HUT, area, P0)?.key).toBe(before);
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 24, y: 24, tribe: VIKING, owner: P0 });
    sim.step();
    expect(sim.placementAnswer(HUT, area, P0)?.key).not.toBe(before);
  });
});
