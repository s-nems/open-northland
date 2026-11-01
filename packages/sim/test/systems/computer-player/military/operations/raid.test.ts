import { describe, expect, it } from 'vitest';
import {
  AiControl,
  aiControlEntity,
  Building,
  type ComputerDifficulty,
  ComputerOperations,
  ComputerStrategy,
  computerModuleEnables,
  DefenceMode,
  type EconomicArchetype,
  FOG_MODE,
  type MilitaryPlan,
  type MilitaryPosture,
  Militia,
  OPERATION_KINDS,
  type OperationKind,
  Owner,
  Position,
  Settler,
  Stance,
  WaveMarch,
} from '../../../../../src/components/index.js';
import { CommandQueue } from '../../../../../src/core/command-queue.js';
import { PersonalNames } from '../../../../../src/core/personal-names.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import {
  EventBuffer,
  exportSaveGame,
  parseSaveGame,
  Rng,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../../../src/index.js';
import { type HalfCellNode, nodeManhattan, positionOfNode } from '../../../../../src/nav/halfcell.js';
import type { TerrainGraph } from '../../../../../src/nav/terrain/index.js';
import { moduleBeatDue } from '../../../../../src/systems/ai-shared/cadence.js';
import { planSettlementDefence } from '../../../../../src/systems/ai-shared/military/settlement-defence.js';
import {
  militaryModule,
  type OperationView,
  RAID_BAND_MEN,
  RAID_DELAY_MAX_TICKS,
  RAID_DELAY_MIN_TICKS,
  RAID_LOOK_EVERY_DECISIONS,
  seatOperationsOf,
  selectPosture,
} from '../../../../../src/systems/computer-player/index.js';
import { NEVER_READY } from '../../../../../src/systems/computer-player/military/operations/index.js';
import {
  RAID_HOME_STANCE,
  RAID_STANCE,
} from '../../../../../src/systems/computer-player/military/operations/raid.js';
import {
  flankRoute,
  RAID_TOWER_CLEARANCE_NODES,
} from '../../../../../src/systems/computer-player/military/operations/raid-target.js';
import type { SystemContext } from '../../../../../src/systems/index.js';
import { interactionCell } from '../../../../../src/systems/settlers/targets/index.js';
import { cellOfNode } from '../../../../../src/systems/vision/gates.js';
import type { FogState } from '../../../../../src/systems/vision/state.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../../fixtures/terrain.js';

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const HOME_TYPE = 2;
const BARRACKS_TYPE = 12;
const TOWER_TYPE = 15;
const COLLECTOR = 8;
const SPEARMAN = 32;
const BOWMAN = 40;
/** A seed whose first wave draw is small enough for the army a case packs at the door. */
const SEED = 7;

const BARRACKS = { x: 30, y: 30 };
const FOE_HQ = { x: 110, y: 70 };
/** A gatherer in the open, far from anything that defends him. */
const EXPOSED = { x: 90, y: 20 };
/** A tower, and a gatherer nearer the seat than {@link EXPOSED} but under it. */
const FOE_TOWER = { x: 70, y: 60 };
const GUARDED = { x: 68, y: 58 };
/** A tower the band may pass, its reach clear of {@link EXPOSED}; a spot in that reach; and a tower whose
 *  reach covers {@link EXPOSED}. */
const PASSED_TOWER = { x: 60, y: 40 };
const NEAR_PASSED_TOWER = { hx: 60, hy: 14 };
const OVER_EXPOSED = { x: 90, y: 36 };
/** A third seat, at war with the seat like {@link FOE}. */
const OTHER_FOE = 4;
/** How many men the seat musters: a raid's band plus a wave's worth at home. */
const ARMY = 16;
/** Decision ticks a case steps through, one decision apart. */
const DECISION = 48;

function aiSim(): Simulation {
  return new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(128, 96) });
}

function ctxOf(sim: Simulation, tick: number, fog?: FogState, seed = SEED): SystemContext {
  return {
    content: aiContent(),
    rng: new Rng(seed),
    names: new PersonalNames(1, []),
    tick,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
    ...(fog !== undefined ? { fog } : {}),
  };
}

function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
  return sim.terrain;
}

function place(sim: Simulation, buildingType: number, at: { x: number; y: number }, owner: number): Entity {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
  for (const e of sim.world.query(Building, Owner)) {
    if (sim.world.get(e, Building).buildingType === buildingType && sim.world.get(e, Owner).player === owner)
      return e;
  }
  throw new Error(`setup: building ${buildingType} of ${owner} missing`);
}

