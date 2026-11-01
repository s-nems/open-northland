import { describe, expect, it } from 'vitest';
import {
  AiControl,
  AiOrder,
  AttackOrder,
  Building,
  ComputerStrategy,
  computerModuleEnables,
  DefenceMode,
  Engagement,
  JobAssignment,
  MapAiDefence,
  MISSION_BEHAVIOUR,
  NoRegeneration,
  Owner,
  PlayerOrder,
  Position,
  Settler,
  Stance,
  setDiplomacyStance,
  stampMissionBehaviour,
} from '../../../src/components/index.js';
import { CommandQueue } from '../../../src/core/command-queue.js';
import { aiCommand, type Command } from '../../../src/core/commands/index.js';
import { PersonalNames } from '../../../src/core/personal-names.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  EventBuffer,
  exportSaveGame,
  parseSaveGame,
  positionOfNode,
  Rng,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
  type TerrainMap,
} from '../../../src/index.js';
import type { TerrainGraph } from '../../../src/nav/terrain/index.js';
import { mapDefenceLeashSystem } from '../../../src/systems/ai-shared/military/map-defence-leash.js';
import {
  BIG_ATTACK_FIGHTERS,
  planSettlementDefence,
  settlementDefenceSystem,
} from '../../../src/systems/ai-shared/military/settlement-defence.js';
import { commandSystem } from '../../../src/systems/command/index.js';
import {
  AI_SEAT_SLOT_STEP_TICKS,
  COMPUTER_DECISION_INTERVAL_TICKS,
  MAP_AI_PEACE_ARCHERS_PER_CLASS,
  MAP_AI_SEAT_SLOT_STEP_TICKS,
  MILITARY_DECISION_PHASE,
  militaryModule,
  THREAT_STAND_DOWN_MARGIN_NODES,
  TOWER_GARRISON_ARCHERS,
  takeCensus,
  threatWatchNodes,
  WAVE_MIN_SOLDIERS,
} from '../../../src/systems/computer-player/index.js';
import { standsAtPost } from '../../../src/systems/conflict/tower-post.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { setAiControl } from '../../../src/systems/orders/ai.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { entityNode } from '../../../src/systems/spatial/nodes.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

/**
 * The strategic AI defending its own ground: the alarm it rings over its townspeople when enemy fighters
 * close on a shelter, the archers it walls into every tower it raises, and the band it throws at a raider
 * instead of marching it out.
 */

const VIKING = 1;
/** Another tribe than the archers' own. */
const FRANK = VIKING + 1;
const SEAT = 2;
/** The seat's first settlement-defence decision, its slot plus the military phase, while a computer
 *  controller runs it and while the map AI alone does. */
const CONTROLLED_DEFENCE_TICK = SEAT * AI_SEAT_SLOT_STEP_TICKS + MILITARY_DECISION_PHASE;
const MAP_AI_DEFENCE_TICK = SEAT * MAP_AI_SEAT_SLOT_STEP_TICKS + MILITARY_DECISION_PHASE;
const FOE = 3;
/** A seat a lobby peace binds to {@link SEAT}. */
const PARTNER = 4;
/** A peace still holding through every decision these cases run. */
const PEACE_UNTIL = 1000;
/** How far east of a raider a partner's headquarters stands: nearer him than the seat's own town. */
const PARTNER_HQ_OFFSET = 8;
const HQ_TYPE = 1;
const BARRACKS_TYPE = 12;
const TOWER_TYPE = 15;
const WALL_TYPE = 16;
const CIVILIST = 6;
const SPEARMAN = 32;
const BOWMAN = 40;

/** The seat's town. The tower stands far enough south that no raider threatens both at once. */
const SEAT_HQ = { x: 24, y: 20 };
const SEAT_TOWER = { x: 24, y: 84 };
/** West of the headquarters, so a raider standing off it to the EAST is measured against the HQ alone. */
const BARRACKS = { x: 16, y: 20 };
/** A headquarters well south of the barracks, and a spot far from both, for the rally cases. */
const BASE_AWAY_FROM_BARRACKS = { x: 24, y: 60 };
const AWAY_FROM_BOTH = { x: 80, y: 40 };
/** The enemy seat - outside every watch band of the seat's own buildings. */
const FOE_HQ = { x: 112, y: 20 };
/** A seed whose first launch roll is 0, so a formed band always leaves (mirrors the muster suite). */
const EAGER_SEED = 7;
/** Long enough for a posted archer to walk the few nodes to his tower and step inside. */
const WALK_IN_TICKS = 200;

/** A map split by a full-height water column at `waterX`: the two banks never connect. */
function splitNodeMap(width: number, height: number, waterX: number): TerrainMap {
  const GRASS = 0;
  const WATER = 1;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let y = 0; y < height; y++) typeIds[y * width + waterX] = WATER;
  return { resolution: 'half-cell', width, height, typeIds };
}

function aiSim(map: TerrainMap = grassNodeMap(128, 96)): Simulation {
  return new Simulation({ seed: 1, content: aiContent(), map });
}

