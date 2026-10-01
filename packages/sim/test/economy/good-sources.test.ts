import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, JobAssignment, Owner, Position, Stockpile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { razeBuilding } from '../../src/systems/lifecycle/cleanup.js';
import { removeSettlerSilently } from '../../src/systems/lifecycle/death.js';
import { GoodSources } from '../../src/systems/readviews/good-sources.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, spawnSettler, WOOD, WOODCUTTER } from './production-system/support.js';

const PLAYER = 0;
const RIVAL = 1;
/** A fixture building type that tops up its own wood with no worker, as a well does its water. */
const WOOD_SPRING = 30;
const GRANARY = 6;
const WAREHOUSE = 7;

function springContent(): ContentSet {
  const base = testContent();
  const granary = base.buildings.find((b) => b.typeId === GRANARY);
  if (granary === undefined) throw new Error('fixture granary missing');
  return {
    ...base,
    buildings: [
      ...base.buildings,
      {
        ...granary,
        typeId: WOOD_SPRING,
        id: 'wood_spring',
        refillsOwnStock: true,
        produces: [WOOD],
        stock: [{ goodType: WOOD, capacity: 10, initial: 0 }],
      },
    ],
  };
}

function placed(sim: Simulation, buildingType: number, owner: number): Entity {
  const building = sim.world.create();
  sim.world.add(building, Building, { buildingType, tribe: 1, built: ONE, level: 0 });
  sim.world.add(building, Position, { x: fx.fromInt(4), y: fx.fromInt(4) });
  sim.world.add(building, Stockpile, { amounts: new Map() });
  sim.world.add(building, Owner, { player: owner });
  return building;
}

function woodcutterOf(sim: Simulation, owner: number): Entity {
  const settler = spawnSettler(sim, WOODCUTTER, 2, 2);
  sim.world.add(settler, Owner, { player: owner });
  return settler;
}

/** The wood sources `owner`'s side sees, caught up to the world as it stands. */
function woodSources(sim: Simulation, owner: number): Entity[] {
  return [...GoodSources.of(sim.world, ctxOf(sim)).sources(WOOD, owner)].sort((a, b) => a - b);
}

describe('GoodSources - caught up after the ledger exists', () => {
  it('moves a source to its new side when its owner changes', () => {
    const sim = new Simulation({ seed: 1, content: springContent() });
    const settler = woodcutterOf(sim, PLAYER);
    const spring = placed(sim, WOOD_SPRING, PLAYER);
    expect(woodSources(sim, PLAYER)).toEqual([settler, spring]);
    sim.world.mut(settler, Owner).player = RIVAL;
    sim.world.mut(spring, Owner).player = RIVAL;
    expect(woodSources(sim, PLAYER)).toEqual([]);
    expect(woodSources(sim, RIVAL)).toEqual([settler, spring]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('drops a refilling building that is razed, and keeps the gatherer whose workplace is', () => {
    const sim = new Simulation({ seed: 1, content: springContent() });
    const spring = placed(sim, WOOD_SPRING, PLAYER);
    const warehouse = placed(sim, WAREHOUSE, PLAYER);
    const settler = woodcutterOf(sim, PLAYER);
    sim.world.add(settler, JobAssignment, { workplace: warehouse });
    expect(woodSources(sim, PLAYER)).toEqual([spring, settler].sort((a, b) => a - b));
    razeBuilding(sim.world, ctxOf(sim), spring);
    razeBuilding(sim.world, ctxOf(sim), warehouse);
    expect(woodSources(sim, PLAYER)).toEqual([settler]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('drops a gatherer that dies', () => {
    const sim = new Simulation({ seed: 1, content: springContent() });
    const settler = woodcutterOf(sim, PLAYER);
    const survivor = woodcutterOf(sim, PLAYER);
    expect(woodSources(sim, PLAYER)).toEqual([settler, survivor]);
    removeSettlerSilently(sim.world, settler);
    expect(woodSources(sim, PLAYER)).toEqual([survivor]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
