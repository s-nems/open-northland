import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  Building,
  DefenceMode,
  JobAssignment,
  MISSION_BEHAVIOUR,
  NoRegeneration,
  Owner,
  Position,
  Settler,
  setDiplomacyStance,
  stampMissionBehaviour,
} from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { EventBuffer, positionOfNode, Rng, Simulation, type TerrainMap } from '../../src/index.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';
import {
  AI_DECISION_INTERVAL_TICKS,
  militaryModule,
  THREAT_STAND_DOWN_MARGIN_NODES,
  TOWER_GARRISON_ARCHERS,
  takeCensus,
  threatWatchNodes,
  WAVE_MIN_SOLDIERS,
} from '../../src/systems/ai-player/index.js';
import { standsAtPost } from '../../src/systems/conflict/tower-post.js';
import type { SystemContext } from '../../src/systems/index.js';
import { entityNode } from '../../src/systems/spatial/nodes.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The strategic AI defending its own ground: the alarm it rings over its townspeople when enemy fighters
 * close on a shelter, the archers it walls into every tower it raises, and the band it throws at a raider
 * instead of marching it out.
 */

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
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

function run(sim: Simulation, seed = EAGER_SEED): Command[] {
  return [...militaryModule.run(sim.world, ctxOf(sim, seed), SEAT)];
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
    sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true });
    apply(sim, run(sim));
    expect(sim.world.has(hq, DefenceMode)).toBe(true);

    // Nothing else ever lowers it, so a seat that stops deciding would hold its people in cover for the
    // rest of the game.
    sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: false });
    sim.step();
    expect(sim.world.has(hq, DefenceMode)).toBe(false);
  });

  it('holds them when the military gate alone flips off, since the defence keeps deciding', () => {
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    standOff(sim, hq, watchOf(sim), SPEARMAN);
    sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true });
    apply(sim, run(sim));

    sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true, modules: { military: false } });
    sim.step();
    expect(sim.world.has(hq, DefenceMode)).toBe(true);
  });

  it('still rings, mans the wall and sorties with the military module off', () => {
    // The original's map toggles reach only the strategic handler; the scripted handler every computer
    // seat runs defends the home on its own.
    const sim = aiSim();
    const hq = place(sim, HQ_TYPE, SEAT_HQ);
    const tower = place(sim, TOWER_TYPE, SEAT_TOWER);
    spawn(sim, TOWER_GARRISON_ARCHERS, { x: SEAT_TOWER.x + 6, y: SEAT_TOWER.y }, BOWMAN);
    const band = spawn(sim, 4, { x: SEAT_HQ.x, y: SEAT_HQ.y + 6 }, SPEARMAN);
    standOff(sim, hq, watchOf(sim), SPEARMAN);

    const decide = militaryModule.whileDisabled;
    if (decide === undefined) throw new Error('the military module has no disabled half');
    const commands = [...decide(sim.world, ctxOf(sim, EAGER_SEED), SEAT)];
    expect(alarms(commands)).toEqual([{ building: hq, enabled: true }]);
    expect(postings(commands).every((p) => p.building === tower)).toBe(true);
    expect(postings(commands)).toHaveLength(TOWER_GARRISON_ARCHERS);
    expect(attackMoves(commands).map((m) => m.entity)).toEqual(band);

    // The live seat dispatches that half: its first decision lands the postings in the log.
    sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true, modules: { military: false } });
    sim.run(AI_DECISION_INTERVAL_TICKS + 1);
    const logged = sim.commands.log.filter((entry) => entry.origin === 'ai' && entry.player === SEAT);
    expect(logged.filter((entry) => entry.command.kind === 'assignWorker')).toHaveLength(
      TOWER_GARRISON_ARCHERS,
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
    const decide = militaryModule.whileDisabled;
    if (decide === undefined) throw new Error('the military module has no scripted half');
    expect(enlistments([...decide(sim.world, ctxOf(sim), SEAT)])).toEqual(band);
  });
});
