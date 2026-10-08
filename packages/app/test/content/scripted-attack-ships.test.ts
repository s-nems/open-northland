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

const { Vehicle, vehiclePassengers } = components;

/**
 * The raids of a story map whose script lands each wave by ship: men spawned on the raiders' shore, a
 * ship beside it, the men attached to it, a dock order on the defended coast and a detach a few
 * seconds later. A ship that spawns unmoored or drops men on the way to its door leaves them on the
 * far shore, and one that cannot dock never lands them, so the defence objective, which waits for
 * every raider's death, never completes.
 */
const MAP_ID = 'mroczny_swiat';
/** Ticks a wave may take to board and sail to its dock. */
const SAIL_BUDGET_TICKS = 3000;

interface Wave {
  readonly mission: number;
  readonly ship: Extract<MissionResultOp, { opcode: 'SetVehicle' }>;
  readonly men: readonly Extract<MissionResultOp, { opcode: 'SetHumanX' }>[];
  readonly dock: HalfCellNode;
}

function scriptedWaves(sim: Simulation): Wave[] {
  const waves: Wave[] = [];
  for (const [mission, { results }] of (sim.missions?.missions ?? []).entries()) {
    const ship = results.find((op) => op.opcode === 'SetVehicle');
    const dock = results.find((op) => op.opcode === 'DockVehicle');
    const men = results.filter((op) => op.opcode === 'SetHumanX');
    if (ship?.opcode !== 'SetVehicle' || dock?.opcode !== 'DockVehicle' || dock.vehicleId !== ship.vehicleId)
      continue;
    waves.push({ mission, ship, men, dock: dock.point });
  }
  return waves;
}

function spawnedVehicle(sim: Simulation): Entity {
  const created = sim.events.current().find((e: SimEvent) => e.kind === 'vehicleCreated');
  if (created?.kind !== 'vehicleCreated') throw new Error('the ship was not created');
  return created.entity;
}

describe.runIf(hasRealIr())(`${MAP_ID}: the scripted raids`, () => {
  it('moor every raiding ship where it spawns and land its whole crew on the defended coast', async () => {
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
      for (const line of men) {
        for (let i = 0; i < line.amount; i++) {
          sim.enqueueSetup({
            kind: 'spawnSettler',
            jobType: line.job,
            tribe: line.tribe,
            x: line.point.hx,
            y: line.point.hy,
            owner: line.player,
          });
        }
      }
      sim.step();
      const raiders = [...sim.world.query(components.Settler)].filter((e) => !before.has(e));
      expect(raiders.length, label).toBe(men.reduce((sum, line) => sum + line.amount, 0));
      for (const raider of raiders) {
        sim.enqueue(playerCommand(ship.player, { kind: 'attachToVehicle', entity: raider, vehicle }));
      }
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
      const state = sim.world.get(vehicle, Vehicle);
      expect(state.mooring, label).toEqual(dock);
      expect(vehiclePassengers(state).length, `${label} carries every raider`).toBe(raiders.length);
    }
  }, 300_000);
});
