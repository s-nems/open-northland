import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  Building,
  DefenceMode,
  JobAssignment,
  Owner,
  Position,
  Settler,
} from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { EventBuffer, positionOfNode, Rng, Simulation, type TerrainMap } from '../../src/index.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';
import {
  militaryModule,
  THREAT_STAND_DOWN_MARGIN_NODES,
  TOWER_GARRISON_ARCHERS,
  takeCensus,
  threatWatchNodes,
  WAVE_MIN_SOLDIERS,
} from '../../src/systems/ai-player/index.js';
import { standsAtPost } from '../../src/systems/conflict/tower-post.js';
import type { SystemContext } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
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
  sim.enqueue({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner });
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
    sim.enqueue({
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
  for (const command of commands) sim.enqueue(command);
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
    sim.enqueue({ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [BOWMAN] });
    for (let i = 0; i < WALK_IN_TICKS; i++) sim.step();
    // He is untargetable up there (`conflict/targeting.ts`), so a town frozen in cover over him would never
    // thaw and the band sent after him could never reach him.
    expect(standsAtPost(sim.world, archer)).toBe(tower);
    expect(alarms(run(sim))).toEqual([]);
  });

  it('never rings a shelter that is still a building site', () => {
    const sim = aiSim();
    const before = new Set(sim.world.query(Building));
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: TOWER_TYPE,
      x: SEAT_TOWER.x,
      y: SEAT_TOWER.y,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    const site = [...sim.world.query(Building)].find((e) => !before.has(e));
    if (site === undefined) throw new Error('setup: the tower site was refused');
    standOff(sim, site, 2, SPEARMAN);

    expect(alarms(run(sim))).toEqual([]);
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
    expect(army.ready.length + army.committed).toBeLessThan(WAVE_MIN_SOLDIERS);
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
    // The band answers the raid instead of gathering for the campaign.
    expect(commands.filter((c) => c.kind === 'moveUnit')).toEqual([]);
    expect(commands.filter((c) => c.kind === 'setStance' && c.mode !== MILITARY_MODE.ATTACK)).toEqual([]);
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
    standOff(sim, hq, watchOf(sim) + 1, SPEARMAN);

    expect(attackMoves(run(sim))).toEqual([]);
  });
});