function ctxOf(sim: Simulation, seed = EAGER_SEED): SystemContext {
  return {
    content: aiContent(),
    rng: new Rng(seed),
    names: new PersonalNames(1, []),
    tick: 0,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function terrainOf(sim: Simulation): TerrainGraph {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
  return terrain;
}

function place(sim: Simulation, buildingType: number, at: { x: number; y: number }, owner = SEAT): Entity {
  const before = new Set(sim.world.query(Building));
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
  const placed = [...sim.world.query(Building)].find((e) => !before.has(e));
  if (placed === undefined) throw new Error(`setup: building ${buildingType} was refused`);
  return placed;
}

/** Standing settlers, two nodes apart so no two share a node. */
function spawn(
  sim: Simulation,
  count: number,
  at: { x: number; y: number },
  jobType: number,
  owner = SEAT,
): Entity[] {
  const before = new Set(sim.world.query(Settler));
  for (let i = 0; i < count; i++) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType,
      x: at.x + 2 * (i % 8),
      y: at.y + 2 * Math.floor(i / 8),
      tribe: VIKING,
      owner,
    });
  }
  sim.step();
  return [...sim.world.query(Settler)].filter((e) => !before.has(e));
}

/** An unfinished building of `owner` - a foundation with a live hitpoint pool that can be razed. */
function placeSite(
  sim: Simulation,
  buildingType: number,
  at: { x: number; y: number },
  owner = SEAT,
): Entity {
  const before = new Set(sim.world.query(Building));
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType,
    x: at.x,
    y: at.y,
    tribe: VIKING,
    owner,
    underConstruction: true,
  });
  sim.step();
  const site = [...sim.world.query(Building)].find((e) => !before.has(e));
  if (site === undefined) throw new Error('setup: the building site was refused');
  return site;
}

/** The watch band every case measures against - the house bow's reach in the fixture content. */
function watchOf(sim: Simulation): number {
  return threatWatchNodes(ctxOf(sim), VIKING);
}

/** A settler of `owner` standing `distance` nodes due east of `building`. */
function standOff(sim: Simulation, building: Entity, distance: number, jobType: number, owner = FOE): Entity {
  const at = nodeOf(sim, building);
  const spawned = spawn(sim, 1, { x: at.x + distance, y: at.y }, jobType, owner);
  const raider = spawned[0];
  if (raider === undefined) throw new Error('setup: the stand-off spawn was refused');
  return raider;
}

function nodeOf(sim: Simulation, e: Entity): { x: number; y: number } {
  const terrain = terrainOf(sim);
  return terrain.coordsOf(entityNode(sim.world, terrain, e));
}

/** Walk `e` `nodes` further east - the raider drawing off between two decisions. */
function drawOff(sim: Simulation, e: Entity, nodes: number): void {
  const at = nodeOf(sim, e);
  sim.world.add(e, Position, positionOfNode(at.x + nodes, at.y));
}

/** Make the seat a computer seat whose last posture review found its strongest enemy clearly stronger. */
function outmatchedSeat(sim: Simulation): void {
  reviewedSeat(sim, ['outmatched'], null);
}

/** Make the seat a computer seat whose last posture review found a scripted attack on it under way. */
function awaitingSeat(sim: Simulation): void {
  reviewedSeat(sim, ['forecastThreat'], 0);
}

function reviewedSeat(
  sim: Simulation,
  evidence: ('outmatched' | 'forecastThreat')[],
  threatInTicks: number | null,
): void {
  const carrier = sim.world.create();
  sim.world.add(carrier, AiControl, {
    player: SEAT,
    computerEnabled: true,
    modules: computerModuleEnables(),
    mapAiEnabled: true,
    difficulty: 'hard',
  });
  sim.world.add(carrier, ComputerStrategy, {
    economy: { archetype: 'standard', sides: [], evidence: [], decidedAt: 0 },
    military: {
      posture: threatInTicks === null ? 'defend' : 'prepare',
      evidence,
      ownPoints: 0,
      targetOwner: null,
      targetPoints: null,
      strongestPoints: null,
      threatInTicks,
      plan: 'balanced',
      decidedAt: 0,
      challenger: null,
    },
  });
}

function run(sim: Simulation, seed = EAGER_SEED): Command[] {
  const ctx = ctxOf(sim, seed);
  return [
    ...planSettlementDefence(sim.world, ctx, terrainOf(sim), SEAT, true).commands,
    ...militaryModule.run(sim.world, ctx, SEAT),
  ];
}

function apply(sim: Simulation, commands: readonly Command[]): void {
  for (const command of commands) sim.enqueueSetup(command);
  sim.step();
}

function alarms(commands: readonly Command[]): { building: Entity; enabled: boolean }[] {
  return commands.flatMap((c) =>
    c.kind === 'setDefenceMode' ? [{ building: c.building, enabled: c.enabled }] : [],
  );
}

function postings(commands: readonly Command[]): { entity: Entity; building: Entity }[] {
  return commands.flatMap((c) =>
    c.kind === 'assignWorker' ? [{ entity: c.entity, building: c.building }] : [],
  );
}

function attackMoves(commands: readonly Command[]): { entity: Entity; x: number; y: number }[] {
  return commands.flatMap((c) => (c.kind === 'attackMoveUnit' ? [{ entity: c.entity, x: c.x, y: c.y }] : []));
}

