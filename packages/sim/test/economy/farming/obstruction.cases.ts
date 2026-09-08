import { describe, expect, it } from 'vitest';
import { cellAnchorNode, fx, Simulation } from '../../../src/index.js';
import { type HalfCellNode, nodeOfPosition } from '../../../src/nav/halfcell.js';
import { applySow, nodeKey } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  BLOCKHOUSE,
  Building,
  blockhouseAt,
  Crop,
  cellMap,
  ctxOf,
  FIELD_CAP,
  farmAt,
  farmerAt,
  fieldAt,
  fieldAtNode,
  grassMap,
  heapAtNode,
  LOOP_CLOSES_TICKS,
  Position,
  STAGES,
  Stockpile,
  sceneryAtNode,
  VIKING,
  WHEAT,
  wallsContent,
} from './support.js';

// A farm whose plot has to find the gaps around whatever already stands on its ground: walls it cannot walk
// through, and bodies that merely occupy a node without blocking it. The walled cases run on the fixture's
// one walled type (`blockhouseAt`) - the rest of the fixture blocks nothing, which is exactly what makes it
// the fixture for the occupancy half.

describe('a building raised over a field', () => {
  it('is allowed onto a standing plot - farmland never refuses a site', () => {
    // A farm's mature plot is scattered over its whole ring, so if a field were a placement obstacle the
    // settlement could not build anywhere near its own farm until harvest. Placed through the ORDINARY
    // command (no `force`), which is the path a player takes.
    const sim = new Simulation({ seed: 1, content: wallsContent(), map: grassMap(10, 10) });
    const farm = farmAt(sim, 8, 8);
    for (let x = 1; x <= 4; x++) fieldAt(sim, farm, x, 2);
    const node = cellAnchorNode(2, 2);

    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BLOCKHOUSE,
      x: node.hx,
      y: node.hy,
      tribe: VIKING,
    });
    sim.run(1);

    expect([...sim.world.query(Building)].length).toBe(2); // the farm plus the new blockhouse
  });

  it('takes the plants under its walls and leaves the rest standing', () => {
    const sim = new Simulation({ seed: 1, content: wallsContent(), map: grassMap(10, 10) });
    const farm = farmAt(sim, 8, 8);
    const buried = fieldAt(sim, farm, 2, 2); // under the blockhouse body
    const clear = fieldAt(sim, farm, 6, 6); // well outside it

    blockhouseAt(sim, 2, 2);

    expect(sim.world.tryGet(buried, Crop)).toBeUndefined();
    expect(sim.world.tryGet(clear, Crop)).toBeDefined();
  });
});