function spawnAt(
  sim: Simulation,
  spots: readonly { x: number; y: number }[],
  jobType: number,
  owner: number,
): Entity[] {
  const before = new Set(sim.world.query(Settler));
  for (const { x, y } of spots)
    sim.enqueueSetup({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner });
  sim.step();
  return [...sim.world.query(Settler)].filter((e) => !before.has(e));
}

/** `count` men of `jobType` on a tight grid around `at`, inside the door's gather ring. */
function band(sim: Simulation, count: number, at: { x: number; y: number }, jobType: number, owner = SEAT) {
  const spots = Array.from({ length: count }, (_, i) => ({
    x: at.x - 4 + 2 * (i % 5),
    y: at.y + 2 * Math.floor(i / 5),
  }));
  return spawnAt(sim, spots, jobType, owner);
}

function holdPosture(
  sim: Simulation,
  plan: MilitaryPlan,
  posture: MilitaryPosture,
  seat: { difficulty?: ComputerDifficulty; archetype?: EconomicArchetype } = {},
): void {
  let carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) {
    carrier = sim.world.create();
    sim.world.add(carrier, AiControl, {
      player: SEAT,
      computerEnabled: true,
      modules: computerModuleEnables(),
      mapAiEnabled: true,
      difficulty: seat.difficulty ?? 'hard',
    });
  }
  const inputs = {
    ownPoints: 0,
    ownMen: 0,
    targetOwner: null,
    targetOverSea: false,
    targetPoints: null,
    strongestPoints: null,
    threatInTicks: null,
    underAttack: false,
    raidTargetKnown: false,
    holdAimed: false,
  };
  const military = { ...selectPosture(plan, inputs, null), posture, plan, decidedAt: 0, challenger: null };
  const economy = {
    archetype: seat.archetype ?? 'standard',
    sides: [],
    evidence: [],
    decidedAt: 0,
  };
  if (sim.world.has(carrier, ComputerStrategy)) sim.world.remove(carrier, ComputerStrategy);
  sim.world.add(carrier, ComputerStrategy, { economy, military });
}

/** The tick the seat's next raid may form from; undefined before any draw. */
function raidReadyAt(sim: Simulation): number | undefined {
  const carrier = aiControlEntity(sim.world, SEAT);
  return carrier === null ? undefined : sim.world.tryGet(carrier, ComputerOperations)?.readyAt.raid;
}

/** The seat's raid cadence drawn and already due, so a case opens its raid on its first look. */
function raidDue(sim: Simulation): void {
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('setup: the seat has no computer carrier');
  const readyAt = {} as Record<OperationKind, number>;
  for (const kind of OPERATION_KINDS) readyAt[kind] = 0;
  readyAt.raid = 1;
  sim.world.add(carrier, ComputerOperations, { nextId: 1, operations: [], readyAt });
}

/** A harassing seat with its barracks and men at the door, an enemy headquarters, and the enemy's
 *  gatherers at `gatherers`; its raid due at once unless `drawn` is false. */
function raidWorld(
  gatherers: readonly { x: number; y: number }[],
  army = ARMY,
  jobType = BOWMAN,
  drawn = true,
) {
  const sim = aiSim();
  holdPosture(sim, 'harasser', 'harass');
  if (drawn) raidDue(sim);
  const barracks = place(sim, BARRACKS_TYPE, BARRACKS, SEAT);
  const terrain = terrainOf(sim);
  const door = terrain.coordsOf(interactionCell(sim.world, ctxOf(sim, 0), terrain, barracks));
  const men = band(sim, army, door, jobType);
  place(sim, HQ_TYPE, FOE_HQ, FOE);
  const prey = gatherers.flatMap((at) => spawnAt(sim, [at], COLLECTOR, FOE));
  return { sim, barracks, door, men, prey };
}

function teleport(sim: Simulation, e: Entity, at: HalfCellNode): void {
  const p = positionOfNode(at.hx, at.hy);
  const live = sim.world.mut(e, Position);
  live.x = p.x;
  live.y = p.y;
}

/** The first of the seat's decisions from `from` on which it looks for a raid. */
function lookFrom(from: number): number {
  let tick = Math.ceil(from / DECISION) * DECISION;
  while (!moduleBeatDue(tick, SEAT, RAID_LOOK_EVERY_DECISIONS)) tick += DECISION;
  return tick;
}

