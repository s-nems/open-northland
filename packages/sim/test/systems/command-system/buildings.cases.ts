import { describe, expect, it } from 'vitest';
import {
  Building,
  JobAssignment,
  Owner,
  Position,
  Settler,
  Stockpile,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode } from '../../../src/index.js';

import {
  CARPENTER,
  FRANK,
  fresh,
  HEADQUARTERS,
  nthEntity,
  SAWMILL,
  SMITHY,
  VIKING,
  WOOD,
  WOODCUTTER,
} from './support.js';

describe('CommandSystem — buildings and demolition', () => {
  it('placeBuilding creates a built building with a seeded stockpile and emits buildingPlaced', () => {
    const sim = fresh();
    // Command coords are half-cell nodes; cell (3,4)'s anchor node (6,8) sits exactly on tile (3,4).
    const anchor = cellAnchorNode(3, 4);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: HEADQUARTERS,
      x: anchor.hx,
      y: anchor.hy,
      tribe: VIKING,
    });
    expect(sim.commands.pendingCount).toBe(1);

    sim.step();

    expect(sim.commands.pendingCount).toBe(0);
    expect(sim.world.canonicalEntities()).toHaveLength(1);
    const e = nthEntity(sim, 0);
    const b = sim.world.get(e, Building);
    expect(b.buildingType).toBe(HEADQUARTERS);
    expect(b.tribe).toBe(VIKING);
    // The HQ stock slots: wood init 10 (seeded), plank init 0 (omitted — only positive initials seed).
    const stock = sim.world.get(e, Stockpile).amounts;
    expect(stock.get(WOOD)).toBe(10);
    expect(stock.has(2)).toBe(false);
    const pos = sim.world.get(e, Position);
    expect([pos.x, pos.y]).toEqual([3 * 65536, 4 * 65536]);
    const placed = sim.events.current().filter((ev) => ev.kind === 'buildingPlaced');
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ at: { x: anchor.hx, y: anchor.hy } }); // events echo node coords
  });

  it('placeBuilding initialGoods (authored addgoods) add on top of the type-default seeding', () => {
    const sim = fresh();
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: HEADQUARTERS,
      x: 3,
      y: 4,
      tribe: VIKING,
      initialGoods: [
        { good: WOOD, amount: 15 }, // on top of the slot's init 10
        { good: 2, amount: 5 }, // a slot the defaults left empty
      ],
    });
    sim.step();
    const stock = sim.world.get(nthEntity(sim, 0), Stockpile).amounts;
    expect(stock.get(WOOD)).toBe(25);
    expect(stock.get(2)).toBe(5);
  });

  it('placeBuilding initialGoods are ignored for an under-construction site (empty hold)', () => {
    const sim = fresh();
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: HEADQUARTERS,
      x: 3,
      y: 4,
      tribe: VIKING,
      underConstruction: true,
      initialGoods: [{ good: WOOD, amount: 15 }],
    });
    sim.step();
    expect(sim.world.get(nthEntity(sim, 0), Stockpile).amounts.size).toBe(0);
  });

  it('placeBuilding with a valid owner stamps an Owner on the building', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 3, y: 4, tribe: VIKING, owner: 2 });
    sim.step();
    expect(sim.world.get(nthEntity(sim, 0), Owner)).toEqual({ player: 2 });
  });

  it('skips a command with an unknown type id (recoverable bad input — no throw, still logged)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'placeBuilding', buildingType: 999, x: 0, y: 0, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: 999, x: 0, y: 0, tribe: VIKING });
    expect(() => sim.step()).not.toThrow();

    expect(sim.world.entityCount).toBe(0); // nothing created from bad input
    expect(sim.commands.log).toHaveLength(2); // but both are still recorded for faithful replay
  });

  it('demolish destroys a placed building (ids are never recycled)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 0, y: 0, tribe: VIKING });
    sim.step();
    const e = nthEntity(sim, 0);
    expect(sim.world.isAlive(e)).toBe(true);

    sim.enqueue({ kind: 'demolish', building: e });
    sim.step();
    expect(sim.world.isAlive(e)).toBe(false);
    expect(sim.world.entityCount).toBe(0);
  });

  it('demolish aimed at a non-building entity is skipped (never destroys a settler)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
    sim.step();
    const settler = nthEntity(sim, 0);

    // A stale/hostile command targeting a live NON-building must validate the target kind at
    // execution (in lockstep any peer can send any command) — skip, don't destroy.
    sim.enqueue({ kind: 'demolish', building: settler });
    sim.step();
    expect(sim.world.isAlive(settler)).toBe(true);
    expect(sim.commands.log).toHaveLength(2); // still logged for faithful replay
  });

  it('demolish unbinds the workplace operators: each returns to idle and re-employable', () => {
    const sim = fresh();
    // A sawmill (type 2, one carpenter slot) and a carpenter standing on its tile. The JobSystem (in
    // the step schedule) ADOPTS the pre-employed-but-unbound operator, binding it to the mill it staffs.
    sim.enqueue({ kind: 'placeBuilding', buildingType: SAWMILL, x: 5, y: 5, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: CARPENTER, x: 5, y: 5, tribe: VIKING });
    sim.step();
    const mill = nthEntity(sim, 0);
    const worker = nthEntity(sim, 1);
    expect(sim.world.get(worker, JobAssignment).workplace).toBe(mill); // bound to THIS mill

    // Demolish the mill: its operator must be released, not left latched to a dead entity.
    sim.enqueue({ kind: 'demolish', building: mill });
    sim.step();
    expect(sim.world.isAlive(mill)).toBe(false);
    expect(sim.world.has(worker, JobAssignment)).toBe(false); // binding cleared
    expect(sim.world.get(worker, Settler).jobType).toBeNull(); // back to idle for re-assignment
  });

  it('gates a tech-locked building: skipped (still logged) until the enabling job exists', () => {
    const sim = fresh();
    // No carpenter yet — the SMITHY is locked behind `jobEnablesHouse 2 4`, so placement is skipped.
    sim.enqueue({ kind: 'placeBuilding', buildingType: SMITHY, x: 0, y: 0, tribe: VIKING });
    sim.step();
    expect(sim.world.entityCount).toBe(0); // gated out — nothing built
    expect(sim.commands.log).toHaveLength(1); // but still recorded for faithful replay

    // Spawn the enabling carpenter, then retry: now the smithy unlocks and is placed.
    sim.enqueue({ kind: 'spawnSettler', jobType: CARPENTER, x: 1, y: 0, tribe: VIKING });
    sim.step();
    sim.enqueue({ kind: 'placeBuilding', buildingType: SMITHY, x: 0, y: 0, tribe: VIKING });
    sim.step();

    const buildings = [...sim.world.query(Building)];
    expect(buildings).toHaveLength(1);
    expect(sim.world.get(buildings[0] as Entity, Building).buildingType).toBe(SMITHY);
  });

  it('does not gate the building for a different tribe whose carpenter is enabling', () => {
    const sim = fresh();
    // A carpenter exists, but in a DIFFERENT tribe — the smithy stays gated for the viking tribe.
    sim.enqueue({ kind: 'spawnSettler', jobType: CARPENTER, x: 1, y: 0, tribe: FRANK });
    sim.step();
    sim.enqueue({ kind: 'placeBuilding', buildingType: SMITHY, x: 0, y: 0, tribe: VIKING });
    sim.step();
    expect([...sim.world.query(Building)]).toHaveLength(0); // wrong tribe's carpenter doesn't unlock it
  });

  it('leaves ungated buildings (the headquarters) placeable with no enabling settler', () => {
    const sim = fresh();
    // The HQ carries no `jobEnablesHouse` edge, so it places without any settler present.
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 0, y: 0, tribe: VIKING });
    sim.step();
    expect([...sim.world.query(Building)]).toHaveLength(1);
  });

  it('gates nothing for a tribe absent from the tribe table (no tech-graph data)', () => {
    const sim = fresh();
    // The FRANK tribe has no TribeType in the fixture, so its tech-graph gates nothing — even the
    // otherwise-locked smithy places (a map with no tribe data still gets its start buildings).
    sim.enqueue({ kind: 'placeBuilding', buildingType: SMITHY, x: 0, y: 0, tribe: FRANK });
    sim.step();
    expect([...sim.world.query(Building)]).toHaveLength(1);
  });
});
