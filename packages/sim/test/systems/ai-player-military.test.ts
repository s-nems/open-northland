import { describe, expect, it } from 'vitest';
import {
  type AiModuleEnables,
  AttackOrder,
  Building,
  Engagement,
  Health,
  Owner,
  Settler,
  Stance,
  TrainingOrder,
} from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { EventBuffer, Rng, replay, Simulation, type TerrainMap } from '../../src/index.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import {
  MUSTER_HOME_RADIUS_NODES,
  militaryModule,
  RALLY_HOLD_RADIUS_NODES,
  takeCensus,
  WAVE_LAUNCH_SPREAD,
  WAVE_MIN_SOLDIERS,
} from '../../src/systems/ai-player/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { interactionCell } from '../../src/systems/settlers/targets/index.js';
import { entityNode, manhattan } from '../../src/systems/spatial/nodes.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The strategic AI's military module: the muster it keeps at its barracks, the pseudo-random threshold
 * that sends a wave, and the campaign it sends it on - the nearest enemy headquarters, with no recall.
 */

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const GRASS = 0;
const WATER = 1;
const HQ_TYPE = 1;
const FARM_TYPE = 5;
const BARRACKS_TYPE = 12;
const STOCK_TYPE = 13;
const TOWER_TYPE = 15;
const SOLDIER = 31;
const SPEARMAN = 32;
const BOWMAN = 40;
const CIVILIST = 6;

/** The seat's barracks - the muster point every case forms up around. */
const BARRACKS = { x: 30, y: 30 };
/** The enemy seat, far enough that no objective ever falls inside the seat's own muster ring. */
const FOE_HQ = { x: 110, y: 70 };
/** A full wave with no doubt about the launch roll: this far over the minimum it marches on any draw. */
const CERTAIN_WAVE = WAVE_MIN_SOLDIERS + WAVE_LAUNCH_SPREAD;

/** A seed whose first `int(WAVE_LAUNCH_SPREAD)` draw is 0 - a bare-minimum muster marches. */
const EAGER_SEED = 7;
/** A seed whose first draw is the top of the spread - that same muster waits. */
const PATIENT_SEED = 4;

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

