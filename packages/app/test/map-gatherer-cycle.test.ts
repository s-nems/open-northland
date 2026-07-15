import type { TerrainMapFile } from '@open-northland/data';
import { components, halfCellMapFromCells, Simulation, systems, type TerrainMap } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../src/catalog/felling.js';
import { TERRAIN_OPEN } from '../src/catalog/terrain.js';
import { buildCollisionTerrain } from '../src/content/collision.js';
import type { ContentIr } from '../src/content/ir.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { sandboxContent } from '../src/game/sandbox/content/index.js';
import { GOOD_WOOD, JOB_COLLECTOR } from '../src/game/sandbox/ids/index.js';
import { mapResourceObjectNames } from '../src/game/sandbox/map-spawn.js';
import { GATHERER_WORK_RADIUS } from '../src/game/sandbox/place.js';

/**
 * The REAL-map gathering cycle end-to-end over the ACTUAL map content (`sandboxContent` — the exact
 * ContentSet `?map=` runs, with footprinted trees), in real-map density: a command-spawned wood
 * gatherer (flag auto-planted at its feet) inside a DENSE tree cluster must complete the full
 * fell → pick up the trunk → bank at the flag loop. Regression net for the reported "zbieracz ściął
 * drzewo, kłoda leży, a on stoi i nic nie robi" — a cycle stall shows up here as wood never reaching
 * the flag heaps (the trunk left lying).
 *
 * The second test runs the SAME cycle over a collision grid built by the REAL map join
 * (`buildCollisionTerrain`) with tree placements — the exact double-blocking that stalled the live
 * map: baked-static tree cells never unblock when the tree falls, so the trunk lying there was
 * unreachable forever. `skipObjectNames` (the fix) leaves harvestables to their dynamic footprints.
 */

const { GroundDrop, Stockpile, WorkFlag } = components;

/** An all-grass CELL map (the sim runs its 2× half-cell lattice). */
function grassMap(cells: number) {
  return halfCellMapFromCells({
    width: cells,
    height: cells,
    typeIds: new Array(cells * cells).fill(TERRAIN_OPEN),
  });
}

/** A footprinted map-style tree (the exact spec `spawnMapResources` builds) at half-cell (hx, hy). */
function mapTree(sim: Simulation, hx: number, hy: number): void {
  const e = systems.createResourceNode(sim.world, sim.content, {
    good: GOOD_WOOD,
    x: hx,
    y: hy,
    remaining: WOOD_YIELD_PER_NODE,
    harvestAtomic: sandboxContent().goods.find((g) => g.id === 'wood')?.atomics.harvest ?? 24,
    felling: { chopsLeft: WOOD_CHOPS_TO_FELL },
  });
  expect(e).not.toBeNull();
}

/** Total wood lying in loose ground drops (an unfinished cycle leaves the trunk here). */
function looseWood(sim: Simulation): number {
  let sum = 0;
  for (const e of sim.world.query(GroundDrop, Stockpile)) {
    sum += sim.world.get(e, Stockpile).amounts.get(GOOD_WOOD) ?? 0;
  }
  return sum;
}

/** Total wood banked in NON-drop stockpiles (the flag-side heaps a finished cycle produces). */
function bankedWood(sim: Simulation): number {
  let sum = 0;
  for (const e of sim.world.query(Stockpile)) {
    if (sim.world.has(e, GroundDrop)) continue;
    sum += sim.world.get(e, Stockpile).amounts.get(GOOD_WOOD) ?? 0;
  }
  return sum;
}

describe('map-style gathering cycle (sandbox content, footprinted trees, dense forest)', () => {
  it('fells, picks the trunk up and banks it at the flag — never leaves the kłoda lying', () => {
    const sim = new Simulation({ seed: 11, content: sandboxContent(), map: grassMap(40) });
    // A command-spawned gatherer — the map path: the spawn handler plants its work flag at its feet.
    sim.enqueue({
      kind: 'spawnSettler',
      jobType: JOB_COLLECTOR,
      x: 40,
      y: 40,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
    });
    sim.step();
    const gatherer = [...sim.world.query(WorkFlag)][0];
    expect(gatherer).toBeDefined();

    // A dense map-like cluster: trees every 2 nodes in a 5×5 patch beside the gatherer — inside the
    // flag radius, footprints overlapping work cells the way a real forest packs them.
    for (let ty = 34; ty <= 42; ty += 2) {
      for (let tx = 44; tx <= 52; tx += 2) {
        mapTree(sim, tx, ty);
      }
    }
    expect(GATHERER_WORK_RADIUS).toBeGreaterThanOrEqual(12); // the cluster sits within the flag radius

    // Plenty of time for several full cycles (chop ×N, fall, walk, pick up, carry home).
    for (let t = 0; t < 3000; t++) sim.step();

    // At least one full cycle landed: wood banked at the flag...
    expect(bankedWood(sim)).toBeGreaterThan(0);
    // ...and no trunk left lying around long-term (the reported stall: felled wood abandoned on the
    // ground while the gatherer idles). A trunk mid-carry is fine; after 3000 ticks with one gatherer
    // and a near flag, everything felled so far must have been banked or be the one active carry.
    expect(looseWood(sim)).toBeLessThanOrEqual(WOOD_YIELD_PER_NODE);
  });

  it('completes the cycle over the REAL collision join — a felled tree must unblock its cell', () => {
    // A synthetic decoded-map file: 40×40 open ground, a 5×5 tree cluster in the objects lane (the
    // lane the STATIC collision join stamps) — the exact shape the live map stalls on.
    const treeName = 'cycle tree';
    const placements: number[] = [];
    for (let hy = 34; hy <= 42; hy += 2) {
      for (let hx = 44; hx <= 52; hx += 2) placements.push(hx, hy, 0);
    }
    const mapFile: TerrainMapFile = {
      width: 40,
      height: 40,
      typeIds: new Array(40 * 40).fill(0),
      objects: { types: [treeName], placements },
    };
    // The collision view: the tree blocks its own node (walk) — enough to reproduce the wall.
    const ir: ContentIr = {
      landscapeGfx: [{ index: 900, editName: treeName, logicType: 4, walkBlockAreas: [[1, 0, 0, 1]] }],
      gatheringPipeline: [{ goodType: 5, goodId: 'wood', harvest: { landscapeType: 4, gfxIndices: [900] } }],
    };
    // THE FIX under test: harvestable placements are skipped from the static grid (their blocking is
    // the dynamic resource footprint, unstamped on fell). Without the skip the felled tree's cell
    // stays TERRAIN_BLOCKED forever and the trunk lying there is unreachable — the reported stall.
    const grid: TerrainMap = buildCollisionTerrain(mapFile, ir, mapResourceObjectNames(ir));
    const sim = new Simulation({ seed: 12, content: sandboxContent(), map: grid });
    sim.enqueue({
      kind: 'spawnSettler',
      jobType: JOB_COLLECTOR,
      x: 40,
      y: 40,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
    });
    sim.step();
    // The same trees as REAL entities (what spawnMapResources does for these placements).
    for (let hy = 34; hy <= 42; hy += 2) {
      for (let hx = 44; hx <= 52; hx += 2) mapTree(sim, hx, hy);
    }

    for (let t = 0; t < 3000; t++) sim.step();

    expect(bankedWood(sim)).toBeGreaterThan(0); // the full fell → pick up → bank loop completed
    expect(looseWood(sim)).toBeLessThanOrEqual(WOOD_YIELD_PER_NODE); // no abandoned kłoda
  });
});