/** The seat's last decision before `before` on which it looks for a raid. */
function lastLookBefore(before: number): number {
  let tick = Math.floor((before - 1) / DECISION) * DECISION;
  while (!moduleBeatDue(tick, SEAT, RAID_LOOK_EVERY_DECISIONS)) tick -= DECISION;
  return tick;
}

/** The seat's first decision that looks for a raid. */
const LOOK = lookFrom(0);

function decide(sim: Simulation, tick: number, fog?: FogState, seed = SEED) {
  return militaryModule.run(sim.world, ctxOf(sim, tick, fog, seed), SEAT);
}

function raids(sim: Simulation): OperationView[] {
  return seatOperationsOf(sim.world, SEAT).filter((op) => op.kind === 'raid');
}

function onlyRaid(sim: Simulation): OperationView {
  const [raid, ...more] = raids(sim);
  if (raid === undefined || more.length > 0) throw new Error(`expected one raid, got ${raids(sim).length}`);
  return raid;
}

describe('raid operations', () => {
  it('never shares a man with the wave the muster launches, nor with the home defence', () => {
    const { sim, barracks } = raidWorld([EXPOSED], ARMY, SPEARMAN);
    decide(sim, LOOK);
    const raid = onlyRaid(sim);
    expect(raid.members).toHaveLength(RAID_BAND_MEN);
    const wave = sim.world.tryGet(barracks, WaveMarch);
    expect(wave, 'the rest marched as a wave').toBeDefined();
    const assault = seatOperationsOf(sim.world, SEAT).find((op) => op.kind === 'assault');
    expect(assault?.members).toEqual([...(wave?.men ?? [])]);
    for (const e of raid.members) {
      expect(wave?.men).not.toContain(e);
      expect(assault?.members).not.toContain(e);
    }
    const defence = planSettlementDefence(sim.world, ctxOf(sim, DECISION), terrainOf(sim), SEAT, true);
    for (const e of raid.members) expect(defence.available).not.toContain(e);
  });

  it('takes archers first and leaves the home floor', () => {
    const { sim } = raidWorld([EXPOSED], 6, SPEARMAN);
    const terrain = terrainOf(sim);
    const archers = band(sim, 2, terrain.coordsOf(terrain.nodeAtClamped(BARRACKS.x, BARRACKS.y + 8)), BOWMAN);
    decide(sim, LOOK);
    // Eight free men less a floor of five leave three: both archers and one spearman.
    const raid = onlyRaid(sim);
    expect(raid.members).toHaveLength(3);
    for (const e of archers) expect(raid.members).toContain(e);
  });

  it('strikes an exposed gatherer over a nearer one under a tower', () => {
    const { sim, prey } = raidWorld([EXPOSED, GUARDED]);
    place(sim, TOWER_TYPE, FOE_TOWER, FOE);
    decide(sim, LOOK);
    expect(onlyRaid(sim).target.entity).toBe(prey[0]);
  });

  it('turns back once the enemy fighters it sees near it outweigh it', () => {
    const { sim, door } = raidWorld([EXPOSED], ARMY, SPEARMAN);
    decide(sim, LOOK);
    decide(sim, LOOK + DECISION);
    expect(onlyRaid(sim).state).toBe('moving');
    band(sim, RAID_BAND_MEN, door, SPEARMAN, FOE);
    decide(sim, LOOK + 2 * DECISION);
    expect(onlyRaid(sim).state, 'an equal band does not turn it').toBe('moving');
    band(sim, 1, door, SPEARMAN, FOE);
    decide(sim, LOOK + 3 * DECISION);
    const raid = onlyRaid(sim);
    expect(raid.state).toBe('withdrawing');
    expect(raid.reason).toBe('outmatched');
  });

  it('walks out in a stance that seeks no fight and never attack-moves', () => {
    const { sim } = raidWorld([EXPOSED], ARMY, SPEARMAN);
    const commands = [...decide(sim, LOOK)];
    const raiders = onlyRaid(sim).members;
    for (const e of raiders)
      expect(commands).toContainEqual({ kind: 'setStance', entity: e, mode: RAID_STANCE });
    for (let k = 1; k <= 3; k++) commands.push(...decide(sim, LOOK + k * DECISION));
    const walks = commands.filter(
      (c) => 'entity' in c && raiders.includes(c.entity) && c.kind !== 'setStance',
    );
    expect(walks.length).toBeGreaterThan(0);
    for (const c of walks) expect(c.kind).toBe('moveUnit');
  });

  it('counts the militia it sees near it among the forces that outweigh it', () => {
    const { sim, door } = raidWorld([EXPOSED], ARMY, SPEARMAN);
    decide(sim, LOOK);
    decide(sim, LOOK + DECISION);
    const armed = band(sim, 3 * RAID_BAND_MEN, door, COLLECTOR, FOE);
    decide(sim, LOOK + 2 * DECISION);
    expect(onlyRaid(sim).state, 'unarmed civilians turn no band').toBe('moving');
    const terrain = terrainOf(sim);
    const at = terrain.nodeAtClamped(door.x, door.y);
    for (const e of armed)
      sim.world.add(e, Militia, {
        zone: e,
        leash: { at, radius: 0 },
        previousJob: COLLECTOR,
        previousWorkplace: null,
        releaseTick: 0,
        quarry: null,
      });
    decide(sim, LOOK + 3 * DECISION);
    expect(onlyRaid(sim).reason).toBe('outmatched');
  });

  it("weighs every enemy's towers over a target, not only its owner's", () => {
    const { sim, prey } = raidWorld([EXPOSED, { x: 110, y: 6 }]);
    place(sim, TOWER_TYPE, OVER_EXPOSED, OTHER_FOE);
    decide(sim, LOOK);
    expect(onlyRaid(sim).target.entity, "the gatherer under the other enemy's tower is passed").toBe(prey[1]);
  });

  it('turns back once an alarmed building has the band in its shooting reach', () => {
    const { sim, door } = raidWorld([EXPOSED], ARMY, SPEARMAN);
    decide(sim, LOOK);
    decide(sim, LOOK + DECISION);
    const house = place(sim, HOME_TYPE, { x: door.x + 24, y: door.y }, FOE);
    decide(sim, LOOK + 2 * DECISION);
    expect(onlyRaid(sim).state, 'a house at peace turns no band').toBe('moving');
    sim.world.add(house, DefenceMode, {});
    decide(sim, LOOK + 3 * DECISION);
    expect(onlyRaid(sim).reason).toBe('defenceMode');
  });

  it('walks on past a tower its way keeps clear of, turns back once its target comes under one, and walks home the way it came', () => {
    const { sim } = raidWorld([EXPOSED], ARMY, SPEARMAN);
    place(sim, TOWER_TYPE, PASSED_TOWER, FOE);
    decide(sim, LOOK);
    decide(sim, LOOK + DECISION);
    const out = onlyRaid(sim);
    expect(out.state).toBe('moving');
    const [flank] = out.raid?.waypoints ?? [];
    if (flank === undefined) throw new Error('the way round the tower has a waypoint');
    for (const e of out.members) teleport(sim, e, NEAR_PASSED_TOWER);
    decide(sim, LOOK + 2 * DECISION);
    expect(onlyRaid(sim).state, 'standing in its reach').toBe('moving');
    for (const e of out.members) teleport(sim, e, flank);
    decide(sim, LOOK + 3 * DECISION);
    expect(onlyRaid(sim).raid?.leg, 'past the waypoint').toBe(1);
    place(sim, TOWER_TYPE, OVER_EXPOSED, FOE);
    decide(sim, LOOK + 4 * DECISION);
    const back = onlyRaid(sim);
    expect(back.reason).toBe('towerInReach');
    expect(back.raid?.leg, 'the waypoint still to walk back through').toBe(1);
    decide(sim, LOOK + 5 * DECISION);
    expect(onlyRaid(sim).raid?.leg, 'back at the waypoint, it heads home').toBe(0);
    expect(onlyRaid(sim).state).toBe('withdrawing');
  });

  it('waits a drawn 20 to 60 minutes before the next raid forms', () => {
    const { sim } = raidWorld([EXPOSED]);
    // An enemy army at his headquarters, far from the gatherer, outweighs the seat: no wave takes the men
    // the next raid needs.
    band(sim, 2 * ARMY, FOE_HQ, SPEARMAN, FOE);
    decide(sim, LOOK);
    const first = onlyRaid(sim).id;
    decide(sim, LOOK + DECISION);
    holdPosture(sim, 'harasser', 'defend');
    decide(sim, LOOK + 2 * DECISION);
    expect(onlyRaid(sim).reason).toBe('postureChanged');
    holdPosture(sim, 'harasser', 'harass');
    // The band never left the door, so it is home at once.
    const ended = LOOK + 3 * DECISION;
    decide(sim, ended);
    expect(onlyRaid(sim).state).toBe('done');
    const readyAt = raidReadyAt(sim) ?? 0;
    expect(readyAt).toBeGreaterThanOrEqual(ended + RAID_DELAY_MIN_TICKS);
    expect(readyAt).toBeLessThanOrEqual(ended + RAID_DELAY_MAX_TICKS);
    decide(sim, lastLookBefore(readyAt));
    expect(raids(sim)).toEqual([]);
    decide(sim, lookFrom(readyAt));
    expect(onlyRaid(sim).id).toBeGreaterThan(first);
  });

  it('hands its men back in the attacking stance once home', () => {
    const { sim } = raidWorld([EXPOSED], ARMY, SPEARMAN);
    band(sim, 2 * ARMY, FOE_HQ, SPEARMAN, FOE);
    decide(sim, LOOK);
    const raiders = onlyRaid(sim).members;
    for (const e of raiders) sim.world.mut(e, Stance).mode = RAID_STANCE;
    holdPosture(sim, 'harasser', 'defend');
    decide(sim, LOOK + DECISION);
    expect(onlyRaid(sim).reason).toBe('postureChanged');
    const commands = decide(sim, LOOK + 2 * DECISION);
    expect(onlyRaid(sim).state).toBe('done');
    for (const e of raiders)
      expect(commands).toContainEqual({ kind: 'setStance', entity: e, mode: RAID_HOME_STANCE });
  });

  it('draws its first raid 20 to 60 minutes past its peace end, the harasser plan always', () => {
    const { sim } = raidWorld([EXPOSED], ARMY, BOWMAN, false);
    band(sim, 2 * ARMY, FOE_HQ, SPEARMAN, FOE);
    decide(sim, LOOK);
    expect(raids(sim), 'no raid on the drawing decision').toEqual([]);
    const readyAt = raidReadyAt(sim) ?? 0;
    expect(readyAt).toBeGreaterThanOrEqual(LOOK + RAID_DELAY_MIN_TICKS);
    expect(readyAt).toBeLessThanOrEqual(LOOK + RAID_DELAY_MAX_TICKS);
    decide(sim, lookFrom(readyAt));
    expect(onlyRaid(sim).state).toBe('forming');
  });

  it('keeps a raid under way through a save', () => {
    const { sim } = raidWorld([EXPOSED]);
    decide(sim, LOOK);
    const bytes = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: aiContent(),
      map: grassNodeMap(128, 96),
    });
    expect(seatOperationsOf(restored.world, SEAT)).toEqual(seatOperationsOf(sim.world, SEAT));
    expect(serializeSaveGame(exportSaveGame(restored))).toBe(bytes);
  });

  it('never targets a gatherer it has not seen', () => {
    const { sim, prey } = raidWorld([EXPOSED]);
    const fog = sim.fog;
    if (fog === undefined) throw new Error('setup: a mapped sim has fog');
    fog.activeMode = FOG_MODE.CLASSIC_FOG_OF_WAR;
    const home = cellOfNode(BARRACKS.x, BARRACKS.y);
    fog.stampSight(SEAT, home.cx, home.cy, 6);
    decide(sim, LOOK, fog);
    expect(raids(sim)).toEqual([]);
    const seen = cellOfNode(EXPOSED.x, EXPOSED.y);
    fog.stampSight(SEAT, seen.cx, seen.cy, 2);
    decide(sim, lookFrom(LOOK + DECISION), fog);
    expect(onlyRaid(sim).target.entity).toBe(prey[0]);
  });

  describe('flank raids of a hard seat', () => {
    /** The raid world with the seat building up at home instead of harassing. */
    function buildingUp(seat: Parameters<typeof holdPosture>[3] = {}) {
      const world = raidWorld([EXPOSED]);
      const carrier = aiControlEntity(world.sim.world, SEAT);
      if (carrier !== null && seat.difficulty !== undefined)
        world.sim.world.mut(carrier, AiControl).difficulty = seat.difficulty;
      holdPosture(world.sim, 'balanced', 'prepare', seat);
      return world;
    }

    it('raids from any plan and posture but defence', () => {
      const { sim } = buildingUp();
      decide(sim, LOOK);
      expect(onlyRaid(sim).members).toHaveLength(RAID_BAND_MEN);
      holdPosture(sim, 'balanced', 'defend');
      decide(sim, LOOK + DECISION);
      expect(onlyRaid(sim).reason).toBe('postureChanged');
    });

    it('leaves the medium seat and the island start at home', () => {
      for (const seat of [{ difficulty: 'medium' as const }, { archetype: 'islands' as const }]) {
        const { sim } = buildingUp(seat);
        decide(sim, LOOK);
        expect(raids(sim), JSON.stringify(seat)).toEqual([]);
      }
    });

    it('raids in some matches and never in others, by the match seed', () => {
      const drawn = new Set<number>();
      for (let seed = 1; seed <= 8; seed++) {
        const { sim } = buildingUp();
        const carrier = aiControlEntity(sim.world, SEAT);
        if (carrier !== null) sim.world.remove(carrier, ComputerOperations);
        decide(sim, LOOK, undefined, seed);
        const readyAt = raidReadyAt(sim) ?? 0;
        if (readyAt !== NEVER_READY) {
          expect(readyAt).toBeGreaterThanOrEqual(LOOK + RAID_DELAY_MIN_TICKS);
          expect(readyAt).toBeLessThanOrEqual(LOOK + RAID_DELAY_MAX_TICKS);
        }
        drawn.add(readyAt === NEVER_READY ? NEVER_READY : 0);
        decide(sim, lookFrom(LOOK + RAID_DELAY_MAX_TICKS), undefined, seed);
        expect(raids(sim).length, `seed ${seed}`).toBe(readyAt === NEVER_READY ? 0 : 1);
      }
      expect(drawn.size, 'both a raiding and a peaceful seat among the seeds').toBe(2);
    });

    it('never raids a map-scripted seat', () => {
      const { sim } = buildingUp();
      sim.world.add(sim.world.create(), AiControl, {
        player: FOE,
        computerEnabled: true,
        modules: computerModuleEnables({ collectResources: false }),
        mapAiEnabled: true,
        difficulty: 'hard',
      });
      decide(sim, LOOK);
      expect(raids(sim)).toEqual([]);
    });
  });

  describe('the way to the target', () => {
    const HOME = { hx: 10, hy: 48 };
    const POCKET = { hx: 64, hy: 48 };
    const target = { ...POCKET, entity: null, owner: null };
    const tower = (hx: number, hy: number) => ({ at: { hx, hy }, postedPoints: 0 });
    const clearOf = (towers: readonly { at: HalfCellNode }[], at: HalfCellNode) =>
      towers.every((t) => nodeManhattan(t.at, at) > RAID_TOWER_CLEARANCE_NODES);

    it('goes straight in with nothing in the way, and round a tower that stands in it', () => {
      const sim = aiSim();
      const terrain = terrainOf(sim);
      const home = terrain.nodeAtClamped(HOME.hx, HOME.hy);
      expect(flankRoute(sim.world, terrain, home, target, [])).toEqual([]);
      const towers = [tower(37, 48)];
      const route = flankRoute(sim.world, terrain, home, target, towers);
      expect(route?.length).toBeGreaterThan(0);
      for (const at of route ?? []) expect(clearOf(towers, at), JSON.stringify(at)).toBe(true);
    });

    it('finds no way into a pocket a ring of towers closes', () => {
      const sim = aiSim();
      const terrain = terrainOf(sim);
      const ring = [
        [36, 0],
        [-36, 0],
        [0, 36],
        [0, -36],
        [25, 25],
        [25, -25],
        [-25, 25],
        [-25, -25],
      ].map(([dx = 0, dy = 0]) => tower(POCKET.hx + dx, POCKET.hy + dy));
      expect(clearOf(ring, POCKET), 'the pocket itself lies clear').toBe(true);
      // A home in the map's corner, clear of the ring's reach.
      const home = terrain.nodeAtClamped(4, 4);
      expect(flankRoute(sim.world, terrain, home, target, ring)).toBeNull();
      expect(flankRoute(sim.world, terrain, home, target, ring), 'again under the same belief').toBeNull();
      const near = { hx: 20, hy: 6, entity: null, owner: null };
      expect(flankRoute(sim.world, terrain, home, near, ring), 'a target the corner reaches').toEqual([]);
      expect(flankRoute(sim.world, terrain, home, target, []), 'the ring gone').toEqual([]);
      expect(flankRoute(sim.world, terrain, home, near, []), 'another target, open belief').toEqual([]);
      expect(flankRoute(sim.world, terrain, home, target, ring), 'the ring back').toBeNull();
    });
  });
});
