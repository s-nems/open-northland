import { describe, expect, it } from 'vitest';
import {
  AiControl,
  aiControlEntity,
  Building,
  ComputerStrategy,
  computerModuleEnables,
  FOG_MODE,
  type MilitaryPlan,
  type MilitaryPosture,
  Owner,
  Settler,
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
import type { TerrainGraph } from '../../../../../src/nav/terrain/index.js';
import { moduleBeatDue } from '../../../../../src/systems/ai-shared/cadence.js';
import { planSettlementDefence } from '../../../../../src/systems/ai-shared/military/settlement-defence.js';
import {
  militaryModule,
  type OperationView,
  RAID_BAND_MEN,
  RAID_COOLDOWN_TICKS,
  RAID_LOOK_EVERY_DECISIONS,
  seatOperationsOf,
  selectPosture,
} from '../../../../../src/systems/computer-player/index.js';
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
/** How many men the seat musters: a raid's band plus a wave's worth at home. */
const ARMY = 16;
/** Decision ticks a case steps through, one decision apart. */
const DECISION = 48;

function aiSim(): Simulation {
  return new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(128, 96) });
}

function ctxOf(sim: Simulation, tick: number, fog?: FogState): SystemContext {
  return {
    content: aiContent(),
    rng: new Rng(SEED),
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

function holdPosture(sim: Simulation, plan: MilitaryPlan, posture: MilitaryPosture): void {
  let carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) {
    carrier = sim.world.create();
    sim.world.add(carrier, AiControl, {
      player: SEAT,
      computerEnabled: true,
      modules: computerModuleEnables(),
      mapAiEnabled: true,
      difficulty: 'hard',
    });
  }
  const inputs = {
    ownPoints: 0,
    targetOwner: null,
    targetPoints: null,
    strongestPoints: null,
    threatInTicks: null,
    underAttack: false,
    raidTargetKnown: false,
  };
  const military = { ...selectPosture(plan, inputs, null), posture, plan, decidedAt: 0, challenger: null };
  const economy = { archetype: 'standard' as const, sides: [], evidence: [], decidedAt: 0, challenger: null };
  if (sim.world.has(carrier, ComputerStrategy)) sim.world.remove(carrier, ComputerStrategy);
  sim.world.add(carrier, ComputerStrategy, { economy, military });
}

/** A harassing seat with its barracks and men at the door, an enemy headquarters, and the enemy's
 *  gatherers at `gatherers`. */
function raidWorld(gatherers: readonly { x: number; y: number }[], army = ARMY, jobType = BOWMAN) {
  const sim = aiSim();
  holdPosture(sim, 'harasser', 'harass');
  const barracks = place(sim, BARRACKS_TYPE, BARRACKS, SEAT);
  const terrain = terrainOf(sim);
  const door = terrain.coordsOf(interactionCell(sim.world, ctxOf(sim, 0), terrain, barracks));
  const men = band(sim, army, door, jobType);
  place(sim, HQ_TYPE, FOE_HQ, FOE);
  const prey = gatherers.flatMap((at) => spawnAt(sim, [at], COLLECTOR, FOE));
  return { sim, barracks, door, men, prey };
}

/** The first of the seat's decisions from `from` on which it looks for a raid. */
function lookFrom(from: number): number {
  let tick = Math.ceil(from / DECISION) * DECISION;
  while (!moduleBeatDue(tick, SEAT, RAID_LOOK_EVERY_DECISIONS)) tick += DECISION;
  return tick;
}

/** The seat's first decision that looks for a raid. */
const LOOK = lookFrom(0);

function decide(sim: Simulation, tick: number, fog?: FogState) {
  return militaryModule.run(sim.world, ctxOf(sim, tick, fog), SEAT);
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

  it('turns back once the enemy fighters it sees near it weigh as much as it does', () => {
    const { sim, door } = raidWorld([EXPOSED], ARMY, SPEARMAN);
    decide(sim, LOOK);
    decide(sim, LOOK + DECISION);
    expect(onlyRaid(sim).state).toBe('moving');
    band(sim, RAID_BAND_MEN, door, SPEARMAN, FOE);
    decide(sim, LOOK + 2 * DECISION);
    const raid = onlyRaid(sim);
    expect(raid.state).toBe('withdrawing');
    expect(raid.reason).toBe('outmatched');
  });

  it('waits out its cooldown before the next raid forms', () => {
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
    decide(sim, lookFrom(ended + DECISION));
    expect(raids(sim)).toEqual([]);
    decide(sim, lookFrom(ended + RAID_COOLDOWN_TICKS));
    expect(onlyRaid(sim).id).toBeGreaterThan(first);
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
});
