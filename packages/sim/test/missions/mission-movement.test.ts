import { describe, expect, it } from 'vitest';
import {
  Building,
  Damaged,
  Health,
  HOUSE_BEHAVIOUR,
  MissionObjectId,
  Owner,
  ownerOf,
  PathFollow,
  Person,
  PlayerOrder,
  Position,
  Resting,
  setHouseBehaviour,
  WALK_RANGE_NODES,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { playerCommand, type Simulation } from '../../src/index.js';
import { type HalfCellNode, hexDistance, nodeOfPosition } from '../../src/nav/halfcell.js';
import { REGENERATION_HITPOINTS_PER_TICK } from '../../src/systems/index.js';
import { type MissionResultOp, SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import {
  firingMission,
  firingSim,
  HUT_LARGE,
  houseContent,
  LOAD_PASS,
  MAP_NODES,
  missionSim,
  PASS_TICKS,
  POINT,
  runLoadPass,
  SOLDIER,
  scriptedSim,
  spawn,
  VIKING,
} from './support.js';

/**
 * The results that walk, teleport, halt, heal and damage what a script addresses. Every one reads the
 * map, so every world here is the shared grass lattice. A fixture that must stand or walk before the
 * script judges it enables the script after {@link IDLE_TICKS}; an idle settler drifts a few nodes in
 * that time, which is why the areas below are wide and the outsiders are far.
 */

const OWNER = 2;
/** Another player, whose standing fighter a band's places avoid. */
const STRANGER = 3;
const GROUP = 55;
const FAR = { hx: POINT.hx + 16, hy: POINT.hy };
const OUTSIDE = { hx: POINT.hx + 20, hy: POINT.hy };
/** Wide enough to hold a settler that has been idling since the world started. */
const AREA = 10;
/** Ticks a fixture idles before its script is enabled. */
const IDLE_TICKS = 35;
/** Ticks a walk is under way before the script halts it. */
const WALKING_TICKS = 20;
/** One tick in, a setup placement stands. */
const PLACED = 1;
/** The landing spread one teleport line leaves: a batch fans out around the destination. */
const LANDING_SPREAD = 6;
/** A band SendHuman finds on one node, as `SetHumanX` spawns it. */
const BAND = 6;
/** A band wide enough that its outer places lie past a lone man's formation. */
const THINNED_BAND = 12;

function nodeOf(sim: Simulation, e: Entity): HalfCellNode {
  const at = sim.world.get(e, Position);
  return nodeOfPosition(at.x, at.y);
}

function humansOf(sim: Simulation, player: number): Entity[] {
  return [...sim.world.query(Person)].filter((e) => ownerOf(sim.world, e) === player);
}

function crowdNear(sim: Simulation, player: number, point: HalfCellNode, range: number): number {
  return humansOf(sim, player).filter((e) => hexDistance(nodeOf(sim, e), point) <= range).length;
}

describe('SendHuman', () => {
  it('hands every human with the id a walk order and leaves the rest alone', () => {
    const sim = firingSim([{ opcode: 'SendHuman', humanId: GROUP, point: FAR }]);
    spawn(sim, { player: OWNER, missionId: GROUP });
    spawn(sim, { player: OWNER, missionId: GROUP });
    spawn(sim, { player: OWNER });
    sim.run(LOAD_PASS);
    expect(humansOf(sim, OWNER).filter((e) => sim.world.has(e, PlayerOrder))).toHaveLength(2);
  });

  it('sends a civilian past the signpost confinement a player order obeys', () => {
    // Corner to corner is the one walk this map holds that is longer than the walk range.
    const corner = { hx: 0, hy: 0 };
    const beyond = { hx: MAP_NODES - 1, hy: MAP_NODES - 1 };
    expect(hexDistance(corner, beyond)).toBeGreaterThan(WALK_RANGE_NODES);
    const sim = firingSim([{ opcode: 'SendHuman', humanId: GROUP, point: beyond }]);
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    spawn(sim, { player: OWNER, missionId: GROUP, at: corner });
    spawn(sim, { player: OWNER, at: corner });
    sim.run(2);
    const [scripted, ordered] = humansOf(sim, OWNER);
    if (scripted === undefined || ordered === undefined) throw new Error('two settlers expected');
    sim.enqueue(playerCommand(OWNER, { kind: 'moveUnit', entity: ordered, x: beyond.hx, y: beyond.hy }));
    sim.run(LOAD_PASS);
    expect(sim.world.has(scripted, PlayerOrder)).toBe(true);
    expect(sim.world.has(ordered, PlayerOrder)).toBe(false);
  });

  it('sends fighters on an attack-move and a civilian on a walk', () => {
    const sim = firingSim([{ opcode: 'SendHuman', humanId: GROUP, point: FAR }]);
    spawn(sim, { player: OWNER, missionId: GROUP, job: SOLDIER });
    spawn(sim, { player: OWNER, missionId: GROUP });
    sim.run(LOAD_PASS);
    const [soldier, civilian] = humansOf(sim, OWNER);
    if (soldier === undefined || civilian === undefined) throw new Error('two settlers expected');
    expect(sim.world.get(soldier, PlayerOrder)).toMatchObject({
      scripted: true,
      attackMove: expect.anything(),
    });
    expect(sim.world.get(civilian, PlayerOrder).attackMove).toBeUndefined();
  });

  it('gives a stacked band a place each around the point', () => {
    const sim = firingSim([{ opcode: 'SendHuman', humanId: GROUP, point: FAR }]);
    for (let i = 0; i < BAND; i++) spawn(sim, { player: OWNER, missionId: GROUP, job: SOLDIER });
    sim.run(LOAD_PASS);
    const goals = humansOf(sim, OWNER).map((e) => sim.world.get(e, PlayerOrder).attackMove?.goal);
    expect(new Set(goals).size).toBe(BAND);
    for (const goal of goals) {
      if (goal === undefined) throw new Error('march expected');
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('map expected');
      expect(hexDistance({ hx: terrain.xOf(goal), hy: terrain.yOf(goal) }, FAR)).toBeLessThanOrEqual(BAND);
    }
  });

  it('keeps the march a repeating line already gave', () => {
    const sim = firingSim([
      { opcode: 'SendHuman', humanId: GROUP, point: FAR },
      { opcode: 'ActivateMission', missionIndex: 0 },
    ]);
    spawn(sim, { player: OWNER, missionId: GROUP, job: SOLDIER });
    sim.run(LOAD_PASS);
    const [soldier] = humansOf(sim, OWNER);
    if (soldier === undefined) throw new Error('no settler');
    const march = sim.world.get(soldier, PlayerOrder).attackMove;
    expect(march).toBeDefined();
    sim.run(PASS_TICKS);
    expect(sim.world.get(soldier, PlayerOrder).attackMove).toBe(march);
    expect(sim.world.has(soldier, PathFollow)).toBe(true);
  });

  it('keeps the marches of a band a fight has thinned', () => {
    const sim = firingSim([
      { opcode: 'SendHuman', humanId: GROUP, point: FAR },
      { opcode: 'ActivateMission', missionIndex: 0 },
    ]);
    for (let i = 0; i < THINNED_BAND; i++) spawn(sim, { player: OWNER, missionId: GROUP, job: SOLDIER });
    sim.run(LOAD_PASS);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('map expected');
    const reachOf = (e: Entity): number => {
      const goal = sim.world.get(e, PlayerOrder).attackMove?.goal;
      if (goal === undefined) throw new Error('march expected');
      return hexDistance({ hx: terrain.xOf(goal), hy: terrain.yOf(goal) }, FAR);
    };
    // The outermost places survive, the band that held them does not.
    const band = humansOf(sim, OWNER).sort((a, b) => reachOf(b) - reachOf(a));
    const [outer, ...fallen] = band;
    if (outer === undefined) throw new Error('no settler');
    for (const e of fallen) sim.world.destroy(e);
    const march = sim.world.get(outer, PlayerOrder).attackMove;
    sim.run(PASS_TICKS);
    expect(sim.world.get(outer, PlayerOrder).attackMove).toBe(march);
  });

  it('redirects a marching band a later line sends elsewhere', () => {
    const sim = missionSim([
      firingMission([
        { opcode: 'SendHuman', humanId: GROUP, point: FAR },
        { opcode: 'ActivateMission', missionIndex: 1 },
      ]),
      {
        successfullIf: SUCCESSFUL_IF.all,
        active: false,
        visible: false,
        goals: [{ opcode: 'TimeGone', seconds: 1 }],
        results: [{ opcode: 'SendHuman', humanId: GROUP, point: POINT }],
      },
    ]);
    spawn(sim, { player: OWNER, missionId: GROUP, job: SOLDIER, at: OUTSIDE });
    sim.run(LOAD_PASS);
    const [soldier] = humansOf(sim, OWNER);
    if (soldier === undefined) throw new Error('no settler');
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('map expected');
    const goalNear = (point: HalfCellNode): boolean => {
      const goal = sim.world.get(soldier, PlayerOrder).attackMove?.goal;
      return goal !== undefined && hexDistance({ hx: terrain.xOf(goal), hy: terrain.yOf(goal) }, point) <= 1;
    };
    expect(goalNear(FAR)).toBe(true);
    sim.run(2 * PASS_TICKS);
    expect(goalNear(POINT)).toBe(true);
  });

  it('seats the men a repeating line adds on places nobody holds', () => {
    const sim = firingSim([
      { opcode: 'SendHuman', humanId: GROUP, point: FAR },
      { opcode: 'ActivateMission', missionIndex: 0 },
    ]);
    for (let i = 0; i < BAND; i++) spawn(sim, { player: OWNER, missionId: GROUP, job: SOLDIER });
    sim.run(LOAD_PASS);
    for (let i = 0; i < BAND; i++) spawn(sim, { player: OWNER, missionId: GROUP, job: SOLDIER });
    sim.run(PASS_TICKS);
    const goals = humansOf(sim, OWNER).map((e) => sim.world.tryGet(e, PlayerOrder)?.attackMove?.goal);
    expect(goals.filter((goal) => goal !== undefined)).toHaveLength(2 * BAND);
    expect(new Set(goals).size).toBe(2 * BAND);
  });

  it('keeps a walking civilian band on its places', () => {
    const sim = firingSim([
      { opcode: 'SendHuman', humanId: GROUP, point: FAR },
      { opcode: 'ActivateMission', missionIndex: 0 },
    ]);
    for (let i = 0; i < BAND; i++) spawn(sim, { player: OWNER, missionId: GROUP });
    sim.run(LOAD_PASS);
    const band = humansOf(sim, OWNER);
    const orders = band.map((e) => sim.world.get(e, PlayerOrder));
    sim.run(PASS_TICKS);
    band.forEach((e, i) => expect(sim.world.tryGet(e, PlayerOrder)).toBe(orders[i]));
  });

  it("gives no place on a stranger's standing fighter", () => {
    const sim = scriptedSim([firingMission([{ opcode: 'SendHuman', humanId: GROUP, point: FAR }])]);
    spawn(sim, { player: STRANGER, job: SOLDIER, at: FAR });
    spawn(sim, { player: OWNER, missionId: GROUP, job: SOLDIER });
    sim.run(PLACED);
    const [stranger] = humansOf(sim, STRANGER);
    if (stranger === undefined) throw new Error('no stranger');
    expect(nodeOf(sim, stranger)).toEqual(FAR);
    runLoadPass(sim);
    const [soldier] = humansOf(sim, OWNER);
    if (soldier === undefined) throw new Error('no settler');
    const goal = sim.world.get(soldier, PlayerOrder).attackMove?.goal;
    expect(goal).toBeDefined();
    expect(goal).not.toBe(sim.terrain?.nodeAt(FAR.hx, FAR.hy));
  });

  it('walks the ordered group toward the point', () => {
    const sim = firingSim([{ opcode: 'SendHuman', humanId: GROUP, point: FAR }]);
    spawn(sim, { player: OWNER, missionId: GROUP });
    sim.run(LOAD_PASS);
    const [walker] = humansOf(sim, OWNER);
    if (walker === undefined) throw new Error('no settler');
    const before = hexDistance(nodeOf(sim, walker), FAR);
    sim.run(120);
    expect(hexDistance(nodeOf(sim, walker), FAR)).toBeLessThan(before);
  });
});

describe('MoveHuman', () => {
  it('teleports the group to the point in the pass that runs it', () => {
    const sim = firingSim([{ opcode: 'MoveHuman', humanId: GROUP, point: FAR }]);
    spawn(sim, { player: OWNER, missionId: GROUP });
    spawn(sim, { player: OWNER, missionId: GROUP });
    sim.run(LOAD_PASS);
    expect(crowdNear(sim, OWNER, FAR, LANDING_SPREAD)).toBe(2);
  });

  it('carries at most twenty of them', () => {
    const sim = firingSim([{ opcode: 'MoveHuman', humanId: GROUP, point: FAR }]);
    for (let i = 0; i < 25; i++) spawn(sim, { player: OWNER, missionId: GROUP });
    sim.run(LOAD_PASS);
    expect(crowdNear(sim, OWNER, FAR, LANDING_SPREAD)).toBe(20);
  });
});

describe('MoveUnitsInArea', () => {
  const move: Extract<MissionResultOp, { opcode: 'MoveUnitsInArea' }> = {
    opcode: 'MoveUnitsInArea',
    player: OWNER,
    point: POINT,
    range: AREA,
    index: FAR.hx,
    extra: FAR.hy,
  };

  it('carries the player’s free humans out of the area', () => {
    const sim = firingSim([move]);
    spawn(sim, { player: OWNER });
    spawn(sim, { player: OWNER });
    spawn(sim, { player: OWNER + 1 }); // another player's: not this line's to move
    sim.run(LOAD_PASS);
    expect(crowdNear(sim, OWNER, FAR, LANDING_SPREAD)).toBe(2);
    expect(crowdNear(sim, OWNER + 1, FAR, LANDING_SPREAD)).toBe(0);
  });

  it('carries at most twenty of them', () => {
    const sim = firingSim([move]);
    for (let i = 0; i < 25; i++) spawn(sim, { player: OWNER });
    sim.run(LOAD_PASS);
    expect(crowdNear(sim, OWNER, FAR, LANDING_SPREAD)).toBe(20);
  });

  it('does nothing when the destination lies inside the area', () => {
    const sim = scriptedSim([firingMission([{ ...move, index: POINT.hx + 1, extra: POINT.hy }])]);
    spawn(sim, { player: OWNER });
    sim.run(IDLE_TICKS);
    const [stayer] = humansOf(sim, OWNER);
    if (stayer === undefined) throw new Error('no settler');
    const before = nodeOf(sim, stayer);
    runLoadPass(sim);
    expect(hexDistance(nodeOf(sim, stayer), before)).toBeLessThanOrEqual(1);
  });

  it('leaves a human that is indoors where it is', () => {
    const sim = scriptedSim([firingMission([move])]);
    spawn(sim, { player: OWNER });
    sim.run(IDLE_TICKS);
    const [indoors] = humansOf(sim, OWNER);
    if (indoors === undefined) throw new Error('no settler');
    sim.world.add(indoors, Resting, { at: indoors });
    const before = nodeOf(sim, indoors);
    runLoadPass(sim);
    expect(hexDistance(nodeOf(sim, indoors), before)).toBeLessThanOrEqual(1);
  });
});

describe('StopHumanByPlayerId', () => {
  it('halts a walking human of the player where it stands', () => {
    const sim = scriptedSim([firingMission([{ opcode: 'StopHumanByPlayerId', player: OWNER }])]);
    spawn(sim, { player: OWNER });
    sim.run(PLACED);
    const [walker] = humansOf(sim, OWNER);
    if (walker === undefined) throw new Error('no settler');
    sim.enqueueSetup({ kind: 'moveUnit', entity: walker, x: FAR.hx, y: FAR.hy });
    sim.run(WALKING_TICKS);
    runLoadPass(sim);
    const halted = nodeOf(sim, walker);
    sim.run(60);
    expect(hexDistance(nodeOf(sim, walker), halted)).toBeLessThanOrEqual(3);
  });
});

describe('RemoveHumansNearPos', () => {
  it('clears every human in the area, whoever owns it', () => {
    const sim = firingSim([{ opcode: 'RemoveHumansNearPos', point: POINT, range: AREA }]);
    spawn(sim, { player: OWNER });
    spawn(sim, { player: OWNER + 1 });
    spawn(sim, { player: OWNER, at: OUTSIDE });
    sim.run(LOAD_PASS);
    expect([...sim.world.query(Person)]).toHaveLength(1);
  });
});

describe('HealHumansInArea', () => {
  it('refills every human in the area and nobody outside it', () => {
    const sim = scriptedSim([firingMission([{ opcode: 'HealHumansInArea', point: POINT, range: AREA }])]);
    spawn(sim, { player: OWNER });
    spawn(sim, { player: OWNER, at: OUTSIDE });
    sim.run(IDLE_TICKS);
    const wounded = humansOf(sim, OWNER);
    for (const e of wounded) sim.world.mut(e, Health).hitpoints = 1;
    runLoadPass(sim);
    const pools = wounded.map((e) => sim.world.get(e, Health));
    expect(pools.filter((h) => h.hitpoints === h.max)).toHaveLength(1);
    // The one outside has only its own point-a-tick regeneration over the pass's one tick.
    expect(pools.filter((h) => h.hitpoints === 1 + REGENERATION_HITPOINTS_PER_TICK)).toHaveLength(1);
  });

  it('sets a human a temple raised above its max back to the max', () => {
    const sim = scriptedSim([firingMission([{ opcode: 'HealHumansInArea', point: POINT, range: AREA }])]);
    spawn(sim, { player: OWNER });
    sim.run(IDLE_TICKS);
    const [blessed] = humansOf(sim, OWNER);
    if (blessed === undefined) throw new Error('no human spawned');
    const over = sim.world.get(blessed, Health).max + 1;
    sim.world.mut(blessed, Health).hitpoints = over;
    runLoadPass(sim);
    expect(sim.world.get(blessed, Health).hitpoints).toBe(sim.world.get(blessed, Health).max);
  });
});

describe('the house damage results', () => {
  const damage: Extract<MissionResultOp, { opcode: 'RemoveHPsOfHousesInArea' }> = {
    opcode: 'RemoveHPsOfHousesInArea',
    player: OWNER,
    point: POINT,
    range: 4,
    amount: 10,
  };

  /** One finished house of `owner` standing on the point, its script not yet enabled; `HUT_LARGE`
   *  carries hit points and no build bill. */
  function houseSim(result: MissionResultOp, owner = OWNER): Simulation {
    const sim = scriptedSim([firingMission([result])], houseContent());
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HUT_LARGE,
      tribe: VIKING,
      x: POINT.hx,
      y: POINT.hy,
      owner,
    });
    sim.run(PLACED);
    return sim;
  }

  function theHouse(sim: Simulation): Entity {
    const [house] = [...sim.world.query(Building, Health)];
    if (house === undefined) throw new Error('no house');
    return house;
  }

  it('takes hit points off the player’s houses in the area', () => {
    const sim = houseSim(damage);
    const before = sim.world.get(theHouse(sim), Health).hitpoints;
    runLoadPass(sim);
    expect(sim.world.get(theHouse(sim), Health).hitpoints).toBe(before - damage.amount);
    expect(sim.world.get(theHouse(sim), Damaged).lastHitTick).not.toBeNull(); // a blow, not a short pool
  });

  it('spares a house a script made indestructible', () => {
    const sim = houseSim(damage);
    const house = theHouse(sim);
    setHouseBehaviour(sim.world, house, HOUSE_BEHAVIOUR.INDESTRUCTIBLE, true);
    const before = sim.world.get(house, Health).hitpoints;
    runLoadPass(sim);
    expect(sim.world.get(house, Health).hitpoints).toBe(before);
  });

  it('spares the object id the X variant names', () => {
    const sim = houseSim({ ...damage, opcode: 'RemoveHPsOfHousesInAreaX', objectId: GROUP });
    const house = theHouse(sim);
    sim.world.add(house, MissionObjectId, { id: GROUP });
    const before = sim.world.get(house, Health).hitpoints;
    runLoadPass(sim);
    expect(sim.world.get(house, Health).hitpoints).toBe(before);
  });

  it('leaves another player’s house alone', () => {
    const sim = houseSim(damage, OWNER + 1);
    const before = sim.world.get(theHouse(sim), Health).hitpoints;
    runLoadPass(sim);
    expect(sim.world.get(theHouse(sim), Health).hitpoints).toBe(before);
  });

  it('razes a house it drains, through the ordinary reaper', () => {
    const sim = houseSim({ ...damage, amount: 100_000 });
    runLoadPass(sim);
    sim.step();
    expect([...sim.world.query(Building)].filter((e) => sim.world.has(e, Owner))).toHaveLength(0);
  });
});
