import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { aiControlEntity, StalledPlacements } from '../../../../../src/components/index.js';
import { Simulation } from '../../../../../src/index.js';
import type { BuildOrder } from '../../../../../src/systems/computer-player/index.js';
import { clearingAim } from '../../../../../src/systems/computer-player/workforce/collectors/index.js';
import { resourcesAtNode } from '../../../../../src/systems/spatial/resources.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { ctxOf, makeAiSeat, placeResources, RESOURCE_SPOTS, SEAT, VIKING } from '../../support.js';

const GRASS = 0;
const WATER = 1;
const WIDTH = 64;
const HEIGHT = 32;
/** The seat's base node, in water between the two grass strips. */
const BASE = { hx: 27, hy: 15 } as const;
/** A home's zone: its anchor and the nodes two to either side on its row. */
const HOME_ZONE = [
  { dx: -2, dy: 0 },
  { dx: 0, dy: 0 },
  { dx: 2, dy: 0 },
];
/** Two grass strips exactly a home's zone wide, each within the build reach of the base. */
const NEAR_STRIP = { x: 12, y: 10 } as const;
const FAR_STRIP = { x: 42, y: 20 } as const;

const ORDER: BuildOrder = {
  lines: [{ id: 'homes', steps: [{ kind: 'place', building: 'home_level_00', count: 1 }] }],
  priority: ['homes'],
};

function stripSim(trees: readonly { x: number; y: number }[]): Simulation {
  const base = aiContent();
  const content = parseContentSet({
    ...base,
    buildings: base.buildings.map((b) =>
      b.id === 'home_level_00'
        ? { ...b, footprint: { blocked: HOME_ZONE, reserved: HOME_ZONE, door: { dx: 0, dy: 1 } } }
        : b,
    ),
  });
  const typeIds = new Array<number>(WIDTH * HEIGHT).fill(WATER);
  for (const strip of [NEAR_STRIP, FAR_STRIP])
    for (let dx = -2; dx <= 2; dx++) typeIds[strip.y * WIDTH + strip.x + dx] = GRASS;
  const sim = new Simulation({
    seed: 1,
    content,
    map: { resolution: 'half-cell', width: WIDTH, height: HEIGHT, typeIds },
  });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  placeResources(
    sim,
    trees.map((tree) => ({ ...RESOURCE_SPOTS.wood, ...tree })),
  );
  makeAiSeat(sim, SEAT);
  sim.step();
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('setup: no AI carrier');
  sim.world.add(carrier, StalledPlacements, {
    retryTicks: new Map([['homes:0', Number.MAX_SAFE_INTEGER]]),
    holding: new Map([['homes', 'homes:0']]),
  });
  return sim;
}

const aimOf = (sim: Simulation) => [
  ...clearingAim(sim.world, { ...ctxOf(sim), content: sim.content }, SEAT, ORDER, BASE),
];

describe('clearing aim', () => {
  it('aims the posts at the trees of the patch the stalled building takes with the least clearing', () => {
    const near = { x: NEAR_STRIP.x, y: NEAR_STRIP.y };
    const sim = stripSim([near, { x: FAR_STRIP.x - 2, y: FAR_STRIP.y }, { x: FAR_STRIP.x, y: FAR_STRIP.y }]);
    const tree = resourcesAtNode(sim.world, near.x, near.y);
    expect(tree).toHaveLength(1);
    expect(aimOf(sim)).toEqual(tree);
  });

  it('aims nowhere while some patch fits, or while no placement stalls', () => {
    // The near strip stands free: the stall is not for want of ground.
    expect(aimOf(stripSim([{ x: FAR_STRIP.x, y: FAR_STRIP.y }]))).toEqual([]);
    const sim = stripSim([NEAR_STRIP, FAR_STRIP]);
    expect(aimOf(sim)).toHaveLength(1);
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier !== null) sim.world.remove(carrier, StalledPlacements);
    expect(aimOf(sim)).toEqual([]);
  });
});
