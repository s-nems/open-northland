import {
  components,
  type Entity,
  type HalfCellNode,
  type MissionResultOp,
  playerCommand,
  type SimEvent,
  type Simulation,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapWorld } from './real-map-world.js';

const { Vehicle } = components;

/**
 * The raids of a story map whose script lands each wave by ship: a ship spawned off the raiders'
 * shore, the men attached to it, and a dock order on the defended coast. A ship that spawns unmoored
 * drops the men it cannot board, and one that cannot dock never lands them, so the defence objective,
 * which waits for every raider's death, never completes.
 */
const MAP_ID = 'mroczny_swiat';
/** Ticks a wave may take to board and sail to its dock. */
const SAIL_BUDGET_TICKS = 3000;

interface Wave {
  readonly mission: number;
  readonly ship: Extract<MissionResultOp, { opcode: 'SetVehicle' }>;
  readonly men: Extract<MissionResultOp, { opcode: 'SetHumanX' }>;
  readonly dock: HalfCellNode;
}

function scriptedWaves(sim: Simulation): Wave[] {
  const waves: Wave[] = [];
  for (const [mission, { results }] of (sim.missions?.missions ?? []).entries()) {
    const ship = results.find((op) => op.opcode === 'SetVehicle');
    const men = results.find((op) => op.opcode === 'SetHumanX');
    const dock = results.find((op) => op.opcode === 'DockVehicle');
    if (ship?.opcode !== 'SetVehicle' || men?.opcode !== 'SetHumanX' || dock?.opcode !== 'DockVehicle')
      continue;
    if (dock.vehicleId === ship.vehicleId) waves.push({ mission, ship, men, dock: dock.point });
  }
  return waves;
}

function spawnedVehicle(sim: Simulation): Entity {
  const created = sim.events.current().find((e: SimEvent) => e.kind === 'vehicleCreated');
  if (created?.kind !== 'vehicleCreated') throw new Error('the ship was not created');
  return created.entity;
}

function spawnedSettler(sim: Simulation, before: ReadonlySet<Entity>): Entity {
  const fresh = [...sim.world.query(components.Settler)].find((e) => !before.has(e));
  if (fresh === undefined) throw new Error('the raider was not spawned');
  return fresh;
}

describe.runIf(hasRealIr())(`${MAP_ID}: the scripted raids`, () => {
  it('moor every raiding ship where it spawns and dock it on the defended coast', async () => {
    const { sim } = await realMapWorld({ mapId: MAP_ID, aiSeats: [], missions: false });
    const waves = scriptedWaves(sim);
    expect(waves.length).toBeGreaterThan(0);
    for (const { mission, ship, men, dock } of waves) {
      const label = `wave of mission ${mission}`;
      sim.enqueueSetup({
        kind: 'createVehicle',
        vehicleType: ship.vehicleType,
        x: ship.point.hx,
        y: ship.point.hy,
        tribe: ship.tribe,
        owner: ship.player,
      });
      sim.step();
      const vehicle = spawnedVehicle(sim);
      expect(sim.world.get(vehicle, Vehicle).moored, `${label} spawns moored`).toBe(true);
      const before = new Set(sim.world.query(components.Settler));
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: men.job,
        tribe: men.tribe,
        x: men.point.hx,
        y: men.point.hy,
        owner: men.player,
      });
      sim.step();
      const raider = spawnedSettler(sim, before);
      sim.enqueue(playerCommand(ship.player, { kind: 'attachToVehicle', entity: raider, vehicle }));
      sim.enqueue(playerCommand(ship.player, { kind: 'dockVehicle', vehicle, x: dock.hx, y: dock.hy }));
      let docked = false;
      const refusals: string[] = [];
      for (let tick = 0; tick < SAIL_BUDGET_TICKS && !docked; tick++) {
        sim.step();
        for (const e of sim.events.current()) {
          if (e.kind === 'vehicleDocked' && e.entity === vehicle) docked = true;
          if (e.kind === 'vehicleMoveRefused' && e.entity === vehicle) refusals.push(e.reason);
        }
      }
      expect(refusals, label).toEqual([]);
      expect(docked, `${label} docks`).toBe(true);
      expect(sim.world.get(vehicle, Vehicle).mooring, label).toEqual(dock);
    }
  }, 300_000);
});
