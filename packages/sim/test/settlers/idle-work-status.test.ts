import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Carrying,
  DeliveryFlag,
  JobAssignment,
  Position,
  ProductionCounters,
  Stockpile,
  WorkFlag,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, positionOfNode, Simulation, type TerrainMap } from '../../src/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { COW, DEER, fighterAtNode, HUNTER } from '../conflict/combat-system/support.js';
import { combatantAtNode, P0 } from '../conflict/stances/support.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap, grassNodeMap } from '../fixtures/terrain.js';
import { riverMap } from './gatherer-flag/support.js';

/** The hunter's node and its flag's: the ground is the flag circle around it. */
const HUNTER_AT = { hx: 20, hy: 20 } as const;
const GROUND_RADIUS = 8;
/** A half-cell column of water just past the hunter, still inside its ground. */
const RIVER_COLUMN = HUNTER_AT.hx + 3;
/** The fixture hunter's carcass goods. */
const MEAT = 21;
const LEATHER = 22;
/** Fixture trades and buildings: a carrier that only hauls, and the passive store it is posted to. */
const CARRIER = 36;
const HEADQUARTERS = 1;
const VIKING = 1;
const WOOD = 1;
/** Enough ticks for the planner to stand an idle carrier, or to walk it to a pile. */
const SETTLE_TICKS = 40;

function hunterOn(map: TerrainMap): { sim: Simulation; hunter: Entity } {
  const sim = new Simulation({ seed: 1, content: testContent(), map });
  const hunter = combatantAtNode(sim, HUNTER_AT.hx, HUNTER_AT.hy, P0, MILITARY_MODE.IGNORE, {
    jobType: HUNTER,
  });
  const flag = sim.world.create();
  sim.world.add(flag, Position, positionOfNode(HUNTER_AT.hx, HUNTER_AT.hy));
  sim.world.add(flag, DeliveryFlag, {});
  sim.world.add(hunter, WorkFlag, { flag, radius: GROUND_RADIUS });
  return { sim, hunter };
}

describe('selected hunter work diagnostics', () => {
  it('reports no game when none lives on the map, and leaves the state untouched', () => {
    const { sim, hunter } = hunterOn(grassNodeMap(48, 48));
    // Before the combat system has judged a tick there is no search to read.
    expect(sim.workStatus(hunter)).toEqual({ kind: 'unknown', reason: 'gatherSearch' });
    sim.step();
    const before = sim.hashState();
    expect(sim.workStatus(hunter)).toEqual({ kind: 'noGame' });
    expect(sim.hashState()).toBe(before);
  });

  it('reports no game while the only game grazes outside the ground', () => {
    const { sim, hunter } = hunterOn(grassNodeMap(48, 48));
    fighterAtNode(sim, HUNTER_AT.hx + GROUND_RADIUS + 6, HUNTER_AT.hy, DEER, null);
    sim.step();
    const before = sim.hashState();
    expect(sim.workStatus(hunter)).toEqual({ kind: 'noGame' });
    expect(sim.hashState()).toBe(before);
  });

  it('names no reason while game it can take stands in the ground', () => {
    const { sim, hunter } = hunterOn(grassNodeMap(48, 48));
    fighterAtNode(sim, HUNTER_AT.hx + 5, HUNTER_AT.hy, DEER, null);
    sim.step();
    expect(sim.workStatus(hunter)).toEqual({ kind: 'unknown', reason: 'gatherSearch' });
  });

  it('reports game behind water as out of reach', () => {
    const { sim, hunter } = hunterOn(riverMap(48, 48, [RIVER_COLUMN]));
    fighterAtNode(sim, HUNTER_AT.hx + 5, HUNTER_AT.hy, DEER, null);
    sim.step();
    const before = sim.hashState();
    expect(sim.workStatus(hunter)).toEqual({ kind: 'gameOutOfReach' });
    expect(sim.hashState()).toBe(before);
  });

  it('holds back last-resort livestock as the acquisition does while real game stands in the probe', () => {
    const { sim, hunter } = hunterOn(grassNodeMap(64, 48));
    fighterAtNode(sim, HUNTER_AT.hx + 3, HUNTER_AT.hy, COW, null);
    fighterAtNode(sim, HUNTER_AT.hx + GROUND_RADIUS + 4, HUNTER_AT.hy, DEER, null);
    sim.step();
    expect(sim.workStatus(hunter)).toEqual({ kind: 'noGame' });
  });

  it('puts a stopped selection ahead of the game search', () => {
    const { sim, hunter } = hunterOn(grassNodeMap(48, 48));
    sim.world.add(hunter, ProductionCounters, {
      counters: [
        [MEAT, 0],
        [LEATHER, 0],
      ],
      cursor: 0,
    });
    sim.step();
    expect(sim.workStatus(hunter)).toEqual({ kind: 'nothingSelected' });
  });
});

describe('selected carrier work diagnostics', () => {
  function postedCarrier(): { sim: Simulation; carrier: Entity } {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(12, 4) });
    const store = sim.world.create();
    sim.world.add(store, Position, { x: fx.fromInt(10), y: fx.fromInt(1) });
    sim.world.add(store, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map() });
    const carrier = sim.world.create();
    sim.world.add(carrier, Position, { x: fx.fromInt(2), y: fx.fromInt(1) });
    addPerson(sim.world, carrier, {
      tribe: VIKING,
      jobType: CARRIER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(carrier, JobAssignment, { workplace: store });
    return { sim, carrier };
  }

  it('reports nothing to carry once its ladder stood it idle, and nothing once a pile appears', () => {
    const { sim, carrier } = postedCarrier();
    for (let i = 0; i < SETTLE_TICKS; i++) sim.step();
    const before = sim.hashState();
    expect(sim.workStatus(carrier)).toEqual({ kind: 'nothingToCarry' });
    expect(sim.hashState()).toBe(before);

    const pile = sim.world.create();
    sim.world.add(pile, Position, { x: fx.fromInt(5), y: fx.fromInt(1) });
    sim.world.add(pile, Stockpile, { amounts: new Map([[WOOD, 3]]) });
    let hauled = false;
    for (let i = 0; i < SETTLE_TICKS * 10 && !hauled; i++) {
      sim.step();
      hauled = sim.world.has(carrier, Carrying);
    }
    expect(hauled).toBe(true);
    expect(sim.workStatus(carrier)?.kind).not.toBe('nothingToCarry');
  });
});