describe('ai defence - the alarm', () => {
  it('rings a shelter an enemy fighter has closed on', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    standOff(sim, hq, watchOf(sim), SPEARMAN);

    expect(alarms(run(sim))).toEqual([{ building: hq, enabled: true }]);
  });

  it('ignores an enemy colonist standing just as close', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    standOff(sim, hq, watchOf(sim), CIVILIST);

    expect(alarms(run(sim))).toEqual([]);
  });

  it('ignores a fighter whose player is not hostile toward the seat', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    standOff(sim, hq, watchOf(sim), SPEARMAN);
    setDiplomacyStance(sim.world, FOE, SEAT, 'friend');

    // The threat scan keys on the fighter's directed stance toward the seat - the same axis the
    // CombatSystem engages on - so an allied army walking the town is never read as a raid.
    expect(alarms(run(sim))).toEqual([]);

    setDiplomacyStance(sim.world, FOE, SEAT, 'enemy');
    expect(alarms(run(sim))).toEqual([{ building: hq, enabled: true }]);
  });

  it('ignores a fighter one node outside the watch band', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    standOff(sim, hq, watchOf(sim) + 1, SPEARMAN);

    expect(alarms(run(sim))).toEqual([]);
  });

  it('counts the band in map points, where a diagonal half as wide as it is tall comes free', () => {
    const ROWS = 10; // an even row span, so no half-node lean applies
    const FREE_COLUMNS = ROWS / 2;
    for (const [pastBand, rings] of [
      [0, true],
      [1, false],
    ] as const) {
      const sim = aiSim();
      const hq = place(sim, HQ_TYPE, SEAT_HQ);
      const at = nodeOf(sim, hq);
      const columns = watchOf(sim) - ROWS + FREE_COLUMNS + pastBand;
      spawn(sim, 1, { x: at.x + columns, y: at.y + ROWS }, SPEARMAN, FOE);

      expect(alarms(run(sim))).toEqual(rings ? [{ building: hq, enabled: true }] : []);
    }
  });

  it('holds a raised alarm while the raider hangs inside the stand-down margin', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    const raider = standOff(sim, hq, watchOf(sim), SPEARMAN);
    apply(sim, run(sim));
    expect(sim.world.has(hq, DefenceMode)).toBe(true);

    // Out of the band he raised it from, but not yet past the margin: the town stays in cover instead of
    // pouring back out to be caught in the open.
    drawOff(sim, raider, THREAT_STAND_DOWN_MARGIN_NODES);
    expect(alarms(run(sim))).toEqual([]);
  });

  it('goes out at a raider whose alarm it is still holding, though he stands past its fire', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    const band = spawn(sim, 3, { x: BARRACKS.x, y: BARRACKS.y + 6 }, SPEARMAN);
    const raider = standOff(sim, hq, watchOf(sim), SPEARMAN);
    // Only the alarm applies: the first decision's sortie would leave the band mid-walk and out of reach
    // of the second one.
    apply(
      sim,
      run(sim).filter((c) => c.kind === 'setDefenceMode'),
    );
    expect(sim.world.has(hq, DefenceMode)).toBe(true);

    // Inside the margin, outside the reach a sheltering civilian answers with. Held there he shuts the
    // town down for nothing, so the band that answers has to reach as far as the alarm holds.
    drawOff(sim, raider, THREAT_STAND_DOWN_MARGIN_NODES);
    const commands = run(sim);
    const at = nodeOf(sim, raider);
    expect(alarms(commands)).toEqual([]);
    expect(attackMoves(commands)).toEqual(band.map((e) => ({ entity: e, x: at.x, y: at.y })));
  });

  it('lowers it once the raider draws off past the margin', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    const raider = standOff(sim, hq, watchOf(sim), SPEARMAN);
    apply(sim, run(sim));

    drawOff(sim, raider, THREAT_STAND_DOWN_MARGIN_NODES + 1);
    expect(alarms(run(sim))).toEqual([{ building: hq, enabled: false }]);
  });

  it('ignores an enemy archer holding his own tower', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    const at = nodeOf(sim, hq);
    const tower = place(sim, TOWER_TYPE, { x: at.x + watchOf(sim) - 8, y: at.y }, FOE);
    const archer = standOff(sim, tower, 4, BOWMAN);
    sim.enqueueSetup({ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [BOWMAN] });
    for (let i = 0; i < WALK_IN_TICKS; i++) sim.step();
    // He is untargetable up there (`conflict/targeting.ts`), so a town frozen in cover over him would never
    // thaw and the band sent after him could never reach him.
    expect(standsAtPost(sim.world, archer)).toBe(tower);
    expect(alarms(run(sim))).toEqual([]);
  });

  it('never rings a shelter that is still a building site', () => {
    const sim = aiSim();
    const site = placeSite(sim, TOWER_TYPE, SEAT_TOWER);
    standOff(sim, site, 2, SPEARMAN);

    expect(alarms(run(sim))).toEqual([]);
  });

  it('lowers the alarms it is standing on when the seat stops deciding', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    standOff(sim, hq, watchOf(sim), SPEARMAN);
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true });
    apply(sim, run(sim));
    expect(sim.world.has(hq, DefenceMode)).toBe(true);

    // Nothing else ever lowers it, so a seat that stops deciding would hold its people in cover for the
    // rest of the game.
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: false });
    sim.step();
    expect(sim.world.has(hq, DefenceMode)).toBe(false);
  });

  it('holds them when the military gate alone flips off, since the defence keeps deciding', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    standOff(sim, hq, watchOf(sim), SPEARMAN);
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true });
    apply(sim, run(sim));

    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules: { military: false } });
    sim.step();
    expect(sim.world.has(hq, DefenceMode)).toBe(true);
  });

  it('still rings, mans the wall and sorties with the military module off', () => {
    // The original's map toggles reach only the strategic handler; the scripted handler every computer
    // seat runs defends the home on its own, a quiet tower with one archer of each class.
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    const tower = place(sim, TOWER_TYPE, SEAT_TOWER);
    spawn(sim, MAP_AI_PEACE_ARCHERS_PER_CLASS, { x: SEAT_TOWER.x + 6, y: SEAT_TOWER.y }, BOWMAN);
    const band = spawn(sim, 4, { x: SEAT_HQ.x, y: SEAT_HQ.y + 6 }, SPEARMAN);
    standOff(sim, hq, watchOf(sim), SPEARMAN);

    const commands = [...planSettlementDefence(sim.world, ctxOf(sim), terrainOf(sim), SEAT, false).commands];
    expect(alarms(commands)).toEqual([{ building: hq, enabled: true }]);
    expect(postings(commands).every((p) => p.building === tower)).toBe(true);
    expect(postings(commands)).toHaveLength(MAP_AI_PEACE_ARCHERS_PER_CLASS);
    expect(attackMoves(commands).map((m) => m.entity)).toEqual(band);

    // The live seat dispatches that half: its first decision lands the postings in the log.
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules: { military: false } });
    sim.run(COMPUTER_DECISION_INTERVAL_TICKS + 1);
    const logged = sim.commands.log.filter((entry) => entry.origin === 'ai' && entry.player === SEAT);
    expect(logged.filter((entry) => entry.command.kind === 'assignWorker')).toHaveLength(
      MAP_AI_PEACE_ARCHERS_PER_CLASS,
    );
    expect(logged.some((entry) => entry.command.kind === 'setDefenceMode')).toBe(true);
  });

  it('keeps marching while a raider it cannot walk to holds the alarm up', () => {
    const water = SEAT_HQ.x + 8;
    const sim = aiSim(splitNodeMap(128, 96, water));
    place(sim, BARRACKS_TYPE, BARRACKS);
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    const band = spawn(sim, WAVE_MIN_SOLDIERS, { x: BARRACKS.x, y: BARRACKS.y + 6 }, SPEARMAN);
    // Across the water, inside the watch band: he can shoot into the street, so the town takes cover -
    // but nobody can walk out at him, and benching the army for a siege it can never join would hand a
    // human the same permanent freeze from the far bank.
    const raider = standOff(sim, hq, watchOf(sim) - 2, SPEARMAN);

    const commands = run(sim);
    const at = nodeOf(sim, raider);
    expect(alarms(commands)).toEqual([{ building: hq, enabled: true }]);
    expect(attackMoves(commands).filter((m) => m.x === at.x && m.y === at.y)).toEqual([]);
    // Benched, the campaign would issue nothing at all and these five would stand idle for the rest of
    // the game.
    expect(commands.some((c) => 'entity' in c && band.includes(c.entity))).toBe(true);
  });

  it('sorties for a construction site under attack, though it cannot ring one', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const band = spawn(sim, 3, { x: BARRACKS.x, y: BARRACKS.y + 6 }, SPEARMAN);
    // Away south, so the band answers the raid rather than picking the raider up on sight from the rally.
    const site = placeSite(sim, TOWER_TYPE, SEAT_TOWER);
    const raider = standOff(sim, site, 2, SPEARMAN);

    // A site has no inside to hide in, so no alarm - but it can be razed, and losing the build queue
    // uncontested is worse than losing the wall it would have been.
    const commands = run(sim);
    expect(alarms(commands)).toEqual([]);
    const at = nodeOf(sim, raider);
    expect(attackMoves(commands)).toEqual(band.map((e) => ({ entity: e, x: at.x, y: at.y })));
  });
});

