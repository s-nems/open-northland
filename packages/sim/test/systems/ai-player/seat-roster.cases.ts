import { describe, expect, it } from 'vitest';
import { Building, Owner, Person } from '../../../src/components/index.js';
import { ZERO } from '../../../src/core/fixed.js';
import { type Entity, World } from '../../../src/ecs/world.js';
import { ownedBuildings, ownedSettlers } from '../../../src/systems/ai-player/seat-roster.js';
import { HQ_TYPE, SEAT, VIKING } from './support.js';

/** The memoized seat rosters: what invalidates them, and the ownership of the list they hand out. */

const RIVAL = 3;

function addBuilding(world: World, owner: number): Entity {
  const e = world.create();
  world.add(e, Building, { buildingType: HQ_TYPE, tribe: VIKING, built: ZERO, level: 0 });
  world.add(e, Owner, { player: owner });
  return e;
}

function addPerson(world: World, owner: number): Entity {
  const e = world.create();
  world.add(e, Person, { person: true });
  world.add(e, Owner, { player: owner });
  return e;
}

describe('the seat rosters', () => {
  it('lists only the seat, and keeps people, buildings and unkeyed property apart', () => {
    const world = new World();
    const rival = addBuilding(world, RIVAL);
    const hall = addBuilding(world, SEAT);
    const settler = addPerson(world, SEAT);
    // An owned thing carrying neither key component - the claimed animal's shape.
    world.add(world.create(), Owner, { player: SEAT });
    expect(ownedBuildings(world, SEAT)).toEqual([hall]);
    expect(ownedBuildings(world, RIVAL)).toEqual([rival]);
    expect(ownedSettlers(world, SEAT)).toEqual([settler]);
  });

  it('answers a seat that owns nothing with an empty list', () => {
    const world = new World();
    addBuilding(world, RIVAL);
    expect(ownedBuildings(world, SEAT)).toEqual([]);
    expect(ownedSettlers(world, SEAT)).toEqual([]);
  });

  it('ascends by id even when the component stores hold the seat out of that order', () => {
    const world = new World();
    const lower = addBuilding(world, SEAT);
    const higher = addBuilding(world, SEAT);
    // Re-adding appends to both stores, so raw query order now trails the lower id behind the higher.
    world.remove(lower, Building);
    world.remove(lower, Owner);
    world.add(lower, Building, { buildingType: HQ_TYPE, tribe: VIKING, built: ZERO, level: 0 });
    world.add(lower, Owner, { player: SEAT });
    expect([...world.query(Building, Owner)]).toEqual([higher, lower]);
    expect(ownedBuildings(world, SEAT)).toEqual([lower, higher]);
  });

  it('keeps two worlds apart, whose entity ids both restart at 1', () => {
    const one = new World();
    const other = new World();
    const hall = addBuilding(one, SEAT);
    addBuilding(other, SEAT);
    addBuilding(other, SEAT);
    expect(ownedBuildings(one, SEAT)).toEqual([hall]);
    expect(ownedBuildings(other, SEAT)).toHaveLength(2);
  });

  it('sees a new building, a destroyed one, and a capture stamped through World.add', () => {
    const world = new World();
    const kept = addBuilding(world, SEAT);
    expect(ownedBuildings(world, SEAT)).toEqual([kept]);

    const raised = addBuilding(world, SEAT);
    expect(ownedBuildings(world, SEAT)).toEqual([kept, raised]);

    world.add(raised, Owner, { player: RIVAL });
    expect(ownedBuildings(world, SEAT)).toEqual([kept]);
    expect(ownedBuildings(world, RIVAL)).toEqual([raised]);

    world.destroy(kept);
    expect(ownedBuildings(world, SEAT)).toEqual([]);
  });

  it('sees a capture written in place through World.mut', () => {
    const world = new World();
    const taken = addPerson(world, SEAT);
    expect(ownedSettlers(world, SEAT)).toEqual([taken]);

    world.mut(taken, Owner).player = RIVAL;
    expect(ownedSettlers(world, SEAT)).toEqual([]);
    expect(ownedSettlers(world, RIVAL)).toEqual([taken]);
  });

  it('hands out one shared frozen list, so a caller cannot reorder what every other caller reads', () => {
    const world = new World();
    addBuilding(world, SEAT);
    addBuilding(world, SEAT);
    const roster = ownedBuildings(world, SEAT);
    expect(ownedBuildings(world, SEAT)).toBe(roster); // the memo, not a fresh scan
    expect(() => (roster as Entity[]).sort((a, b) => b - a)).toThrow();
    expect(() => (roster as Entity[]).push(1 as Entity)).toThrow();
  });

  it('leaves the world coherent under verifyCaches after a tracked capture', () => {
    const world = new World();
    const taken = addBuilding(world, SEAT);
    addPerson(world, SEAT);
    ownedBuildings(world, SEAT);
    ownedSettlers(world, SEAT);
    world.mut(taken, Owner).player = RIVAL;
    ownedBuildings(world, SEAT);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('reports an owner rewritten past the tracked mutation seam, at the tick it happens', () => {
    const world = new World();
    const taken = addBuilding(world, SEAT);
    expect(ownedBuildings(world, SEAT)).toEqual([taken]);
    // Defeating the read-only view is the one write no generation can see.
    (world.get(taken, Owner) as { player: number }).player = RIVAL;
    expect(world.verifyCaches().join('\n')).toContain('ownedBuildings');
  });
});