function place(sim: Simulation, buildingType: number, at: { x: number; y: number }, owner = SEAT): void {
  sim.enqueue({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
}

/** Standing settlers of one class, spread two nodes apart so no two share a node. */
function spawn(
  sim: Simulation,
  count: number,
  at: { x: number; y: number },
  jobType = SOLDIER,
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

function buildingOfType(sim: Simulation, buildingType: number, owner: number): Entity {
  for (const e of sim.world.query(Building, Owner)) {
    const b = sim.world.get(e, Building);
    if (b.buildingType === buildingType && sim.world.get(e, Owner).player === owner) return e;
  }
  throw new Error(`setup: building ${buildingType} of player ${owner} missing`);
}

/** The barracks door the module measures its muster from, as a node and as coordinates to spawn around. */
function rallyOf(sim: Simulation): { node: NodeId; x: number; y: number } {
  const terrain = terrainOf(sim);
  const node = interactionCell(sim.world, ctxOf(sim), terrain, buildingOfType(sim, BARRACKS_TYPE, SEAT));
  return { node, ...terrain.coordsOf(node) };
}

function run(sim: Simulation, seed = EAGER_SEED): Command[] {
  return [...militaryModule.run(sim.world, ctxOf(sim, seed), SEAT)];
}

function attackTargets(commands: readonly Command[]): Entity[] {
  return commands.flatMap((c) => (c.kind === 'attackUnit' ? [c.target] : []));
}

function stanceModes(commands: readonly Command[]): number[] {
  return commands.flatMap((c) => (c.kind === 'setStance' ? [c.mode] : []));
}

/** A map split by a full-height water column at `waterX`: the two banks are separate walkable
 *  components, so nothing on the far one is reachable. */
function splitNodeMap(width: number, height: number, waterX: number): TerrainMap {
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let y = 0; y < height; y++) typeIds[y * width + waterX] = WATER;
  return { resolution: 'half-cell', width, height, typeIds };
}

describe('military module - the muster', () => {
  it('leaves soldiers already formed up at the barracks alone', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    spawn(sim, 3, { x: rally.x, y: rally.y + 1 });

    // They keep the fighter default ATTACK stance, so the settlement stays defended while they wait.
    expect(run(sim)).toEqual([]);
  });

  it('pins the launch-roll seeds to the draws the wave cases assume', () => {
    expect(new Rng(EAGER_SEED).int(WAVE_LAUNCH_SPREAD)).toBe(0);
    expect(new Rng(PATIENT_SEED).int(WAVE_LAUNCH_SPREAD)).toBe(WAVE_LAUNCH_SPREAD - 1);
  });

  it('calls an idle soldier inside the settlement in to the barracks door', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    const [stray] = spawn(sim, 1, { x: rally.x + RALLY_HOLD_RADIUS_NODES + 2, y: rally.y });
    if (stray === undefined) throw new Error('setup: no soldier');

    expect(run(sim)).toEqual([{ kind: 'moveUnit', entity: stray, x: rally.x, y: rally.y }]);
  });

  it('leaves a soldier on an errand the recall would throw away', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    const [drilling] = spawn(sim, 1, { x: rally.x + RALLY_HOLD_RADIUS_NODES + 2, y: rally.y });
    if (drilling === undefined) throw new Error('setup: no soldier');
    // A `moveUnit` recall strips a drill order (orders/movement.ts), so the muster must not issue one.
    sim.world.add(drilling, TrainingOrder, {
      house: buildingOfType(sim, BARRACKS_TYPE, SEAT),
      drillTicksLeft: 100,
    });

    expect(run(sim)).toEqual([]);
  });

  it('leaves a soldier already walking somewhere to finish first', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    const [stray] = spawn(sim, 1, { x: rally.x + RALLY_HOLD_RADIUS_NODES + 2, y: rally.y });
    if (stray === undefined) throw new Error('setup: no soldier');
    sim.enqueue({ kind: 'moveUnit', entity: stray, x: rally.x + 20, y: rally.y + 20 });
    sim.step();

    expect(run(sim)).toEqual([]);
  });

  it('does nothing at all for a seat with no barracks', () => {
    const sim = aiSim();
    place(sim, HQ_TYPE, BARRACKS);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    spawn(sim, CERTAIN_WAVE, { x: BARRACKS.x + 1, y: BARRACKS.y + 1 });

    expect(run(sim)).toEqual([]);
  });

  it('counts the muster by weapon class and passes over men already in a fight', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    spawn(sim, 2, { x: rally.x, y: rally.y + 1 }, BOWMAN);
    spawn(sim, 3, { x: rally.x, y: rally.y + 3 }, SPEARMAN);
    const [unarmed] = spawn(sim, 1, { x: rally.x, y: rally.y + 5 }, SOLDIER);
    spawn(sim, 4, { x: rally.x, y: rally.y + 7 }, CIVILIST); // not fighters
    const [busy] = spawn(sim, 1, { x: rally.x, y: rally.y + 9 }, SPEARMAN);
    const [outrider] = spawn(sim, 1, { x: rally.x + MUSTER_HOME_RADIUS_NODES + 10, y: rally.y }, SPEARMAN);
    if (unarmed === undefined || busy === undefined || outrider === undefined) {
      throw new Error('setup: no soldier');
    }
    sim.world.add(busy, Engagement, { repathAt: 0 });

    const ctx = ctxOf(sim);
    const army = takeCensus(sim.world, ctx, terrainOf(sim), SEAT, rally.node);

    expect(army.ranged).toBe(2); // the two bowmen
    expect(army.melee).toBe(4); // three spearmen and the unarmed recruit, who goes in with his fists
    expect(army.muster).toContain(unarmed);
    expect(army.muster).not.toContain(busy);
    expect(army.afield).toEqual([outrider]);
  });

  it('splits the army at the settlement edge', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    const [inside] = spawn(sim, 1, { x: rally.x, y: rally.y + MUSTER_HOME_RADIUS_NODES });
    const [outside] = spawn(sim, 1, { x: rally.x, y: rally.y + MUSTER_HOME_RADIUS_NODES + 1 });

    const army = takeCensus(sim.world, ctxOf(sim), terrainOf(sim), SEAT, rally.node);
    expect(army.muster).toEqual([inside]);
    expect(army.afield).toEqual([outside]);
  });
});