describe('ai defence - the tower garrison', () => {
  it('walls three archers into a standing tower', () => {
    const sim = aiSim();
    const tower = place(sim, TOWER_TYPE, SEAT_TOWER);
    spawn(sim, 5, { x: SEAT_TOWER.x + 6, y: SEAT_TOWER.y }, BOWMAN);

    const posted = postings(run(sim));
    expect(posted).toHaveLength(TOWER_GARRISON_ARCHERS);
    expect(posted.every((p) => p.building === tower)).toBe(true);
    expect(new Set(posted.map((p) => p.entity)).size).toBe(TOWER_GARRISON_ARCHERS);
  });

  it('walls its archers into its own tower of another tribe', () => {
    const sim = aiSim();
    const tower = place(sim, TOWER_TYPE, SEAT_TOWER);
    sim.world.mut(tower, Building).tribe = FRANK;
    spawn(sim, TOWER_GARRISON_ARCHERS, { x: SEAT_TOWER.x + 6, y: SEAT_TOWER.y }, BOWMAN);

    const posted = postings(run(sim));
    expect(posted).toHaveLength(TOWER_GARRISON_ARCHERS);
    expect(posted.every((p) => p.building === tower)).toBe(true);
  });

  it('leaves a tower alone once its three are bound to it', () => {
    const sim = aiSim();
    place(sim, TOWER_TYPE, SEAT_TOWER);
    spawn(sim, 5, { x: SEAT_TOWER.x + 6, y: SEAT_TOWER.y }, BOWMAN);
    apply(sim, run(sim));

    expect(postings(run(sim))).toEqual([]);
  });

  it('leaves the wall empty when the seat fields no class the tower offers a slot for', () => {
    const sim = aiSim();
    place(sim, TOWER_TYPE, SEAT_TOWER);
    spawn(sim, 5, { x: SEAT_TOWER.x + 6, y: SEAT_TOWER.y }, SPEARMAN);

    expect(postings(run(sim))).toEqual([]);
  });

  it('staffs nothing at a building with no fighting slots', () => {
    const sim = aiSim();
    place(sim, WALL_TYPE, SEAT_TOWER);
    spawn(sim, 5, { x: SEAT_TOWER.x + 6, y: SEAT_TOWER.y }, BOWMAN);

    expect(postings(run(sim))).toEqual([]);
  });

  it('spends its garrison out of the army, leaving a force too small to launch a wave', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, TOWER_TYPE, SEAT_TOWER);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    // Exactly the smallest group the seat would send: the three the tower takes are what puts it under.
    const band = spawn(sim, WAVE_MIN_SOLDIERS, { x: SEAT_TOWER.x + 6, y: SEAT_TOWER.y }, BOWMAN);
    apply(sim, run(sim));

    const garrison = [...sim.world.query(Settler, JobAssignment)].filter(
      (e) => sim.world.get(e, Owner).player === SEAT,
    );
    expect(garrison).toHaveLength(TOWER_GARRISON_ARCHERS);
    const army = takeCensus(sim.world, ctxOf(sim), SEAT);
    expect(army.ready).toHaveLength(band.length - TOWER_GARRISON_ARCHERS);
    expect(army.ready.length).toBeLessThan(WAVE_MIN_SOLDIERS);
  });
});

