import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Position, Resource } from '../../src/components/index.js';
import { ONE, positionOfNode, Simulation } from '../../src/index.js';
import { translatedCells } from '../../src/systems/footprint/geometry.js';
import {
  buildingBlockedCells,
  resourceBlockedCells,
  stampResourceFootprintData,
} from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

// The odd-row parity shift at the sim's translation seams: footprint offsets are authored in the
// even-row frame, so an ODD-row anchor stamps odd-dy cells one node further +x (footprintCellDx,
// verified byte-level against original lmwb sections - docs/formats/MAPDAT.md). Anchors here pick
// rows 4/5 with the same offsets, so each pair differs exactly by the shift.

const EVEN_ANCHOR = { x: 6, y: 4 };
const ODD_ANCHOR = { x: 6, y: 5 };
const VIKING = 1;

/** One cell straight north (odd dy - shifts) and one due east (even dy - never shifts). */
const FOOTPRINT_CELLS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
];

function simOnNodes(): Simulation {
  const content = parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    buildings: [],
  });
  return new Simulation({ seed: 1, content, map: grassNodeMap(16, 16) });
}

describe('footprint odd-row parity shift', () => {
  it('translatedCells keeps even-row anchors verbatim and shifts odd-dy cells on odd rows', () => {
    const sim = simOnNodes();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');

    expect(translatedCells(terrain, FOOTPRINT_CELLS, EVEN_ANCHOR.x, EVEN_ANCHOR.y)).toEqual([
      terrain.nodeAt(6, 3), // (0,-1) verbatim
      terrain.nodeAt(7, 4), // (1,0) verbatim
    ]);
    expect(translatedCells(terrain, FOOTPRINT_CELLS, ODD_ANCHOR.x, ODD_ANCHOR.y)).toEqual([
      terrain.nodeAt(7, 4), // (0,-1) lands one node +x - the odd-anchor, odd-dy shift
      terrain.nodeAt(7, 5), // (1,0) even dy: never shifts
    ]);
  });

  it('a resource walk body stamped on an odd row blocks the shifted cells', () => {
    const sim = simOnNodes();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(ODD_ANCHOR.x, ODD_ANCHOR.y));
    sim.world.add(e, Resource, { goodType: 1, remaining: 1, harvestAtomic: 1 });
    stampResourceFootprintData(sim.world, e, {
      walk: FOOTPRINT_CELLS,
      build: [],
      work: [],
      sourceGfxIndex: 0,
    });

    const blocked = resourceBlockedCells(sim.world, terrain);
    expect(blocked.has(terrain.nodeAt(7, 4))).toBe(true); // shifted (0,-1)
    expect(blocked.has(terrain.nodeAt(6, 4))).toBe(false); // the unshifted stamp would land here
    expect(blocked.has(terrain.nodeAt(7, 5))).toBe(true); // (1,0) verbatim
  });

  it('the door carve-out stays aligned with a shifted body on an odd-row anchor', () => {
    const GATE = 30;
    const content = parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
      buildings: [
        {
          typeId: GATE,
          id: 'test_gate',
          kind: 'workplace',
          // A wall-style record: the door sits INSIDE the walk-block (its passable gate), on an
          // odd-dy cell - body and carve-out must land on the same shifted node.
          footprint: { blocked: [{ dx: 0, dy: 1 }], door: { dx: 0, dy: 1 } },
        },
      ],
    });
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(16, 16) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const gate = sim.world.create();
    sim.world.add(gate, Position, positionOfNode(ODD_ANCHOR.x, ODD_ANCHOR.y));
    sim.world.add(gate, Building, { buildingType: GATE, tribe: VIKING, built: ONE, level: 0 });

    // Door == body cell: the carve-out must erase the whole walk-block at BOTH anchor parities.
    expect(buildingBlockedCells(sim.world, ctxOf(sim), terrain).size).toBe(0);
  });
});
