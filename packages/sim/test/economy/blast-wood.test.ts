import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  Felling,
  GroundDrop,
  HarvestedBy,
  Position,
  Resource,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { anchorOnlyFootprint, plannerSystem, stampResourceFootprintData } from '../../src/systems/index.js';
import { fellStruckTree } from '../../src/systems/settlers/atomics/effects/goods/index.js';
import { testContent } from '../fixtures/content.js';
import {
  builderAt,
  constructionContent,
  HOUSE,
  WOOD as SITE_WOOD,
  STONE,
  siteAt,
} from './construction-system/support.js';
import {
  buildingAt,
  CARRIER,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  PICKUP_ATOMIC,
  settlerAt,
  WOOD,
  WOODCUTTER,
} from './producer-supply/support.js';

/**
 * A trunk a siege stone knocks down is ordinary loose wood for the settlement (owner ruling): a porter
 * hauls it to a store, a builder fetches it for a site, and a woodcutter still carries it off. The trunk
 * keeps its `GroundDrop` shape, which none of those source scans rejects.
 */

const TREE_WOOD = 3;
/** The fixture woodcutter's harvest atomic, which the trunk's tree names. */
const CHOP_ATOMIC = 24;
/** Generous for a one-strip haul of a few single-unit trips, or a builder's fetch and hammering. */
const RUN_TICKS = 1500;
/** The fixture house's stone bill, delivered up front so the site waits on wood alone. */
const HOUSE_STONE = 2;

/** Fell a grown tree of `good` at tile `(x, 0)` with a siege stone, leaving its blast trunk. */
function blastTrunkAt(sim: Simulation, x: number, good: number): Entity {
  const at = { x: fx.fromInt(x), y: fx.fromInt(0) };
  const tree = sim.world.create();
  sim.world.add(tree, Position, at);
  sim.world.add(tree, Resource, { goodType: good, remaining: TREE_WOOD, harvestAtomic: CHOP_ATOMIC });
  stampResourceFootprintData(sim.world, tree, anchorOnlyFootprint());
  sim.world.add(tree, Felling, { chops: 0 });
  fellStruckTree(sim.world, ctxOf(sim), tree);
  const [trunk] = sim.world.query(GroundDrop, Stockpile);
  if (trunk === undefined) throw new Error('the stone left no trunk');
  expect(sim.world.has(trunk, HarvestedBy)).toBe(false);
  return trunk;
}

describe('wood a siege stone fells', () => {
  it('a porter hauls the blast trunk into its store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 6, 0);
    settlerAt(sim, 4, 0, CARRIER, hq);
    blastTrunkAt(sim, 1, WOOD);

    for (let i = 0; i < RUN_TICKS && (sim.world.get(hq, Stockpile).amounts.get(WOOD) ?? 0) < TREE_WOOD; i++) {
      sim.step();
    }

    expect(sim.world.get(hq, Stockpile).amounts.get(WOOD) ?? 0).toBe(TREE_WOOD);
    expect([...sim.world.query(GroundDrop)]).toHaveLength(0);
  });

  it('a builder fetches the blast trunk for a construction site', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(8, 1) });
    const site = siteAt(sim, HOUSE, 4, 0);
    sim.world.mut(site, Stockpile).amounts.set(STONE, HOUSE_STONE);
    builderAt(sim, 6, 0);
    const trunk = blastTrunkAt(sim, 1, SITE_WOOD);

    let built = false;
    for (let i = 0; i < RUN_TICKS && !built; i++) {
      sim.step();
      built = sim.world.get(site, Building).built >= ONE;
    }

    expect(built).toBe(true);
    expect(sim.world.get(trunk, Stockpile).amounts.get(SITE_WOOD)).toBe(TREE_WOOD - 1);
  });

  it('a roaming woodcutter still carries the blast trunk off', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const woodcutter = settlerAt(sim, 1, 0, WOODCUTTER);
    const trunk = blastTrunkAt(sim, 1, WOOD);

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.tryGet(woodcutter, CurrentAtomic);
    expect(atomic?.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic?.effect).toMatchObject({ kind: 'pickup', goodType: WOOD, from: trunk });
  });
});
