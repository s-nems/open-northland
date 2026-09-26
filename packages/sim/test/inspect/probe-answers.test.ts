import { describe, expect, it } from 'vitest';
import { Position, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  type NodeArea,
  type NodeGridAnswer,
  nodeGridAccepts,
  positionOfNode,
  type ScriptLandscapeType,
  Simulation,
} from '../../src/index.js';
import { CONTESTED_GROUND_RADIUS_NODES } from '../../src/systems/conflict/contested-ground.js';
import { createSignpost } from '../../src/systems/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import {
  buildingsPlaced,
  grassMap,
  HUT,
  mappedSim,
  terrainOf,
  VIKING,
} from '../footprint/building-placement/support.js';

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

/** Answers asked the way the app asks them: 32-node squares tiling the map, each against the live
 *  probes, with a hostile fighter and signposts beside the squares' edges. */
const AREA_NODES = 32;
const SEAT = 2;
const FOE = 3;
const SPEARMAN = 32;
const HQ_TYPE = 1;
const FIELD = { width: 96, height: 64 };
/** One node short of the first square's east edge, so his radius reaches into the next square. */
const RAIDER_AT = { x: AREA_NODES - 2, y: 12 };
/** Two posts across the edge between the first two squares: a square's spacing reaches past its edge. */
const EDGE_POSTS = [
  { x: AREA_NODES + 1, y: 40 },
  { x: AREA_NODES - 3, y: 6 },
];

function raidedField(): { sim: Simulation; raider: Entity } {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(FIELD.width, FIELD.height) });
  const terrain = terrainOf(sim);
  for (const post of EDGE_POSTS) createSignpost(sim.world, terrain, terrain.nodeAt(post.x, post.y), SEAT);
  const before = new Set(sim.world.query(Settler));
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: SPEARMAN,
    x: RAIDER_AT.x,
    y: RAIDER_AT.y,
    tribe: VIKING,
    owner: FOE,
  });
  sim.step();
  const raider = [...sim.world.query(Settler)].find((e) => !before.has(e));
  if (raider === undefined) throw new Error('setup: no raider spawned');
  return { sim, raider };
}

function tiles(): NodeArea[] {
  const areas: NodeArea[] = [];
  for (let minHy = 0; minHy < FIELD.height; minHy += AREA_NODES) {
    for (let minHx = 0; minHx < FIELD.width; minHx += AREA_NODES) {
      areas.push({ minHx, minHy, maxHx: minHx + AREA_NODES - 1, maxHy: minHy + AREA_NODES - 1 });
    }
  }
  return areas;
}

describe('probe answer keys', () => {
  it('hold across a blocker change far from the area and move with one near it', () => {
    const sim = mappedSim(grassMap(48, 16));
    const area: NodeArea = { minHx: 0, minHy: 0, maxHx: 7, maxHy: 7 };
    const before = sim.placementAnswer(HUT, area, P0)?.key;
    const far = { x: 80, y: 20 };
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HUT,
      x: far.x,
      y: far.y,
      tribe: VIKING,
      owner: P1,
    });
    sim.step();
    expect(buildingsPlaced(sim)).toBe(1);
    expect(sim.placementAnswer(HUT, area, P0)?.key).toBe(before);
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 12, y: 12, tribe: VIKING, owner: P1 });
    sim.step();
    const near = sim.placementAnswer(HUT, area, P0);
    expect(near?.key).not.toBe(before);
    const live = sim.placementProbe(HUT, P0);
    if (live === null) throw new Error('no probe');
    expect(disagreements(near ?? null, (hx, hy) => live.canPlace(hx, hy))).toEqual([]);
    expect(near?.accepted.some((node) => node === 0)).toBe(true);
  });
});

describe('probe answers over tiled areas', () => {
  it('match the live probes square by square beside a hostile fighter and edge signposts', () => {
    const { sim } = raidedField();
    const building = sim.placementProbe(HQ_TYPE, SEAT);
    const signpost = sim.signpostProbe(SEAT);
    if (building === null || signpost === null) throw new Error('no probe');
    let contested = 0;
    let spaced = 0;
    for (const area of tiles()) {
      const answer = sim.placementAnswer(HQ_TYPE, area, SEAT);
      expect(disagreements(answer, (hx, hy) => building.canPlace(hx, hy))).toEqual([]);
      contested += answer?.accepted.filter((node) => node === 0).length ?? 0;
      const posts = sim.signpostAnswer(SEAT, area);
      expect(disagreements(posts, (hx, hy) => signpost.canPlace(hx, hy))).toEqual([]);
      spaced += posts?.accepted.filter((node) => node === 0).length ?? 0;
    }
    // The premises: the raider refuses ground in both squares his radius reaches, the posts in theirs.
    const second = { minHx: AREA_NODES, minHy: 0, maxHx: 2 * AREA_NODES - 1, maxHy: AREA_NODES - 1 };
    expect(sim.placementAnswer(HQ_TYPE, second, SEAT)?.accepted[RAIDER_AT.y * AREA_NODES]).toBe(0);
    expect(contested).toBeGreaterThan(0);
    expect(spaced).toBeGreaterThan(0);
  });

  it('answer the technology gate as the live probe does', () => {
    const { sim } = raidedField();
    const live = sim.placementProbe(HQ_TYPE, SEAT, VIKING);
    if (live === null) throw new Error('no probe');
    for (const area of tiles()) {
      expect(
        disagreements(sim.placementAnswer(HQ_TYPE, area, SEAT, VIKING), (hx, hy) => live.canPlace(hx, hy)),
      ).toEqual([]);
    }
  });

  it('change the key when a fighter outside the square but within reach of it moves', () => {
    const { sim, raider } = raidedField();
    const second = { minHx: AREA_NODES, minHy: 0, maxHx: 2 * AREA_NODES - 1, maxHy: AREA_NODES - 1 };
    const before = sim.placementAnswer(HQ_TYPE, second, SEAT)?.key;
    Object.assign(sim.world.mut(raider, Position), positionOfNode(RAIDER_AT.x - 1, RAIDER_AT.y));
    const moved = sim.placementAnswer(HQ_TYPE, second, SEAT);
    expect(RAIDER_AT.x - 1 + CONTESTED_GROUND_RADIUS_NODES).toBeGreaterThanOrEqual(second.minHx);
    expect(moved?.key).not.toBe(before);
    const live = sim.placementProbe(HQ_TYPE, SEAT);
    if (live === null) throw new Error('no probe');
    expect(disagreements(moved, (hx, hy) => live.canPlace(hx, hy))).toEqual([]);
  });
});
