import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  Building,
  Engagement,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  MoveGoal,
  mapEscalationProgress,
  Owner,
  PlayerOrder,
  Position,
  Settler,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { nodeManhattan, nodeOfPosition, positionOfNode } from '../../../src/nav/halfcell.js';
import {
  coastWorld,
  distance,
  LAUNCH_SECONDS,
  PLAYER,
  raiderMen,
  runUntil,
  SECOND_HOUSE,
  TARGET,
} from '../../fixtures/map-escalation/coast.js';

/** As far from its aim as a march goal may lie and still be on it, in half-cell nodes. */
const ON_AIM = 8;
/** How far west of its aim a man stands idle, in half-cell nodes: inside the band's strike reach. */
const IDLE_BY_AIM = 8;

function playerHouseAt(sim: Simulation, at: { x: number; y: number }): Entity {
  const house = [...sim.world.query(Building, Owner, Position)].find(
    (e) => sim.world.get(e, Owner).player === PLAYER && distance(sim, e, at) === 0,
  );
  if (house === undefined) throw new Error('no house there');
  return house;
}

function band(sim: Simulation): Entity[] {
  return raiderMen(sim).filter((e) => sim.world.has(e, Position));
}

/** Whether the man attack-moves on `at` or strikes `target`. */
function onAim(sim: Simulation, e: Entity, target: Entity): boolean {
  if (sim.world.tryGet(e, AttackOrder)?.target === target) return true;
  const march = sim.world.tryGet(e, PlayerOrder)?.attackMove;
  const terrain = sim.terrain;
  if (march === undefined || terrain === undefined) return false;
  const goal = terrain.coordsOf(march.goal);
  const at = sim.world.get(target, Position);
  return nodeManhattan({ hx: goal.x, hy: goal.y }, nodeOfPosition(at.x, at.y)) <= ON_AIM;
}

const allOnAim = (sim: Simulation, target: Entity) => () =>
  band(sim).length > 0 && band(sim).every((e) => onAim(sim, e, target));

describe('map escalation - the aim', () => {
  it('attack-moves every attack man on the headquarters, out of the raider’s hands, then fights it', () => {
    const sim = coastWorld();
    runUntil(sim, LAUNCH_SECONDS + 1, () => false);
    const headquarters = playerHouseAt(sim, TARGET);
    expect(mapEscalationProgress(sim.world).focus).toEqual([
      { seat: PLAYER, kind: 'headquarters', entity: headquarters },
    ]);
    const [man] = band(sim);
    if (man === undefined) throw new Error('no band');
    expect(hasMissionBehaviour(sim.world, man, MISSION_BEHAVIOUR.NOT_CONTROLLABLE)).toBe(true);
    // A march, not a strike from across the map: no fight marker until an enemy is met.
    expect(sim.world.tryGet(man, PlayerOrder)?.attackMove).toBeDefined();
    expect(sim.world.has(man, Engagement)).toBe(false);

    const strikes = (e: Entity) =>
      sim.world.tryGet(e, Engagement)?.target === headquarters ||
      sim.world.tryGet(e, AttackOrder)?.target === headquarters;
    expect(runUntil(sim, 60, () => band(sim).some(strikes))).toBe(true);
  });

  it('marches again on the aim when a man fell idle', () => {
    const sim = coastWorld();
    runUntil(sim, LAUNCH_SECONDS + 1, () => false);
    const headquarters = playerHouseAt(sim, TARGET);
    const [man] = band(sim);
    if (man === undefined) throw new Error('no band');
    sim.world.remove(man, PlayerOrder);
    sim.world.remove(man, MoveGoal);
    expect(runUntil(sim, 2, () => onAim(sim, man, headquarters))).toBe(true);
  });

  it('strikes the aim as an assault once a man stands idle within reach of it', () => {
    const sim = coastWorld();
    runUntil(sim, LAUNCH_SECONDS + 1, () => false);
    const headquarters = playerHouseAt(sim, TARGET);
    const [man] = band(sim);
    if (man === undefined) throw new Error('no band');
    const by = positionOfNode(TARGET.x - IDLE_BY_AIM, TARGET.y);
    const at = sim.world.mut(man, Position);
    at.x = by.x;
    at.y = by.y;
    sim.world.remove(man, PlayerOrder);
    sim.world.remove(man, MoveGoal);
    sim.world.remove(man, Engagement);
    expect(runUntil(sim, 3, () => sim.world.tryGet(man, AttackOrder)?.target === headquarters)).toBe(true);
    expect(sim.world.get(man, AttackOrder).assault).toBe(true);
  });

  it('moves to another building once the headquarters falls, then to the seat’s people', () => {
    const sim = coastWorld();
    runUntil(sim, LAUNCH_SECONDS + 1, () => false);

    sim.world.destroy(playerHouseAt(sim, TARGET));
    const second = playerHouseAt(sim, SECOND_HOUSE);
    expect(runUntil(sim, 3, allOnAim(sim, second))).toBe(true);
    expect(mapEscalationProgress(sim.world).focus).toEqual([
      { seat: PLAYER, kind: 'building', entity: second },
    ]);

    sim.world.destroy(second);
    const villager = [...sim.world.query(Settler, Owner)].find(
      (e) => sim.world.get(e, Owner).player === PLAYER,
    );
    if (villager === undefined) throw new Error('no villager');
    expect(runUntil(sim, 3, allOnAim(sim, villager))).toBe(true);
    expect(mapEscalationProgress(sim.world).focus).toEqual([
      { seat: PLAYER, kind: 'person', entity: villager },
    ]);
  });
});