describe('ai defence - the sortie', () => {
  it('throws the free band at the raider nearest the settlement', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    const band = spawn(sim, 4, { x: BARRACKS.x, y: BARRACKS.y + 6 }, SPEARMAN);
    const raider = standOff(sim, hq, watchOf(sim), SPEARMAN);

    const commands = run(sim);
    const at = terrainOf(sim).coordsOf(entityNode(sim.world, terrainOf(sim), raider));
    expect(attackMoves(commands)).toEqual(band.map((e) => ({ entity: e, x: at.x, y: at.y })));
  });

  it('leaves the men already chasing a focus to it', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    const foeHq = place(sim, HQ_TYPE, FOE_HQ, FOE);
    const band = spawn(sim, 3, { x: BARRACKS.x, y: BARRACKS.y + 6 }, SPEARMAN);
    const committed = band[0];
    if (committed === undefined) throw new Error('setup: the band spawn was refused');
    sim.world.add(committed, AttackOrder, { target: foeHq });
    standOff(sim, hq, watchOf(sim), SPEARMAN);

    expect(attackMoves(run(sim)).map((m) => m.entity)).toEqual(band.slice(1));
  });

  it('leaves a posted garrison on its wall and sends the archer it could not seat', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    // Beside the barracks, so the archer the tower has no room for waits out the muster at the rally
    // instead of walking across the map to it - a man mid-walk is on an errand and no rung touches him.
    const tower = place(sim, TOWER_TYPE, { x: BARRACKS.x, y: BARRACKS.y + 10 });
    const band = spawn(sim, TOWER_GARRISON_ARCHERS + 1, { x: BARRACKS.x - 2, y: BARRACKS.y + 2 }, BOWMAN);
    apply(sim, run(sim));
    for (let i = 0; i < WALK_IN_TICKS; i++) sim.step();
    const garrison = band.filter((e) => standsAtPost(sim.world, e) === tower);
    expect(garrison).toHaveLength(TOWER_GARRISON_ARCHERS);

    standOff(sim, hq, watchOf(sim), SPEARMAN);
    const ordered = attackMoves(run(sim)).map((m) => m.entity);
    expect(ordered).toEqual(band.filter((e) => !garrison.includes(e)));
  });

  it('never sends a fighter the map put beyond the player’s control, with or without the module', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    const [free, guard] = spawn(sim, 2, { x: BARRACKS.x, y: BARRACKS.y + 6 }, SPEARMAN);
    if (free === undefined || guard === undefined) throw new Error('setup: the band spawn was refused');
    stampMissionBehaviour(sim.world, guard, MISSION_BEHAVIOUR.NOT_CONTROLLABLE);
    standOff(sim, hq, watchOf(sim), SPEARMAN);

    expect(attackMoves(run(sim)).map((m) => m.entity)).toEqual([free]);
    const defence = planSettlementDefence(sim.world, ctxOf(sim), terrainOf(sim), SEAT, false);
    expect(attackMoves(defence.commands).map((m) => m.entity)).toEqual([free]);
  });

  it("sends no band at a raider on a peace partner's ground, whose walk the peace refuses", () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    spawn(sim, 4, { x: BARRACKS.x, y: BARRACKS.y + 6 }, SPEARMAN);
    // Raised before the raider comes: a hostile fighter in sight contests the site.
    const hqAt = nodeOf(sim, hq);
    place(sim, HQ_TYPE, { x: hqAt.x + watchOf(sim) + PARTNER_HQ_OFFSET, y: hqAt.y }, PARTNER);
    const raider = standOff(sim, hq, watchOf(sim), SPEARMAN);
    const at = nodeOf(sim, raider);
    apply(sim, [{ kind: 'setPeaceTime', untilTick: PEACE_UNTIL, players: [SEAT, PARTNER] }]);

    expect(attackMoves(run(sim)).filter((m) => m.x === at.x && m.y === at.y)).toEqual([]);
  });

  it('keeps an outmatched seat under its towers and stores: no sortie for an outlying site', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    const band = spawn(sim, 3, { x: BARRACKS.x, y: BARRACKS.y + 6 }, SPEARMAN);
    const site = placeSite(sim, TOWER_TYPE, SEAT_TOWER);
    outmatchedSeat(sim);
    const far = standOff(sim, site, 2, SPEARMAN);
    const farAt = nodeOf(sim, far);
    expect(attackMoves(run(sim)).filter((m) => m.x === farAt.x && m.y === farAt.y)).toEqual([]);

    // A raider at the headquarters is answered as ever.
    const near = standOff(sim, hq, watchOf(sim), SPEARMAN);
    const at = nodeOf(sim, near);
    expect(attackMoves(run(sim))).toEqual(band.map((e) => ({ entity: e, x: at.x, y: at.y })));
  });

  it("gathers an outmatched seat's army at its base rather than at its barracks", () => {
    const gatheredAt = (outmatched: boolean): { x: number; y: number }[] => {
      const sim = aiSim();
      place(sim, BARRACKS_TYPE, BARRACKS);
      place(sim, HQ_TYPE, BASE_AWAY_FROM_BARRACKS);
      spawn(sim, 2, AWAY_FROM_BOTH, SPEARMAN);
      if (outmatched) outmatchedSeat(sim);
      return attackMoves(run(sim));
    };
    const nearer = (m: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(m.x - a.x) + Math.abs(m.y - a.y) < Math.abs(m.x - b.x) + Math.abs(m.y - b.y);
    const even = gatheredAt(false);
    expect(even).toHaveLength(2);
    expect(even.every((m) => nearer(m, BARRACKS, BASE_AWAY_FROM_BARRACKS))).toBe(true);
    const held = gatheredAt(true);
    expect(held).toHaveLength(2);
    expect(held.every((m) => nearer(m, BASE_AWAY_FROM_BARRACKS, BARRACKS))).toBe(true);
  });

  it('stays quiet while the nearest enemy fighter is outside every watch band', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    spawn(sim, 4, { x: BARRACKS.x, y: BARRACKS.y + 6 }, SPEARMAN);
    const raider = standOff(sim, hq, watchOf(sim) + 1, SPEARMAN);

    // The band is gathered for the campaign instead - the muster walks men in under an attack-move too,
    // so what tells a sortie apart is where it sends them.
    const at = terrainOf(sim).coordsOf(entityNode(sim.world, terrainOf(sim), raider));
    expect(attackMoves(run(sim)).filter((m) => m.x === at.x && m.y === at.y)).toEqual([]);
  });
});

