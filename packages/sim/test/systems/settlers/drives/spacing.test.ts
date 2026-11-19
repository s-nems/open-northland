import { describe, expect, it } from 'vitest';
import { Building, Position, UnderConstruction } from '../../../../src/components/index.js';
import { ZERO } from '../../../../src/core/fixed.js';
import { cellAnchorNode, type NodeId, positionOfNode } from '../../../../src/index.js';
import { walkLengthTo } from '../../../../src/nav/range-search.js';
import { navigationLimitFor } from '../../../../src/systems/index.js';
import { claimWorkCell } from '../../../../src/systems/settlers/drives/spacing.js';
import { PlannerSpacing } from '../../../../src/systems/settlers/planner/spacing.js';
import { rankFromSpot, walkLengthsFrom } from '../../../../src/systems/signposts/index.js';
import { nearestCell } from '../../../../src/systems/spatial/metric.js';
import { NodeBuckets } from '../../../../src/systems/spatial/nodes.js';
import { ctxOf } from '../../../fixtures/context.js';
import { nodeOfCell, RIVER_CELLS, riverSim, settlerOn } from '../../../fixtures/river-bank.js';

const VIKING = 1;
const WOODCUTTER = 1;
/** A test-content workplace with no footprint, so its site body is the anchor alone. */
const SITE_TYPE = 2;
/** The site stands two cells past the river on the builder's row, three cell rows above the ford. */
const SITE_CELL = { x: 22, y: 6 };
const BUILDER_CELL = { x: 16, y: 6 };

describe("a builder's stand at a site behind a river", () => {
  it('claims the perimeter cell with the shortest walk, not the one facing the builder across the water', () => {
    const { sim, terrain } = riverSim(true);
    const site = sim.world.create();
    const anchor = cellAnchorNode(SITE_CELL.x, SITE_CELL.y);
    sim.world.add(site, Position, positionOfNode(anchor.hx, anchor.hy));
    sim.world.add(site, Building, { buildingType: SITE_TYPE, tribe: VIKING, built: ZERO, level: 0 });
    sim.world.add(site, UnderConstruction, { labor: ZERO });
    const builder = settlerOn(sim, BUILDER_CELL, WOODCUTTER);
    const here = nodeOfCell(terrain, BUILDER_CELL);
    const spacing = (): PlannerSpacing =>
      PlannerSpacing.overExplicit(
        sim.world,
        ctxOf(sim),
        terrain,
        new NodeBuckets(sim.world, [builder]),
        new Set(),
      );
    const cells = spacing().workCells(site);
    const from = terrain.coordsOf(here);
    const anyWalk = 2 * RIVER_CELLS.width;
    const lengths = walkLengthsFrom(sim.world, sim.content, terrain, from.x, from.y, anyWalk);
    if (lengths === null) throw new Error('a walk starts on the bank');
    const stepsTo = (cell: NodeId): number => walkLengthTo(lengths, terrain.xOf(cell), terrain.yOf(cell));
    const byWalk = [...cells].sort((a, b) => stepsTo(a) - stepsTo(b) || a - b)[0];
    const byLine = nearestCell(terrain, cells, here);
    expect(byWalk).not.toBe(byLine);

    const limit = navigationLimitFor(sim.world, sim.content, terrain, builder);
    const rank = rankFromSpot(limit, here);
    expect(claimWorkCell(sim.world, terrain, builder, here, site, spacing(), rank)).toBe(byWalk);
    expect(claimWorkCell(sim.world, terrain, builder, here, site, spacing(), here)).toBe(byLine);
  });
});