describe('military module - the campaign', () => {
  /** A seat with a barracks and `count` standing soldiers, and an enemy seat with a headquarters. */
  function armedSim(count: number, jobType = SOLDIER): Simulation {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    const rally = rallyOf(sim);
    spawn(sim, count, { x: rally.x, y: rally.y + 1 }, jobType);
    return sim;
  }

  it('marches the whole muster on the nearest enemy headquarters once it is strong enough', () => {
    const sim = armedSim(WAVE_MIN_SOLDIERS);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);

    const commands = run(sim);
    expect(attackTargets(commands)).toEqual(new Array(WAVE_MIN_SOLDIERS).fill(foeHq));
    // Fighters already stand in the ATTACK stance, so the march re-states nothing.
    expect(stanceModes(commands)).toEqual([]);
  });

  it('keeps a muster below the wave minimum at home', () => {
    const commands = run(armedSim(WAVE_MIN_SOLDIERS - 1));
    expect(attackTargets(commands)).toEqual([]);
    // Nobody is sent out; the ones the row spread put outside the rally ring are called back in.
    expect(commands.every((c) => c.kind === 'moveUnit')).toBe(true);
  });

  it('varies the wave: the same muster marches in one game and waits in another', () => {
    const sim = armedSim(WAVE_MIN_SOLDIERS);
    expect(attackTargets(run(sim, EAGER_SEED))).toHaveLength(WAVE_MIN_SOLDIERS);
    expect(attackTargets(run(sim, PATIENT_SEED))).toEqual([]);

    // A muster the full spread over the minimum leaves whatever the draw.
    expect(attackTargets(run(armedSim(CERTAIN_WAVE), PATIENT_SEED))).toHaveLength(CERTAIN_WAVE);
  });

  it('never marches a shooting line with nobody in front of it', () => {
    const sim = armedSim(CERTAIN_WAVE, BOWMAN);
    expect(attackTargets(run(sim))).toEqual([]);

    // One man who fights in reach is enough to send them all.
    const rally = rallyOf(sim);
    spawn(sim, 1, { x: rally.x, y: rally.y + 9 }, SPEARMAN);
    expect(attackTargets(run(sim))).toHaveLength(CERTAIN_WAVE + 1);
  });

  it('re-aims a wave that outlived its objective instead of recalling it', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    const rally = rallyOf(sim);
    const [survivor] = spawn(sim, 1, { x: rally.x + MUSTER_HOME_RADIUS_NODES + 10, y: rally.y });
    if (survivor === undefined) throw new Error('setup: no soldier');

    // One man, far from home and far under the wave minimum - he still gets the next objective.
    expect(run(sim)).toEqual([
      { kind: 'attackUnit', entity: survivor, target: buildingOfType(sim, HQ_TYPE, FOE) },
    ]);
  });

  it('re-states the attack stance for a fighter that came off a defended post', () => {
    const sim = armedSim(CERTAIN_WAVE);
    for (const e of sim.world.query(Settler, Owner)) {
      if (sim.world.get(e, Owner).player === SEAT) {
        sim.world.add(e, Stance, { mode: MILITARY_MODE.DEFEND, anchorCell: null });
      }
    }
    expect(stanceModes(run(sim))).toEqual(new Array(CERTAIN_WAVE).fill(MILITARY_MODE.ATTACK));
  });

  it('leaves a fighter already chasing its focus alone', () => {
    const sim = armedSim(WAVE_MIN_SOLDIERS);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    for (const e of sim.world.query(Settler, Owner)) {
      if (sim.world.get(e, Owner).player === SEAT) sim.world.add(e, AttackOrder, { target: foeHq });
    }
    expect(run(sim)).toEqual([]);
  });

  it('falls back to another standing enemy building, then to enemy people', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, FARM_TYPE, { x: 60, y: 30 }, FOE); // no hitpoints in this content - nothing to strike
    place(sim, STOCK_TYPE, { x: 80, y: 30 }, FOE);
    const rally = rallyOf(sim);
    spawn(sim, CERTAIN_WAVE, { x: rally.x, y: rally.y + 1 });

    const store = buildingOfType(sim, STOCK_TYPE, FOE);
    expect(attackTargets(run(sim))[0]).toBe(store);

    // With the store gone, the seat marches on the enemy's people.
    sim.world.destroy(store);
    const [villager] = spawn(sim, 1, { x: 70, y: 40 }, CIVILIST, FOE);
    expect(attackTargets(run(sim))[0]).toBe(villager);
  });

  it('ignores an enemy it cannot walk to', () => {
    const sim = aiSim(splitNodeMap(128, 96, 64));
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, HQ_TYPE, FOE_HQ, FOE); // the far bank
    const rally = rallyOf(sim);
    spawn(sim, CERTAIN_WAVE, { x: rally.x, y: rally.y + 1 });

    expect(attackTargets(run(sim))).toEqual([]);
  });

  it('marches on the enemy seat over a closer tower and an even closer barn', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    place(sim, STOCK_TYPE, { x: rally.x + 20, y: rally.y }, FOE);
    place(sim, TOWER_TYPE, { x: rally.x + 40, y: rally.y }, FOE);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    spawn(sim, CERTAIN_WAVE, { x: rally.x, y: rally.y + 1 });

    // The tiers are the CombatSystem's own siege priority: seat, then towers, then the rest.
    expect(attackTargets(run(sim))[0]).toBe(buildingOfType(sim, HQ_TYPE, FOE));
    sim.world.destroy(buildingOfType(sim, HQ_TYPE, FOE));
    expect(attackTargets(run(sim))[0]).toBe(buildingOfType(sim, TOWER_TYPE, FOE));
  });

  it('never marches on its own settlement', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, HQ_TYPE, { x: 40, y: 40 });
    const rally = rallyOf(sim);
    spawn(sim, CERTAIN_WAVE, { x: rally.x, y: rally.y + 1 });

    expect(attackTargets(run(sim))).toEqual([]);
  });
});

