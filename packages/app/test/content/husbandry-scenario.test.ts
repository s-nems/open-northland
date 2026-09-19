import type { BuildingType, ContentSet, GoodType, JobType, TribeType } from '@open-northland/data';
import {
  cellAnchorNode,
  checkInvariants,
  components,
  type Entity,
  fx,
  halfCellMapFromCells,
  ONE,
  positionOfNode,
  Simulation,
  systems,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import { doorNode } from '../../src/view/projections/building-points.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * The breeder's cycle over the MERGED REAL content: a farm with its own crew breeds the herd it was
 * given, the calves grow up, and the grown ones are slaughtered into the wares the clip names. What
 * real content contributes here is every join the sim has no fixture for - the species good against
 * the animal tribe, the breeder's `allowatomic` list, the recipe list its `jobEnablesGood` edges
 * leave on the house, and the slaughter clip whose frame events are the only source of wool, leather
 * and meat. Skips without content.
 */

const { addPerson, addWildlife, Building, FarmAnimal, Health, JobAssignment, Livestock, Owner } = components;
const { Position, Stockpile, YoungAnimal } = components;

const SEED = 7;
const MAP_CELLS = 24;
const FARM_AT = { x: 12, y: 12 } as const;
const PLAYER = 0;
/** Enough for the pair to breed, a calf to reach the original's 3600-tick adulthood, and the
 *  slaughter that follows it. */
const HUSBANDRY_TICKS = 5_000;
/** Water and grain for many cycles, so nothing waits on a supply chain the scenario does not build. */
const STARTER_INPUT = 40;

interface Actors {
  readonly species: GoodType;
  readonly breeder: JobType;
  readonly farm: BuildingType;
  readonly tribe: TribeType;
  readonly animalTribe: number;
}

/** Resolve a species the real content breeds: the good a livestock workplace has a recipe for, the
 *  trade allowed its slaughter atomic, and the animal tribe the good joins. */
function resolveActors(content: ContentSet, speciesId: string): Actors {
  const species = content.goods.find((g) => g.id === speciesId);
  if (species === undefined) throw new Error(`real content ships no ${speciesId} good`);
  const animalTribe = systems.livestockTribeOfGood(content, species.typeId);
  if (animalTribe === null) throw new Error(`${speciesId} joins no animal tribe`);
  const farm = [...content.buildings]
    .sort((a, b) => a.typeId - b.typeId)
    .find((b) => b.recipes.some((r) => r.outputs[0]?.goodType === species.typeId));
  if (farm === undefined) throw new Error(`no building breeds ${speciesId}`);
  const slay = systems.slayAtomicOfSpecies(content, species.typeId);
  const breeder = [...content.jobs]
    .sort((a, b) => a.typeId - b.typeId)
    .find(
      (j) =>
        farm.workers.some((w) => w.jobType === j.typeId) && slay !== null && j.allowedAtomics.includes(slay),
    );
  if (breeder === undefined) throw new Error(`no trade at the ${speciesId} farm may slaughter one`);
  const tribe = [...content.tribes]
    .sort((a, b) => a.typeId - b.typeId)
    .find((t) => t.jobEnables.length > 0 && t.hitpoints > 0);
  if (tribe === undefined) throw new Error('no playable tribe with hitpoints');
  return { species, breeder, farm, tribe, animalTribe };
}

function flatMap(cells: number, terrain: number) {
  return halfCellMapFromCells({
    width: cells,
    height: cells,
    typeIds: new Array(cells * cells).fill(terrain),
  });
}

/** A built farm with its full breeder crew on the door and `herdSize` claimed adults beside it - the
 *  shape a settlement reaches once its scouts have rounded up a herd. */
function buildScenario(
  content: ContentSet,
  speciesId: string,
  herdSize: number,
): { sim: Simulation; farm: Entity; actors: Actors } {
  const actors = resolveActors(content, speciesId);
  const sim = new Simulation({ seed: SEED, content, map: flatMap(MAP_CELLS, TERRAIN_OPEN) });
  const anchor = cellAnchorNode(FARM_AT.x, FARM_AT.y);
  const door = doorNode(actors.farm.footprint, anchor);
  const farm = sim.world.create();
  sim.world.add(farm, Position, positionOfNode(anchor.hx, anchor.hy));
  sim.world.add(farm, Building, {
    buildingType: actors.farm.typeId,
    tribe: actors.tribe.typeId,
    built: ONE,
    level: 0,
  });
  sim.world.add(farm, Owner, { player: PLAYER });
  const inputs = new Map<number, number>();
  for (const input of actors.farm.recipes.flatMap((r) => r.inputs)) inputs.set(input.goodType, STARTER_INPUT);
  sim.world.add(farm, Stockpile, { amounts: inputs });

  const crew = actors.farm.workers.find((w) => w.jobType === actors.breeder.typeId)?.count ?? 1;
  for (let i = 0; i < crew; i++) {
    const breeder = sim.world.create();
    sim.world.add(breeder, Position, positionOfNode(door.hx, door.hy));
    addPerson(sim.world, breeder, {
      tribe: actors.tribe.typeId,
      jobType: actors.breeder.typeId,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(breeder, Owner, { player: PLAYER });
    sim.world.add(breeder, JobAssignment, { workplace: farm });
  }

  const hitpoints = systems.animalHitpoints(content, actors.animalTribe) ?? 0;
  for (let i = 0; i < herdSize; i++) {
    const animal = sim.world.create();
    sim.world.add(animal, Position, positionOfNode(door.hx + 2 + i * 2, door.hy + 2));
    addWildlife(sim.world, animal, actors.animalTribe);
    sim.world.add(animal, Health, { hitpoints, max: hitpoints });
    sim.world.add(animal, Livestock, {});
    sim.world.add(animal, Owner, { player: PLAYER });
  }
  return { sim, farm, actors };
}

/** The wares the species' slaughter clip banks, read the way the sim reads them. */
function slayWares(content: ContentSet, actors: Actors): readonly number[] {
  const settler = { tribe: actors.tribe.typeId, jobType: actors.breeder.typeId };
  return systems.slayDepositGoods({ content }, settler, actors.species.typeId);
}

describe.runIf(hasRealIr())('the breeder cycle over merged real content', () => {
  it('resolves a distinct trade, farm and clip for each species the content breeds', async () => {
    const { merge } = await loadContentUnderTest();
    const sheep = resolveActors(merge.content, 'sheep');
    const cattle = resolveActors(merge.content, 'cattle');
    expect(sheep.farm.typeId).toBe(cattle.farm.typeId); // one house breeds both
    expect(sheep.animalTribe).not.toBe(cattle.animalTribe);
    // The house is left with exactly the two species its breeders enable.
    expect(sheep.farm.recipes.map((r) => r.outputs[0]?.goodType)).toEqual([
      sheep.species.typeId,
      cattle.species.typeId,
    ]);
    expect(slayWares(merge.content, sheep).length).toBeGreaterThan(0);
    expect(slayWares(merge.content, cattle)).not.toEqual(slayWares(merge.content, sheep));
  });

  for (const speciesId of ['sheep', 'cattle'] as const) {
    it(`breeds a ${speciesId} pair, grows the calf up and slaughters into the clip's wares`, async () => {
      const { merge } = await loadContentUnderTest();
      const { sim, farm, actors } = buildScenario(merge.content, speciesId, 2);
      sim.run(HUSBANDRY_TICKS);

      expect(checkInvariants(sim.world, sim.content)).toEqual([]);
      const herd = [...sim.world.query(FarmAnimal)].filter((e) => sim.world.get(e, FarmAnimal).farm === farm);
      expect(herd.length, 'the pair never bred').toBeGreaterThan(2);
      expect(
        herd.some((e) => !sim.world.has(e, YoungAnimal)),
        'no calf ever grew up',
      ).toBe(true);
      const stock = sim.world.get(farm, Stockpile).amounts;
      // The species row counts the herd, and the slaughter's wares are in the house.
      expect(stock.get(actors.species.typeId)).toBe(herd.length);
      for (const ware of slayWares(merge.content, actors)) {
        expect(stock.get(ware) ?? 0, `the slaughter banked no ${ware}`).toBeGreaterThan(0);
      }
    }, 60_000);
  }
});