describe('ai defence - the tower stand', () => {
  /** A tower east of the barracks, toward where the attacks come from, and the base west of both. */
  const STAND_TOWER = { x: 56, y: 40 };
  const STAND_BASE = { x: 16, y: 40 };
  /** Far south of the town: past every watch band but the outlying site's. */
  const OUTLYING_SITE = { x: 60, y: 88 };

  /** The seat with its base, barracks and a tower whose archers have walked in and taken their posts. */
  function mannedTowerSim(): { sim: Simulation; tower: Entity } {
    const sim = aiSim();
    place(sim, HQ_TYPE, STAND_BASE);
    place(sim, BARRACKS_TYPE, { x: STAND_TOWER.x - 8, y: STAND_TOWER.y - 10 });
    const tower = place(sim, TOWER_TYPE, STAND_TOWER);
    const archers = spawn(
      sim,
      TOWER_GARRISON_ARCHERS,
      { x: STAND_TOWER.x - 4, y: STAND_TOWER.y - 6 },
      BOWMAN,
    );
    apply(sim, run(sim));
    for (let i = 0; i < WALK_IN_TICKS; i++) sim.step();
    if (!archers.every((e) => standsAtPost(sim.world, e) === tower))
      throw new Error('setup: tower not manned');
    return { sim, tower };
  }

  it('meets a big attack only under its towers while it awaits a scripted attack, and a small band anywhere', () => {
    const { sim, tower } = mannedTowerSim();
    const site = placeSite(sim, TOWER_TYPE, OUTLYING_SITE);
    spawn(sim, 2, { x: STAND_TOWER.x - 10, y: STAND_TOWER.y - 4 }, SPEARMAN);
    awaitingSeat(sim);
    const siteAt = nodeOf(sim, site);
    const near = { x: siteAt.x + 2, y: siteAt.y };
    const aimedAt = (men: readonly Entity[]): boolean => {
      const nodes = men.map((e) => nodeOf(sim, e));
      return attackMoves(run(sim)).some((m) => nodes.some((n) => n.x === m.x && n.y === m.y));
    };

    // A small band at the outlying site is answered as ever.
    const few = spawn(sim, BIG_ATTACK_FIGHTERS - 1, near, SPEARMAN, FOE);
    expect(aimedAt(few)).toBe(true);

    // One more makes a big attack, which the army waits for under its towers.
    const many = [...few, ...spawn(sim, 1, { x: near.x, y: near.y + 6 }, SPEARMAN, FOE)];
    expect(aimedAt(many)).toBe(false);

    // Once one of them comes within the tower's reach, the army goes at him.
    const first = many[0];
    if (first === undefined) throw new Error('setup: the attack spawn was refused');
    const towerAt = nodeOf(sim, tower);
    sim.world.add(first, Position, positionOfNode(towerAt.x + watchOf(sim) - 2, towerAt.y));
    expect(aimedAt([first])).toBe(true);
  });
});