describe('military module - the live seat', () => {
  /** Ticks to watch a launched wave: the seat decides on tick 2, and the rest is walking. */
  const MARCH_TICKS = 150;

  /** An AI-driven seat with a barracks and a full wave, and an enemy seat within marching reach. */
  function warSim(modules?: Partial<AiModuleEnables>): Simulation {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    place(sim, HQ_TYPE, { x: rally.x + 40, y: rally.y + 20 }, FOE);
    spawn(sim, CERTAIN_WAVE, { x: rally.x, y: rally.y + 1 });
    sim.enqueue({ kind: 'setPlayerAi', player: SEAT, enabled: true, ...(modules ? { modules } : {}) });
    return sim;
  }

  /** How close the seat's nearest fighter has come to `target`, in half-cell nodes. */
  function closestApproach(sim: Simulation, target: Entity): number {
    const terrain = terrainOf(sim);
    const door = interactionCell(sim.world, ctxOf(sim), terrain, target);
    let best = Number.POSITIVE_INFINITY;
    for (const e of sim.world.query(Settler, Owner)) {
      if (sim.world.get(e, Owner).player !== SEAT) continue;
      best = Math.min(best, manhattan(terrain, entityNode(sim.world, terrain, e), door));
    }
    return best;
  }

  it('sends the wave through the real tick schedule, and it closes on the enemy seat', () => {
    const sim = warSim();
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    const start = closestApproach(sim, foeHq);
    sim.run(MARCH_TICKS);

    const marching = [...sim.world.query(AttackOrder)];
    expect(marching).toHaveLength(CERTAIN_WAVE);
    expect(marching.every((e) => sim.world.get(e, AttackOrder).target === foeHq)).toBe(true);
    expect(sim.commands.log.some((c) => c.command.kind === 'attackUnit')).toBe(true);
    expect(closestApproach(sim, foeHq)).toBeLessThan(start);
    expect(sim.world.get(foeHq, Health).hitpoints).toBeGreaterThan(0); // still standing, just besieged
  });

  it('stays out of the war when the seat has its military module switched off', () => {
    const sim = warSim({ military: false });
    sim.run(MARCH_TICKS);
    expect([...sim.world.query(AttackOrder)]).toEqual([]);
  });

  it('reaches the same state twice from one seed, and the log replays it', () => {
    const a = warSim();
    a.run(MARCH_TICKS);
    const b = warSim();
    b.run(MARCH_TICKS);
    expect(a.hashState()).toBe(b.hashState());

    const replayed = replay({
      content: aiContent(),
      seed: 1,
      map: grassNodeMap(128, 96),
      log: a.commands.log,
      untilTick: a.tick, // the setup steps count too, so replay to the live run's own clock
    });
    expect(replayed.hashState()).toBe(a.hashState());
  });
});
