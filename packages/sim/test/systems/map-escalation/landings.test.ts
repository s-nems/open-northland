import { MapModules, type MapNotice } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { FOG_MODE, mapEscalationProgress, Position, Rider, Vehicle } from '../../../src/components/index.js';
import { TICKS_PER_SECOND } from '../../../src/core/loop.js';
import type { Entity } from '../../../src/ecs/world.js';
import { exportSaveGame, parseSaveGame, restoreSimulation, serializeSaveGame } from '../../../src/index.js';
import { nodeOfPosition, positionOfNode } from '../../../src/nav/halfcell.js';
import { endDrive } from '../../../src/systems/vehicles/movement.js';
import { FOG_STATE } from '../../../src/systems/vision/state.js';
import {
  coast,
  coastWorld,
  distance,
  LAKE,
  LANDING,
  LANDINGS,
  LAUNCH_SECONDS,
  NOTICE,
  PLAYER,
  raiderMen,
  raiderShips,
  runUntil,
  SCRIPT,
  SECOND_LANDING,
  SHIP_SEATS,
  SIEGE,
  TARGET,
} from '../../fixtures/map-escalation/coast.js';

/** Below the four sea men's share of the five sent, so counting them dead would end the attack. */
const SCRAP_END_PCT = 50;

describe('map escalation - a sea landing', () => {
  it('sails one full ship to the landing point, sets its men ashore in the attack and leaves the map', () => {
    const sim = coastWorld();
    let landing: { wave: number; seats: readonly number[]; notice: MapNotice } | null = null;
    runUntil(sim, LAUNCH_SECONDS + 1, () => {
      for (const ev of sim.events.current())
        if (ev.kind === 'mapEscalationLanding')
          landing = { wave: ev.wave, seats: ev.seats, notice: ev.notice };
      return landing !== null;
    });
    expect(landing).toEqual({ wave: 1, seats: [PLAYER], notice: NOTICE });
    const [ship, ...others] = raiderShips(sim);
    if (ship === undefined) throw new Error('no ship');
    expect(others).toEqual([]);
    expect(distance(sim, ship, { x: LANDING.spawnX, y: LANDING.spawnY })).toBeLessThan(4);
    // One ship only: its seats and the commander's, every man aboard and counted in the attack.
    const aboard = raiderMen(sim).filter((e) => sim.world.has(e, Rider));
    expect(aboard).toHaveLength(SHIP_SEATS + 1);
    for (const e of aboard) expect(sim.world.has(e, Position)).toBe(false);
    expect(mapEscalationProgress(sim.world).attack?.men).toEqual(expect.arrayContaining(aboard));

    expect(runUntil(sim, 60, () => aboard.every((e) => sim.world.has(e, Position)))).toBe(true);
    for (const e of aboard) {
      expect(sim.world.has(e, Rider)).toBe(false);
      expect(distance(sim, e, LANDING)).toBeLessThan(6);
    }
    expect(runUntil(sim, 60, () => raiderShips(sim).length === 0)).toBe(true);
    expect(mapEscalationProgress(sim.world).landings).toEqual([]);

    // Ashore they are the raider's soldiers like the land band, and its Attack task takes them on.
    const ashore = distance(sim, aboard[0] as Entity, TARGET);
    sim.run(20 * TICKS_PER_SECOND);
    expect(distance(sim, aboard[0] as Entity, TARGET)).toBeLessThan(ashore);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('sends a two-ship wave from two spawn points to two landing points, each ship full', () => {
    const [launch] = SIEGE.attacks.launches;
    if (launch === undefined) throw new Error('no launch');
    const sim = coastWorld({
      ...SIEGE,
      attacks: { ...SIEGE.attacks, launches: [{ ...launch, ships: 2 }] },
    });
    runUntil(sim, LAUNCH_SECONDS + 1, () => raiderShips(sim).length > 0);
    const ships = raiderShips(sim);
    expect(ships).toHaveLength(2);
    const points = [LANDING, SECOND_LANDING];
    const spawns = points.map((p) => ({ x: p.spawnX, y: p.spawnY }));
    ships.forEach((ship, i) => {
      expect(distance(sim, ship, spawns[i] as (typeof spawns)[number])).toBeLessThan(4);
    });
    const aboard = raiderMen(sim).filter((e) => sim.world.has(e, Rider));
    expect(aboard).toHaveLength(2 * (SHIP_SEATS + 1));
    expect(mapEscalationProgress(sim.world).attack?.sent).toBe(aboard.length + 1);

    expect(runUntil(sim, 60, () => aboard.every((e) => sim.world.has(e, Position)))).toBe(true);
    for (const point of points)
      expect(
        aboard.filter((e) => distance(sim, e, point) < 6),
        `${point.x},${point.y}`,
      ).toHaveLength(SHIP_SEATS + 1);
    expect(runUntil(sim, 60, () => raiderShips(sim).length === 0)).toBe(true);
  });

  it('shows each ship under way to the targeted seats the whole voyage, out and back', () => {
    const REVEAL_NODES = 6;
    const sim = coastWorld({
      ...SIEGE,
      landings: { ...LANDINGS, revealNodes: REVEAL_NODES },
    });
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
    const fog = sim.fog;
    if (fog === undefined) throw new Error('no fog');
    const seenUnder = (ship: Entity) => {
      const at = sim.world.get(ship, Position);
      const node = nodeOfPosition(at.x, at.y);
      return fog.stateAt(PLAYER, node.hx >> 1, node.hy >> 1);
    };
    // Beyond the player's own sight, the open sea is unexplored until a ship sails there.
    expect(fog.stateAt(PLAYER, LANDING.spawnX >> 1, LANDING.spawnY >> 1)).toBe(FOG_STATE.UNEXPLORED);
    runUntil(sim, LAUNCH_SECONDS + 1, () => raiderShips(sim).length > 0);
    const [ship] = raiderShips(sim);
    if (ship === undefined) throw new Error('no ship');
    let watched = 0;
    runUntil(sim, 120, () => {
      if (!sim.world.isAlive(ship)) return true;
      expect(seenUnder(ship)).toBe(FOG_STATE.VISIBLE);
      watched++;
      return false;
    });
    expect(watched).toBeGreaterThan(LAUNCH_SECONDS * TICKS_PER_SECOND);
  });

  it('scraps a ship that can no longer reach its shore, its men leaving the attack instead of counting dead', () => {
    const sim = coastWorld(
      { ...SIEGE, attacks: { ...SIEGE.attacks, endDeadPct: SCRAP_END_PCT } },
      coast(true),
    );
    runUntil(sim, LAUNCH_SECONDS + 1, () => raiderShips(sim).length > 0);
    const [ship] = raiderShips(sim);
    if (ship === undefined) throw new Error('no ship');
    const ashore = raiderMen(sim).filter((e) => !sim.world.has(e, Rider));
    expect(ashore).toHaveLength(1);
    // Lifted onto the inland lake mid-voyage, the ship finds no way to its shore.
    const at = positionOfNode(LAKE.x, LAKE.y);
    Object.assign(sim.world.mut(ship, Position), at);
    endDrive(sim.world, ship);
    Object.assign(sim.world.mut(ship, Vehicle), { task: 'none', moored: false, mooring: null });
    const ended: string[] = [];
    runUntil(sim, 3, () => {
      for (const ev of sim.events.current()) if (ev.kind === 'mapEscalationAttackEnded') ended.push(ev.cause);
      return false;
    });
    expect(sim.world.isAlive(ship)).toBe(false);
    expect(raiderMen(sim)).toEqual(ashore);
    expect(ended).toEqual([]);
    expect(mapEscalationProgress(sim.world).attack).toMatchObject({ sent: 1, men: ashore });
  });

  it('keeps a ship under way through a save', () => {
    const sim = coastWorld();
    runUntil(sim, LAUNCH_SECONDS + 2, () => false);
    expect(mapEscalationProgress(sim.world).landings).toHaveLength(1);
    const save = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const restored = restoreSimulation(save, {
      content: sim.content,
      map: coast(),
      mapAiScript: SCRIPT,
      mapModules: MapModules.parse({ siege: SIEGE }),
    });
    expect(restored.hashState()).toBe(sim.hashState());
  });
});
