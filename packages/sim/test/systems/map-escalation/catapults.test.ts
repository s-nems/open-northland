import { MapModules } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { markPlayerDead, Owner, Vehicle } from '../../../src/components/index.js';
import { TICKS_PER_SECOND } from '../../../src/core/loop.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { removeVehicle } from '../../../src/systems/vehicles/remove.js';
import { ctxOf } from '../../fixtures/context.js';
import {
  CATAPULT,
  CATAPULT_RESPAWN_SECONDS,
  FORTRESS,
  GEARED,
  gearContent,
  HQ_TYPE,
  KEEP,
  MAP,
  REFILL_EVERY_SECONDS,
  SCRIPT,
  VIKING,
} from '../../fixtures/map-escalation/keep.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

const CATAPULT_SPOT = { x: 52, y: 80 };

function setupWithCatapult(options: { readonly inMatch?: boolean } = {}): Simulation {
  const sim = new Simulation({
    seed: 3,
    content: gearContent(),
    map: grassNodeMap(MAP, MAP),
    mapAiScript: SCRIPT,
    mapModules: MapModules.parse(GEARED),
  });
  if (options.inMatch === true) sim.enqueueSetup({ kind: 'setMatchParticipants', players: [FORTRESS] });
  sim.enqueueSetup({ kind: 'setAiControl', player: FORTRESS, enabled: true, modules: { military: false } });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    ...KEEP,
    tribe: VIKING,
    owner: FORTRESS,
    force: true,
    underConstruction: false,
  });
  sim.enqueueSetup({
    kind: 'createVehicle',
    vehicleType: CATAPULT,
    ...CATAPULT_SPOT,
    tribe: VIKING,
    owner: FORTRESS,
  });
  sim.step();
  return sim;
}

function fortressCatapults(sim: Simulation): Entity[] {
  return [...sim.world.query(Vehicle, Owner)].filter((e) => sim.world.get(e, Owner).player === FORTRESS);
}

/** Destroy the fortress's catapult and return the tick of the first refill beat that may raise it:
 *  seen lost at the next second, then a full wait. */
function loseCatapult(sim: Simulation): number {
  const [first] = fortressCatapults(sim);
  if (first === undefined) throw new Error('no catapult placed');
  removeVehicle(sim.world, ctxOf(sim), first, 'destroyed');
  const seen = Math.ceil(sim.tick / TICKS_PER_SECOND);
  const beat = Math.ceil((seen + CATAPULT_RESPAWN_SECONDS) / REFILL_EVERY_SECONDS) * REFILL_EVERY_SECONDS;
  return beat * TICKS_PER_SECOND;
}

describe('map escalation - catapults', () => {
  it('raises a lost fortress catapult at its spot once its wait ran out, on a refill beat', () => {
    const sim = setupWithCatapult();
    const beat = loseCatapult(sim);
    sim.run(beat - 1 - sim.tick);
    expect(fortressCatapults(sim)).toEqual([]);
    sim.step();
    const raised = fortressCatapults(sim);
    expect(raised).toHaveLength(1);
    const at = sim.world.get(raised[0] as Entity, Vehicle).guard;
    expect(at).toEqual({ hx: CATAPULT_SPOT.x, hy: CATAPULT_SPOT.y });
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('raises none once the match counted the fortress seat out', () => {
    const sim = setupWithCatapult({ inMatch: true });
    const beat = loseCatapult(sim);
    markPlayerDead(sim.world, FORTRESS);
    sim.run(beat + REFILL_EVERY_SECONDS * TICKS_PER_SECOND - sim.tick);
    expect(fortressCatapults(sim)).toEqual([]);
  });
});