describe('ai defence - the soldier list', () => {
  function enlistments(commands: readonly Command[]): Entity[] {
    return commands.flatMap((c) => (c.kind === 'setRegeneration' && !c.enabled ? [c.entity] : []));
  }

  it('forbids every fighter its regeneration once, the posted garrison included, and never a civilian', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const tower = place(sim, TOWER_TYPE, { x: BARRACKS.x, y: BARRACKS.y + 10 });
    const band = spawn(sim, 2, { x: BARRACKS.x - 2, y: BARRACKS.y + 2 }, SPEARMAN);
    const archer = spawn(sim, 1, { x: BARRACKS.x + 6, y: BARRACKS.y + 2 }, BOWMAN)[0];
    if (archer === undefined) throw new Error('setup: the archer spawn was refused');
    sim.world.add(archer, JobAssignment, { workplace: tower });
    spawn(sim, 1, { x: BARRACKS.x + 8, y: BARRACKS.y + 2 }, CIVILIST);

    const first = run(sim);
    expect(enlistments(first)).toEqual([...band, archer]);
    apply(sim, first);
    expect(enlistments(run(sim))).toEqual([]);
  });

  it('never lists a fighter the map put beyond the player’s control', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const [free, fixed] = spawn(sim, 2, { x: BARRACKS.x - 2, y: BARRACKS.y + 2 }, SPEARMAN);
    if (fixed === undefined) throw new Error('setup: the spawn was refused');
    stampMissionBehaviour(sim.world, fixed, MISSION_BEHAVIOUR.NOT_CONTROLLABLE);
    expect(enlistments(run(sim))).toEqual([free]);
  });

  it('writes the flag again over an archer the posting order re-idled', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const tower = place(sim, TOWER_TYPE, { x: BARRACKS.x, y: BARRACKS.y + 10 });
    const archer = spawn(sim, 1, { x: BARRACKS.x + 6, y: BARRACKS.y + 2 }, BOWMAN)[0];
    if (archer === undefined) throw new Error('setup: the archer spawn was refused');
    apply(sim, [{ kind: 'setRegeneration', entity: archer, enabled: false }]);
    apply(sim, [{ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [BOWMAN] }]);
    expect(sim.world.has(archer, NoRegeneration)).toBe(false);
    expect(enlistments(run(sim))).toEqual([archer]);
  });

  it('enlists with the military module off too - the scripted handler lists them, not the strategic one', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const band = spawn(sim, 2, { x: BARRACKS.x - 2, y: BARRACKS.y + 2 }, SPEARMAN);
    expect(
      enlistments(planSettlementDefence(sim.world, ctxOf(sim), terrainOf(sim), SEAT, false).commands),
    ).toEqual(band);
  });
});

describe('map camp defence boundaries', () => {
  it('answers with nearby free men without pulling soldiers from a distant camp', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    const near = spawn(sim, 1, { x: SEAT_HQ.x, y: SEAT_HQ.y + 6 }, SPEARMAN);
    const distant = spawn(sim, 1, { x: 100, y: 84 }, SPEARMAN);
    standOff(sim, hq, watchOf(sim), SPEARMAN);
    const map = planSettlementDefence(sim.world, ctxOf(sim), terrainOf(sim), SEAT, false);
    expect(attackMoves(map.commands).map((move) => move.entity)).toEqual(near);
    const computer = planSettlementDefence(sim.world, ctxOf(sim), terrainOf(sim), SEAT, true);
    expect(attackMoves(computer.commands).map((move) => move.entity)).toEqual([...near, ...distant]);
  });
});

function dispatchedCampSortie(): { sim: Simulation; defender: Entity; raider: Entity } {
  const sim = aiSim();
  const hq = place(sim, HQ_TYPE, SEAT_HQ);
  const [defender] = spawn(sim, 1, { x: SEAT_HQ.x, y: SEAT_HQ.y + 6 }, SPEARMAN);
  if (defender === undefined) throw new Error('missing defender');
  const raider = standOff(sim, hq, watchOf(sim), SPEARMAN);
  sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, computerEnabled: false });
  sim.enqueueSetup({ kind: 'setStance', entity: raider, mode: MILITARY_MODE.IGNORE });
  sim.step();
  settlementDefenceSystem(sim.world, { ...ctxOf(sim), tick: MAP_AI_DEFENCE_TICK, commands: sim.commands });
  expect(sim.world.has(defender, MapAiDefence)).toBe(true);
  sim.step();
  expect(sim.world.get(defender, AiOrder).source).toBe('settlement-defence');
  return { sim, defender, raider };
}

function roundTripCamp(sim: Simulation): Simulation {
  const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
    content: sim.content,
    map: grassNodeMap(128, 96),
  });
  expect(restored.hashState()).toBe(sim.hashState());
  return restored;
}

