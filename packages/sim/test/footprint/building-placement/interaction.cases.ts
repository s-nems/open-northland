import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { PathFollow, PathRequest, Position, Settler } from '../../../src/components/index.js';
import { findPath, fx, positionOfNode, Simulation } from '../../../src/index.js';
import { buildingBlockedCells, interactionNode, presentOperatorCount } from '../../../src/systems/index.js';

import {
  ctxOf,
  grassMap,
  HQ,
  HUT,
  mappedSim,
  placedBuilding,
  placementContent,
  terrainOf,
  VIKING,
  WOODCUTTER,
} from './support.js';

describe('door cell — settlers interact with a house at its entry point', () => {
  it('resolves the interaction tile to the door (footprinted) or the anchor (footprint-less)', () => {
    const sim = mappedSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HQ, x: 9, y: 9, tribe: VIKING });
    sim.step();
    const hut = placedBuilding(sim, 0);
    const hq = placedBuilding(sim, 1);
    expect(interactionNode(sim.world, ctxOf(sim), hut)).toEqual({ x: 4, y: 5 }); // anchor + door(-1,0)
    expect(interactionNode(sim.world, ctxOf(sim), hq)).toEqual({ x: 9, y: 9 }); // anchor itself
  });

  it('counts a worker standing at the DOOR as present (and one on the anchor as absent)', () => {
    const sim = mappedSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.step();
    const hut = placedBuilding(sim);
    const worker = sim.world.create();
    sim.world.add(worker, Settler, {
      tribe: VIKING,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map<number, number>(),
    });
    sim.world.add(worker, Position, positionOfNode(5, 5)); // ON the walls (the anchor node) — not at work
    expect(presentOperatorCount(sim.world, ctxOf(sim), hut)).toBe(0);
    Object.assign(sim.world.get(worker, Position), positionOfNode(4, 5)); // at the door node (4,5)
    expect(presentOperatorCount(sim.world, ctxOf(sim), hut)).toBe(1);
  });
});

describe('wall gate — a door listed inside the walls stays walkable', () => {
  // The real data's defence wall (`work_pottery_02`, the "Mur" records) puts its LogicDoorPoint
  // INSIDE its own LogicWalkBlockArea: the door IS the wall's passable gate. Without the carve-out
  // a walk-to-door goal would be a blocked cell → findPath fails → the request is never re-issued →
  // the settler wedges forever. Pinned here on a synthetic gate fixture of the same shape.
  const GATE = 11;
  const GATE_FOOTPRINT = {
    blocked: [
      { dx: -1, dy: 0 },
      { dx: 0, dy: 0 }, // the gate cell — ALSO the door below, like the real wall records
      { dx: 1, dy: 0 },
    ],
    familyBody: [
      { dx: -1, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    reserved: [-1, 0, 1].flatMap((dy) => [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy }))),
    door: { dx: 0, dy: 0 },
  };

  function gateContent(): ContentSet {
    const base = placementContent();
    return parseContentSet({
      ...base,
      buildings: [
        ...base.buildings,
        { typeId: GATE, id: 'wall_gate', kind: 'tower', footprint: GATE_FOOTPRINT },
      ],
    });
  }

  it('leaves the door cell out of the walk-block overlay and routes THROUGH the gate', () => {
    const sim = new Simulation({ seed: 1, content: gateContent(), map: grassMap(9, 7) });
    sim.enqueue({ kind: 'placeBuilding', buildingType: GATE, x: 4, y: 3, tribe: VIKING });
    sim.step();
    const terrain = terrainOf(sim);
    const blocked = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect(blocked.has(terrain.nodeAt(3, 3))).toBe(true); // wall segment
    expect(blocked.has(terrain.nodeAt(5, 3))).toBe(true); // wall segment
    expect(blocked.has(terrain.nodeAt(4, 3))).toBe(false); // the gate/door — carved out, passable
    // A path to the gate cell itself (the interaction tile) succeeds instead of wedging.
    expect(interactionNode(sim.world, ctxOf(sim), placedBuilding(sim))).toEqual({ x: 4, y: 3 });
    const walker = sim.world.create();
    sim.world.add(walker, Position, positionOfNode(0, 3));
    sim.world.add(walker, PathRequest, {
      start: terrain.nodeAt(0, 3),
      goal: terrain.nodeAt(4, 3),
      failed: false,
    });
    sim.step();
    expect(sim.world.has(walker, PathFollow)).toBe(true);
  });
});

describe('findPath — the blocked-start/goal exemptions', () => {
  it('trivially succeeds when start === goal even on a building cell (already there)', () => {
    const sim = mappedSim(grassMap(8, 5));
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 3, y: 1, tribe: VIKING });
    sim.step();
    const terrain = terrainOf(sim);
    const blocked = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    const wall = terrain.nodeAt(3, 1);
    expect(blocked.has(wall)).toBe(true);
    expect(findPath(terrain, wall, wall, blocked)).toEqual([wall]); // standing on it — not "unreachable"
  });
});