describe('sowing against standing walls', () => {
  it('a sow swing that lands on a walled node plants nothing', () => {
    // The race the planner cannot filter: the building goes up while the farmer is mid sow-walk. Aimed at
    // the wall node BESIDE the anchor - the anchor carries the building's own store, which the standing-
    // entity check would reject on its own and so would prove nothing about the walls.
    const sim = new Simulation({ seed: 1, content: wallsContent(), map: grassMap(10, 10) });
    const farm = farmAt(sim, 8, 8);
    blockhouseAt(sim, 3, 3);
    const anchor = cellAnchorNode(3, 3);

    applySow(sim.world, ctxOf(sim), { farm, goodType: WHEAT, x: anchor.hx + 1, y: anchor.hy });

    expect([...sim.world.query(Crop)]).toHaveLength(0);
  });

  it('a farmer skips a ripe field walled in behind it and keeps banking wheat', () => {
    // A field the walls closed over AFTER it was sown (so no placement pass cleared it) is the nearest
    // ripe target the reap step can see, and its work cell is its own blocked node - a route that can
    // only fail. The farmer has to fall through to the rest of its plot instead of re-picking it forever.
    const sim = new Simulation({ seed: 7, content: wallsContent(), map: grassMap(12, 12) });
    const farm = farmAt(sim, 6, 6);
    farmerAt(sim, 6, 6, farm);
    blockhouseAt(sim, 5, 5);
    const anchor = cellAnchorNode(5, 5);
    fieldAtNode(sim, farm, anchor.hx + 1, anchor.hy, { stage: STAGES });

    sim.run(600);

    expect(sim.world.get(farm, Stockpile).amounts.get(WHEAT) ?? 0).toBeGreaterThan(0);
  });

  it('never sows the far bank of a river its field radius happens to span', () => {
    // Grass across water is walkable and plantable, and Manhattan distance does not know about the
    // channel - so without a component check the lattice offers the far bank and the farmer walks at a
    // route that cannot exist. The near bank is deliberately almost all barren: with plantable ground to
    // spare at home the nearest-first pick would never reach across, and the case would prove nothing.
    // The symptom is the STRANDED FARMER, not a misplaced field: the far-bank sow never completes, so
    // what breaks is the home plot going untended behind it.
    const sim = new Simulation({
      seed: 7,
      content: wallsContent(),
      map: cellMap(12, 12, (x, y) => {
        if (x === 5) return 'water';
        if (x > 5) return 'grass'; // the whole far bank is temptingly plantable
        return y === 6 ? 'grass' : 'barren'; // one plantable row at home, well under the field cap
      }),
    });
    const farm = farmAt(sim, 4, 6);
    farmerAt(sim, 4, 6, farm);

    sim.run(LOOP_CLOSES_TICKS);

    for (const e of sim.world.query(Crop, Position)) {
      expect(sim.world.get(e, Position).x).toBeLessThan(fx.fromInt(5));
    }
    expect(sim.world.get(farm, Stockpile).amounts.get(WHEAT) ?? 0).toBeGreaterThan(0);
  });
});

describe('sowing around bodies that stand without blocking', () => {
  // The occupancy half of the sow filter, the one the walk-block overlay cannot answer: a loose heap or a
  // footprint-less scenery node is walkable, so only the standing-entity check keeps a plant off it. The
  // planner and `applySow` share that check, so a node the planner rejects is never one the swing accepts.
  /** Long enough for a lone farmer to fill the fixture plot whichever spots the seeded draw hands it. */
  const SOW_TICKS = 400;

  /** Run a lone farmer's farm for {@link SOW_TICKS} over `prepare`d ground: every half-cell node a plant
   *  ever stood on, keyed `hx,hy`, and the most standing at once. */
  function sowingRun(prepare: (sim: Simulation) => void): { sown: Map<string, HalfCellNode>; peak: number } {
    const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(14, 14) });
    const farm = farmAt(sim, 7, 7);
    farmerAt(sim, 7, 7, farm);
    prepare(sim);
    const sown = new Map<string, HalfCellNode>();
    let peak = 0;
    for (let t = 0; t < SOW_TICKS; t++) {
      sim.run(1);
      let standing = 0;
      for (const e of sim.world.query(Crop, Position)) {
        standing++;
        const p = sim.world.get(e, Position);
        const n = nodeOfPosition(p.x, p.y);
        sown.set(nodeKey(n.hx, n.hy), n);
      }
      peak = Math.max(peak, standing);
    }
    return { sown, peak };
  }

  it('never plants on a node a heap or a scenery node already holds', () => {
    const baseline = sowingRun(() => {});
    expect(baseline.peak).toBe(FIELD_CAP);
    const [heap, scenery] = [...baseline.sown.values()]; // two nodes this farm provably reaches for
    if (heap === undefined || scenery === undefined) throw new Error('the baseline farm sowed too little');

    const run = sowingRun((sim) => {
      heapAtNode(sim, heap.hx, heap.hy);
      sceneryAtNode(sim, scenery.hx, scenery.hy);
    });

    expect(run.sown.has(nodeKey(heap.hx, heap.hy))).toBe(false);
    expect(run.sown.has(nodeKey(scenery.hx, scenery.hy))).toBe(false);
    expect(run.peak).toBe(FIELD_CAP); // not vacuous: it still filled the plot, just on other ground
  });
});
