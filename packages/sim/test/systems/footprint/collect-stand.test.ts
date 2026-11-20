import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Position } from '../../../src/components/index.js';
import { ONE } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { positionOfNode } from '../../../src/nav/halfcell.js';
import type { TerrainGraph } from '../../../src/nav/terrain/index.js';
import { collectStandOf } from '../../../src/systems/footprint/index.js';
import { interactionCell } from '../../../src/systems/settlers/targets/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

// A one-cell well with the door south-west of its body, as the real well's footprint has it, and a pump
// program playing beside its east side.

const VIKING = 1;
const FRANK = 2;
const CIVILIST = 6;
const GRASS = 0;
const WATER = 1;
const WELL = 10;
const PUMP = 44;
const MAP_W = 16;
const MAP_H = 16;
/** An even row: the door's odd row then sits half a node east of its authored offset. */
const ANCHOR = { hx: 7, hy: 6 } as const;
const BLOCKED = [
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
];
const DOOR = { dx: -1, dy: 1 } as const;
/** The pump spot: right of the body and a little below the anchor, as the real well's program has it. */
const CRANK = { x: 18, y: 10 } as const;

function content(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: WATER, id: 'water' },
    ],
    jobs: [{ typeId: CIVILIST, id: 'civilist' }],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: WELL,
        id: 'work_well_00',
        kind: 'workplace',
        stock: [{ goodType: WATER, capacity: 1 }],
        produces: [WATER],
        collectAtomic: PUMP,
        refillsOwnStock: true,
        footprint: { blocked: BLOCKED, door: DOOR },
      },
    ],
    gfxInHousePrograms: [
      {
        tribe: VIKING,
        job: CIVILIST,
        action: PUMP,
        entries: [
          { kind: 'walk', dir: 3, goodType: 0, x: -16, y: 22, from: 0, to: 0 },
          { kind: 'walk', dir: 5, goodType: 0, x: CRANK.x, y: CRANK.y, from: 0, to: 15 },
          { kind: 'clip', action: PUMP, subId: 1, dir: 4, from: 15, to: 90 },
          { kind: 'walk', dir: 3, goodType: WATER, x: -16, y: 22, from: 90, to: 100 },
        ],
      },
    ],
  });
}

function wellOf(tribe: number): { sim: Simulation; terrain: TerrainGraph; well: Entity } {
  const sim = new Simulation({ seed: 1, content: content(), map: grassNodeMap(MAP_W, MAP_H) });
  if (sim.terrain === undefined) throw new Error('setup: terrain missing');
  const well = sim.world.create();
  sim.world.add(well, Position, positionOfNode(ANCHOR.hx, ANCHOR.hy));
  sim.world.add(well, Building, { buildingType: WELL, tribe, built: ONE, level: 0 });
  return { sim, terrain: sim.terrain, well };
}

describe('collectStandOf', () => {
  it('stands the drawer on the open node nearest the spot its program pumps at', () => {
    const { sim, terrain, well } = wellOf(VIKING);

    const stand = collectStandOf(sim.world, ctxOf(sim), terrain, well);

    // Node (+1, +2) draws 34 px right and 38 px down, nearer the crank than (+1, +1) at 51 px and 19 px;
    // (+1, 0) at 34 px right, nearer still, is the body's own.
    expect(stand).toBe(terrain.nodeAt(ANCHOR.hx + 1, ANCHOR.hy + 2));
    expect(stand).not.toBe(interactionCell(sim.world, ctxOf(sim), terrain, well));
  });

  it('leaves a house whose tribe plays no program for its collect action at the door', () => {
    const { sim, terrain, well } = wellOf(FRANK);

    expect(collectStandOf(sim.world, ctxOf(sim), terrain, well)).toBeNull();
  });
});
