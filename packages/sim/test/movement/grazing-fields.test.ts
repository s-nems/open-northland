import { describe, expect, it } from 'vitest';
import { Anger, FarmAnimal, MoveGoal, Position, Resting, StayPoint } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, positionOfNode, Simulation } from '../../src/index.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';
import { type GrazingFields, grazingFields } from '../../src/systems/movement/grazing-fields.js';
import { testContent } from '../fixtures/content.js';
import { addSettlerOfTribe } from '../fixtures/settler.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

const BEAR = 10; // the fixture animal, stayPointRange 6
const BEAR_RANGE = 6;

function fixture(): { sim: Simulation; terrain: TerrainGraph } {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 20) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
  return { sim, terrain };
}

function bearAt(sim: Simulation, terrain: TerrainGraph, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  addSettlerOfTribe(sim, e, {
    tribe: BEAR,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, StayPoint, { cell: terrain.nodeAt(x, y) });
  return e;
}

function moveTo(sim: Simulation, e: Entity, x: number, y: number): void {
  const p = sim.world.mut(e, Position);
  const centre = positionOfNode(x, y);
  p.x = centre.x;
  p.y = centre.y;
}

const fieldsOf = (sim: Simulation, terrain: TerrainGraph): GrazingFields =>
  grazingFields(sim.world, sim.content, terrain);

describe('grazingFields index', () => {
  it('re-elects a chain of standers when the lowest keeper walks off', () => {
    const { sim, terrain } = fixture();
    const first = bearAt(sim, terrain, 10, 10);
    const second = bearAt(sim, terrain, 11, 10); // inside first's field
    const third = bearAt(sim, terrain, 12, 10); // inside second's field only
    let fields = fieldsOf(sim, terrain);
    expect(fields.keeperAt(terrain.nodeAt(10, 10))).toBe(first);
    expect(fields.keeperAt(terrain.nodeAt(11, 10))).toBeUndefined();
    expect(fields.keeperAt(terrain.nodeAt(12, 10))).toBe(third);
    expect(fields.grazers).toEqual([first, second, third]);

    sim.world.add(first, MoveGoal, { cell: terrain.nodeAt(2, 2) }); // off the field: second keeps, third yields
    fields = fieldsOf(sim, terrain);
    expect(fields.keeperAt(terrain.nodeAt(10, 10))).toBeUndefined();
    expect(fields.keeperAt(terrain.nodeAt(11, 10))).toBe(second);
    expect(fields.keeperAt(terrain.nodeAt(12, 10))).toBeUndefined();
    expect(fields.grazers).toEqual([second, third]);

    sim.world.remove(first, MoveGoal);
    moveTo(sim, first, 12, 11); // back beside third: first outranks everyone near it
    fields = fieldsOf(sim, terrain);
    expect(fields.keeperAt(terrain.nodeAt(12, 11))).toBe(first);
    expect(fields.keeperAt(terrain.nodeAt(11, 10))).toBe(second);
    expect(fields.keeperAt(terrain.nodeAt(12, 10))).toBeUndefined();
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('follows the drives that hold a stander, its claim and its death', () => {
    const { sim, terrain } = fixture();
    const bear = bearAt(sim, terrain, 4, 4);
    const other = bearAt(sim, terrain, 14, 14);
    expect(fieldsOf(sim, terrain).rangeOf(bear)).toBe(BEAR_RANGE);

    sim.world.add(bear, Anger, { until: 100 });
    expect(fieldsOf(sim, terrain).grazers).toEqual([other]);
    sim.world.remove(bear, Anger);
    sim.world.add(bear, FarmAnimal, { farm: other, summoner: null });
    expect(fieldsOf(sim, terrain).grazers).toEqual([bear, other]);
    sim.world.mut(bear, FarmAnimal).summoner = other;
    expect(fieldsOf(sim, terrain).grazers).toEqual([other]);
    sim.world.add(other, Resting, { at: bear });
    expect(fieldsOf(sim, terrain).keeperAt(terrain.nodeAt(14, 14))).toBeUndefined();
    sim.world.destroy(bear);
    expect(fieldsOf(sim, terrain).grazers).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('reports a keeper the stores no longer elect to the cache verifier', () => {
    const { sim, terrain } = fixture();
    bearAt(sim, terrain, 10, 10);
    const fields = fieldsOf(sim, terrain);
    expect(sim.world.verifyCaches()).toEqual([]);

    (fields as unknown as { keeperByNode: Int32Array }).keeperByNode[terrain.nodeAt(10, 10)] = 0;

    expect(sim.world.verifyCaches()).toEqual(['grazingFields: 2 checks disagree with a fresh election']);
  });
});