describe('map camp defence pursuit leash', () => {
  it('withdraws an unrestricted sortie when autonomous military stops', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    const [defender] = spawn(sim, 1, { x: SEAT_HQ.x, y: SEAT_HQ.y + 6 }, SPEARMAN);
    if (defender === undefined) throw new Error('missing defender');
    const raider = standOff(sim, hq, watchOf(sim), SPEARMAN);
    const ctx = { ...ctxOf(sim), tick: CONTROLLED_DEFENCE_TICK, commands: sim.commands };
    setAiControl(sim.world, ctx, { kind: 'setAiControl', player: SEAT, enabled: true });
    settlementDefenceSystem(sim.world, ctx);
    commandSystem(sim.world, ctx);
    expect(sim.world.get(defender, AiOrder).source).toBe('settlement-defence');
    expect(sim.world.has(defender, MapAiDefence)).toBe(false);
    sim.world.add(defender, Engagement, { repathAt: ctx.tick, target: raider });
    sim.world.add(raider, Position, positionOfNode(100, SEAT_HQ.y));
    setAiControl(sim.world, ctx, {
      kind: 'setAiControl',
      player: SEAT,
      enabled: true,
      computerEnabled: false,
    });
    expect(sim.world.has(defender, PlayerOrder)).toBe(false);
    expect(sim.world.has(defender, Engagement)).toBe(false);
    expect(sim.world.has(defender, AiOrder)).toBe(false);
    expect(sim.world.get(defender, Stance).mode).toBe(MILITARY_MODE.IGNORE);
    sim.world.add(raider, Position, positionOfNode(SEAT_HQ.x + watchOf(sim), SEAT_HQ.y));
    // The controller is off now, so the seat's defence is back on the map-AI slot.
    const next = MAP_AI_DEFENCE_TICK + COMPUTER_DECISION_INTERVAL_TICKS;
    settlementDefenceSystem(sim.world, { ...ctx, tick: next });
    commandSystem(sim.world, { ...ctx, tick: next });
    expect(sim.world.get(defender, AiOrder).source).toBe('settlement-defence');
    expect(sim.world.has(defender, MapAiDefence)).toBe(true);
  });

  it('recalls an engaged defender when its enemy retreats and preserves the return through a save', () => {
    const original = dispatchedCampSortie();
    const sim = roundTripCamp(original.sim);
    const { defender, raider } = original;
    const home = sim.world.get(defender, MapAiDefence).home;
    sim.world.add(defender, Position, positionOfNode(SEAT_HQ.x + 20, SEAT_HQ.y));
    sim.world.add(defender, Engagement, { repathAt: sim.tick, target: raider });
    sim.world.add(raider, Position, positionOfNode(100, SEAT_HQ.y));
    sim.step();
    expect(sim.world.get(defender, MapAiDefence).returning).toBe(true);
    expect(sim.world.has(defender, Engagement)).toBe(false);
    expect(sim.world.get(defender, Stance).mode).toBe(MILITARY_MODE.IGNORE);
    const restored = roundTripCamp(sim);
    restored.run(300);
    const at = nodeOf(restored, defender);
    expect(Math.abs(at.x - home.hx) + Math.abs(at.y - home.hy)).toBeLessThan(12);
    expect(restored.world.has(defender, MapAiDefence)).toBe(false);
    expect(
      restored.commands.log.some(
        (entry) =>
          entry.origin === 'ai' &&
          entry.decisionSource === 'settlement-defence' &&
          entry.command.kind === 'moveUnit' &&
          entry.command.entity === defender &&
          entry.command.x === home.hx &&
          entry.command.y === home.hy,
      ),
    ).toBe(true);
    expect(restored.checkInvariants()).toEqual([]);
  });

  it('does not recall an explicit map attack that replaces the local response', () => {
    const { sim, defender, raider } = dispatchedCampSortie();
    sim.world.add(raider, Position, positionOfNode(100, SEAT_HQ.y));
    sim.enqueue(aiCommand(SEAT, { kind: 'attackMoveUnit', entity: defender, x: 100, y: 20 }, 'map-ai'));
    const ctx = { ...ctxOf(sim), tick: sim.tick, commands: sim.commands };
    commandSystem(sim.world, ctx);
    mapDefenceLeashSystem(sim.world, ctx);
    expect(sim.world.has(defender, MapAiDefence)).toBe(false);
    expect(sim.world.get(defender, AiOrder).source).toBe('map-ai');
    expect(sim.world.get(defender, Stance).mode).toBe(MILITARY_MODE.ATTACK);
  });

  it('releases a local leash when autonomous military takes over', () => {
    const { sim, defender, raider } = dispatchedCampSortie();
    sim.world.add(raider, Position, positionOfNode(100, SEAT_HQ.y));
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true });
    sim.step();
    mapDefenceLeashSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(defender, MapAiDefence)).toBe(false);
    expect(sim.world.get(defender, Stance).mode).toBe(MILITARY_MODE.ATTACK);
  });
});

it('keeps a local response while the intruder remains hostile despite one-way friendly diplomacy', () => {
  const { sim, defender } = dispatchedCampSortie();
  setDiplomacyStance(sim.world, SEAT, FOE, 'friend');
  setDiplomacyStance(sim.world, FOE, SEAT, 'enemy');
  mapDefenceLeashSystem(sim.world, ctxOf(sim));
  expect(sim.world.get(defender, MapAiDefence).returning).toBe(false);
});
