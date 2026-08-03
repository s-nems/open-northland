import { describe, expect, it } from 'vitest';
import {
  type AiModuleEnables,
  AssistantRecruit,
  AttackOrder,
  Building,
  Engagement,
  Health,
  MoveGoal,
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
  campaignTarget,
  militaryModule,
  RALLY_HOLD_RADIUS_NODES,
  takeCensus,
  WAVE_FULL_SOLDIERS,
  WAVE_MIN_SOLDIERS,
  weaponMix,
} from '../../src/systems/ai-player/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { interactionCell } from '../../src/systems/settlers/targets/index.js';
import { entityNode, manhattan } from '../../src/systems/spatial/nodes.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The strategic AI's military module: the muster it keeps at its barracks door, the pseudo-random size a
 * wave grows to before it leaves there, and who it takes - armed men only, with the recruits still
 * waiting for a weapon left at home.
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
const FIST = 31;
const SPEARMAN = 32;
const BOWMAN = 40;
const CIVILIST = 6;

/** The seat's barracks - the muster point every case forms up around. */
const BARRACKS = { x: 30, y: 30 };
/** The enemy seat, far enough that no objective ever falls inside the seat's own muster ring. */
const FOE_HQ = { x: 110, y: 70 };
/** The launch roll's band: `int(WAVE_BAND) <= strength over the minimum`. */
const WAVE_BAND = WAVE_FULL_SOLDIERS - WAVE_MIN_SOLDIERS + 1;
/** A full band with no doubt about the launch roll: this many march on any draw. */
const CERTAIN_WAVE = WAVE_FULL_SOLDIERS;

/** A seed whose first `int(WAVE_BAND)` draw is 0 - a bare-minimum group marches. */
const EAGER_SEED = 7;
/** A seed whose first draw is the top of the band - that same group waits. */
const PATIENT_SEED = 43;

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
  jobType = SPEARMAN,
  owner = SEAT,
): Entity[] {
  return spawnAt(
    sim,
    Array.from({ length: count }, (_, i) => ({ x: at.x + 2 * (i % 8), y: at.y + 2 * Math.floor(i / 8) })),
    jobType,
    owner,
  );
}

/** Settlers packed into the hold ring of `at`, so all of them count as one body formed up there. */
function pack(sim: Simulation, count: number, at: { x: number; y: number }, jobType = SPEARMAN): Entity[] {
  const spots: { x: number; y: number }[] = [];
  for (let r = 0; r <= RALLY_HOLD_RADIUS_NODES && spots.length < count; r++) {
    for (let dy = -r; dy <= r && spots.length < count; dy++) {
      const dx = r - Math.abs(dy);
      spots.push({ x: at.x + dx, y: at.y + dy });
      if (dx !== 0 && spots.length < count) spots.push({ x: at.x - dx, y: at.y + dy });
    }
  }
  return spawnAt(sim, spots, jobType, SEAT);
}

function spawnAt(
  sim: Simulation,
  spots: readonly { x: number; y: number }[],
  jobType: number,
  owner: number,
): Entity[] {
  const before = new Set(sim.world.query(Settler));
  for (const { x, y } of spots) {
    sim.enqueue({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner });
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

/** Where the recall sends men. It walks them under an attack-move, so a man crossing contested ground
 *  can still answer what shoots at him. */
function recalls(commands: readonly Command[]): { entity: Entity; x: number; y: number }[] {
  return commands.flatMap((c) => (c.kind === 'attackMoveUnit' ? [{ entity: c.entity, x: c.x, y: c.y }] : []));
}

/** How many of `commands` walk a man to his own spot in the hold ring around `rally` - the band gathers
 *  spread out, so no destination is the rally node itself for everyone. */
function gatheringAt(sim: Simulation, commands: readonly Command[], rally: { x: number; y: number }): number {
  const terrain = terrainOf(sim);
  const centre = terrain.nodeAtClamped(rally.x, rally.y);
  return recalls(commands).filter(
    (d) => manhattan(terrain, terrain.nodeAtClamped(d.x, d.y), centre) <= RALLY_HOLD_RADIUS_NODES,
  ).length;
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
    pack(sim, 3, { x: rally.x, y: rally.y });

    // They keep the fighter default ATTACK stance, so the settlement stays defended while they wait.
    expect(run(sim)).toEqual([]);
  });

  it('pins the launch-roll seeds to the draws the wave cases assume', () => {
    expect(new Rng(EAGER_SEED).int(WAVE_BAND)).toBe(0);
    expect(new Rng(PATIENT_SEED).int(WAVE_BAND)).toBe(WAVE_BAND - 1);
  });

  it('calls an idle soldier inside the settlement in to the barracks door', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    const [stray] = spawn(sim, 1, { x: rally.x + RALLY_HOLD_RADIUS_NODES + 2, y: rally.y });
    if (stray === undefined) throw new Error('setup: no soldier');

    const commands = run(sim);
    expect(recalls(commands)).toHaveLength(1);
    expect(gatheringAt(sim, commands, rally)).toBe(1);
    expect(commands.some((c) => c.kind === 'attackMoveUnit' && c.entity === stray)).toBe(true);
  });

  it('leaves a soldier on an errand the recall would throw away', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    const [drilling] = spawn(sim, 1, { x: rally.x + RALLY_HOLD_RADIUS_NODES + 2, y: rally.y });
    if (drilling === undefined) throw new Error('setup: no soldier');
    // A recall strips a drill order (orders/movement.ts), so the muster must not issue one.
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

  it('sorts the seat by weapon in hand, and passes over men already in a fight', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    spawn(sim, 2, { x: rally.x, y: rally.y + 1 }, BOWMAN);
    spawn(sim, 3, { x: rally.x, y: rally.y + 3 }, SPEARMAN);
    const [waiting, fists] = spawn(sim, 2, { x: rally.x, y: rally.y + 5 }, FIST);
    spawn(sim, 4, { x: rally.x, y: rally.y + 7 }, CIVILIST); // not fighters
    const [busy] = spawn(sim, 1, { x: rally.x, y: rally.y + 9 }, SPEARMAN);
    if (waiting === undefined || fists === undefined || busy === undefined) {
      throw new Error('setup: no soldier');
    }
    // A booking says a weapon is on its way to this one; nobody is arming the other.
    sim.world.add(waiting, AssistantRecruit, { intent: 'trainSword', armed: false });
    sim.world.add(busy, Engagement, { repathAt: 0 });

    const ctx = ctxOf(sim);
    const army = takeCensus(sim.world, ctx, SEAT);

    expect(army.awaitingWeapon).toEqual([waiting]);
    expect(army.ready).toContain(fists); // it is his fists or nothing - he goes in
    expect(army.ready).not.toContain(waiting);
    expect(army.ready).not.toContain(busy);

    const mix = weaponMix(sim.world, ctx, army.ready);
    expect(mix.ranged).toBe(2); // the two bowmen
    expect(mix.melee).toBe(4); // three spearmen and the fist fighter, who has no reach to keep
  });

  it('keeps a recruit still waiting for his weapon at home while the wave leaves', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    const rally = rallyOf(sim);
    pack(sim, WAVE_MIN_SOLDIERS, rally);
    const [waiting] = spawn(sim, 1, { x: rally.x + RALLY_HOLD_RADIUS_NODES + 2, y: rally.y });
    if (waiting === undefined) throw new Error('setup: no recruit');
    sim.world.add(waiting, AssistantRecruit, { intent: 'trainSword', armed: false });
    sim.enqueue({ kind: 'setJob', entity: waiting, jobType: FIST });
    sim.step();

    // The armed men march; he is called in to the barracks to be armed.
    const commands = run(sim);
    expect(attackTargets(commands)).toHaveLength(WAVE_MIN_SOLDIERS);
    expect(commands.some((c) => c.kind === 'attackMoveUnit' && c.entity === waiting)).toBe(true);
    expect(gatheringAt(sim, commands, rally)).toBe(1);
  });
});

describe('military module - the campaign', () => {
  /** A seat with a barracks and `count` standing soldiers spread over its settlement, and an enemy seat
   *  with a headquarters. The row spread puts most of them outside the rally ring. */
  function armedSim(count: number, jobType = SPEARMAN): Simulation {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    const rally = rallyOf(sim);
    spawn(sim, count, { x: rally.x, y: rally.y + 1 }, jobType);
    return sim;
  }

  /** The same seat with `count` soldiers already formed up at the barracks door - a band ready to leave. */
  function bandSim(count: number, jobType = SPEARMAN): Simulation {
    const sim = armedSim(0);
    pack(sim, count, rallyOf(sim), jobType);
    return sim;
  }

  function seatBand(sim: Simulation): Entity[] {
    return [...sim.world.query(Settler, Owner)].filter((e) => sim.world.get(e, Owner).player === SEAT);
  }

  it('sends the formed band from the barracks straight at the enemy seat', () => {
    const sim = bandSim(WAVE_MIN_SOLDIERS);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);

    // No forming-up point on the way: the whole pause happened at home, so the wave leaves in one order
    // and walks the map under it.
    const commands = run(sim);
    expect(attackTargets(commands)).toEqual(new Array(WAVE_MIN_SOLDIERS).fill(foeHq));
    expect(recalls(commands)).toEqual([]);
  });

  it('holds the band at its own door until the launch roll comes up', () => {
    const sim = bandSim(WAVE_MIN_SOLDIERS);

    // Formed up at home on the fighter default, so a lost roll costs the seat nothing to say: they wait
    // where the settlement can use them.
    expect(run(sim, PATIENT_SEED)).toEqual([]);
    expect(attackTargets(run(sim, EAGER_SEED))).toHaveLength(WAVE_MIN_SOLDIERS);
  });

  it('puts a man off the fighter default back on the attack for the march', () => {
    const sim = bandSim(WAVE_MIN_SOLDIERS);
    for (const e of seatBand(sim)) sim.world.add(e, Stance, { mode: MILITARY_MODE.DEFEND, anchorCell: null });

    const commands = run(sim);
    expect(attackTargets(commands)).toHaveLength(WAVE_MIN_SOLDIERS);
    expect(stanceModes(commands)).toEqual(new Array(WAVE_MIN_SOLDIERS).fill(MILITARY_MODE.ATTACK));
  });

  it('leaves a man on an errand out of the wave rather than marching him off it', () => {
    const sim = bandSim(WAVE_MIN_SOLDIERS + 1);
    const [drilling] = seatBand(sim);
    if (drilling === undefined) throw new Error('setup: no soldier');
    // `attackUnit` does not clear a drill or an equip run, so a man the recall refuses to walk six nodes
    // must not be sent the whole way to the enemy either - and the roll must be taken without him.
    sim.world.add(drilling, TrainingOrder, {
      house: buildingOfType(sim, BARRACKS_TYPE, SEAT),
      drillTicksLeft: 100,
    });

    const commands = run(sim);
    expect(attackTargets(commands)).toHaveLength(WAVE_MIN_SOLDIERS);
    expect(commands.some((c) => 'entity' in c && c.entity === drilling)).toBe(false);
  });

  it('sends a band that already stands on enemy ground at the objective, never home for it', () => {
    const sim = armedSim(0);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    // The wave that took the last objective, standing where it fell and nearer the next one than home -
    // but out of sight of it, so they are the module's to order rather than already engaged.
    spawn(sim, WAVE_MIN_SOLDIERS, { x: FOE_HQ.x - 30, y: FOE_HQ.y });

    // A lost roll must not walk them back across the ground they hold; they go in whatever it says.
    const commands = run(sim, PATIENT_SEED);
    expect(attackTargets(commands)).toEqual(new Array(WAVE_MIN_SOLDIERS).fill(foeHq));
    expect(recalls(commands)).toEqual([]);
  });

  it('calls survivors too few to be a wave home rather than feeding them to the objective', () => {
    const sim = armedSim(0);
    const rally = rallyOf(sim);
    const [survivor] = spawn(sim, WAVE_MIN_SOLDIERS - 1, { x: FOE_HQ.x - 30, y: FOE_HQ.y });
    if (survivor === undefined) throw new Error('setup: no soldier');

    // Forward of the halfway mark, but a handful is not a wave: the size floor is about who the seat
    // sends anywhere, not about where the last fight happened to leave them.
    const commands = run(sim, PATIENT_SEED);
    expect(attackTargets(commands)).toEqual([]);
    expect(gatheringAt(sim, commands, rally)).toBe(WAVE_MIN_SOLDIERS - 1);
  });

  it('leaves a man it cannot walk to the objective out of the march', () => {
    const sim = aiSim(splitNodeMap(128, 96, 64));
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, HQ_TYPE, { x: 50, y: 70 }, FOE); // the barracks' own bank
    // Manhattan-nearer the enemy seat than the barracks, but across the water from both.
    spawn(sim, WAVE_MIN_SOLDIERS, { x: 70, y: 70 });

    // An attack order aimed over the water would never resolve: he would leave the census for good and
    // be re-issued the same dead order every decision.
    expect(run(sim)).toEqual([]);
  });

  it('calls the stragglers in and sends nobody while the muster is short', () => {
    const sim = armedSim(WAVE_MIN_SOLDIERS - 1);
    const rally = rallyOf(sim);

    const commands = run(sim);
    expect(attackTargets(commands)).toEqual([]);
    expect(recalls(commands).length).toBeGreaterThan(0);
    expect(gatheringAt(sim, commands, rally)).toBe(recalls(commands).length);
  });

  it('varies the wave: the same band leaves in one game and waits in another', () => {
    const sim = bandSim(WAVE_MIN_SOLDIERS);
    expect(attackTargets(run(sim, EAGER_SEED))).toHaveLength(WAVE_MIN_SOLDIERS);
    expect(attackTargets(run(sim, PATIENT_SEED))).toEqual([]);

    // A full band leaves whatever the draw.
    expect(attackTargets(run(bandSim(CERTAIN_WAVE), PATIENT_SEED))).toHaveLength(CERTAIN_WAVE);
  });

  it('never marches a shooting line while the seat still owns somebody to lead it', () => {
    const sim = bandSim(WAVE_MIN_SOLDIERS, BOWMAN);
    const rally = rallyOf(sim);
    // The one spearman is still walking in, so the seat HAS a front rank - it just is not formed up yet.
    spawn(sim, 1, { x: rally.x + RALLY_HOLD_RADIUS_NODES + 2, y: rally.y }, SPEARMAN);
    expect(attackTargets(run(sim))).toEqual([]);

    // And once one of them stands with the band, the band goes in.
    spawn(sim, 1, { x: rally.x + RALLY_HOLD_RADIUS_NODES - 1, y: rally.y }, SPEARMAN);
    expect(attackTargets(run(sim))).toHaveLength(WAVE_MIN_SOLDIERS + 1);
  });

  it('sends an all-archer army rather than benching it for a swordsman it will never own', () => {
    // Nobody in the whole army fights in reach, so the melee core is waived: holding out for a front
    // rank the seat cannot raise would bench its army for the rest of the game.
    expect(attackTargets(run(bandSim(CERTAIN_WAVE, BOWMAN)))).toHaveLength(CERTAIN_WAVE);
  });

  it('walks a lone survivor home instead of sending him at the enemy', () => {
    const sim = armedSim(0);
    const rally = rallyOf(sim);
    const [survivor] = spawn(sim, 1, { x: rally.x + 20, y: rally.y }); // still nearer his own door
    if (survivor === undefined) throw new Error('setup: no soldier');

    // One man is no wave: he comes back to the barracks, where the army waits on the attack so it meets
    // whatever comes to the door.
    const commands = run(sim);
    expect(attackTargets(commands)).toEqual([]);
    expect(recalls(commands)).toHaveLength(1);
    expect(gatheringAt(sim, commands, rally)).toBe(1);
    expect(commands.some((c) => c.kind === 'attackMoveUnit' && c.entity === survivor)).toBe(true);
    expect(stanceModes(commands)).toEqual([]); // a fighter already defaults to ATTACK - nothing to restate
  });

  it('gathers the next rank into a wave of its own instead of trickling it out behind the first', () => {
    const sim = armedSim(0);
    const rally = rallyOf(sim);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    // The wave that just left carries its attack orders, so the census no longer counts it.
    for (const e of spawn(sim, WAVE_MIN_SOLDIERS, { x: rally.x + 40, y: rally.y })) {
      sim.world.add(e, AttackOrder, { target: foeHq });
    }
    pack(sim, WAVE_MIN_SOLDIERS - 1, rally); // one short of a wave of their own

    // Too few to leave, and the men already out are no help to them: they hold the door.
    expect(run(sim)).toEqual([]);
    pack(sim, 1, { x: rally.x, y: rally.y + 1 });
    expect(attackTargets(run(sim))).toHaveLength(WAVE_MIN_SOLDIERS);
  });

  it('leaves a fighter already chasing its focus alone', () => {
    const sim = bandSim(WAVE_MIN_SOLDIERS);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    for (const e of sim.world.query(Settler, Owner)) {
      if (sim.world.get(e, Owner).player === SEAT) sim.world.add(e, AttackOrder, { target: foeHq });
    }
    expect(run(sim)).toEqual([]);
  });

  it('leaves a soldier mid-march alone rather than turning his stance on the road', () => {
    const sim = armedSim(0);
    const rally = rallyOf(sim);
    const [walker] = spawn(sim, 1, { x: rally.x + 40, y: rally.y });
    if (walker === undefined) throw new Error('setup: no soldier');
    sim.world.add(walker, Stance, { mode: MILITARY_MODE.DEFEND, anchorCell: null });
    sim.world.add(walker, MoveGoal, { cell: terrainOf(sim).nodeAtClamped(rally.x, rally.y) });

    // He is travelling, so the drive will not re-route him - and flipping his stance alone would drop him
    // to ATTACK on the road, where he picks his own fight and leaves the census.
    expect(run(sim, PATIENT_SEED)).toEqual([]);
  });

  it('calls everyone home when there is nothing left to march on', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    const [survivor] = spawn(sim, 1, { x: rally.x + 60, y: rally.y });
    if (survivor === undefined) throw new Error('setup: no soldier');

    const commands = run(sim);
    expect(recalls(commands)).toHaveLength(1);
    expect(gatheringAt(sim, commands, rally)).toBe(1);
    expect(commands.some((c) => c.kind === 'attackMoveUnit' && c.entity === survivor)).toBe(true);
  });
});

describe('military module - the objective', () => {
  function targetOf(sim: Simulation): Entity | null {
    return campaignTarget(sim.world, ctxOf(sim), terrainOf(sim), SEAT, rallyOf(sim).node);
  }

  it('falls back to another standing enemy building, then to enemy people', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, FARM_TYPE, { x: 60, y: 30 }, FOE); // no hitpoints in this content - nothing to strike
    place(sim, STOCK_TYPE, { x: 80, y: 30 }, FOE);

    const store = buildingOfType(sim, STOCK_TYPE, FOE);
    expect(targetOf(sim)).toBe(store);

    // With the store gone, the seat marches on the enemy's people.
    sim.world.destroy(store);
    const [villager] = spawn(sim, 1, { x: 70, y: 40 }, CIVILIST, FOE);
    expect(targetOf(sim)).toBe(villager);
  });

  it('ignores an enemy it cannot walk to', () => {
    const sim = aiSim(splitNodeMap(128, 96, 64));
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, HQ_TYPE, FOE_HQ, FOE); // the far bank

    expect(targetOf(sim)).toBeNull();
  });

  it('marches on the enemy seat over a closer tower and an even closer barn', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    place(sim, STOCK_TYPE, { x: rally.x + 20, y: rally.y }, FOE);
    place(sim, TOWER_TYPE, { x: rally.x + 40, y: rally.y }, FOE);
    place(sim, HQ_TYPE, FOE_HQ, FOE);

    // The tiers are the CombatSystem's own siege priority: seat, then towers, then the rest.
    expect(targetOf(sim)).toBe(buildingOfType(sim, HQ_TYPE, FOE));
    sim.world.destroy(buildingOfType(sim, HQ_TYPE, FOE));
    expect(targetOf(sim)).toBe(buildingOfType(sim, TOWER_TYPE, FOE));
  });

  it('never marches on its own settlement', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, HQ_TYPE, { x: 40, y: 40 });

    expect(targetOf(sim)).toBeNull();
  });
});

// These three drive the real tick schedule for a full march, so they share the CPU with the whole suite -
// the explicit timeout keeps a loaded machine from flaking them (the convention in ai-player-modules).
describe('military module - the live seat', { timeout: 60_000 }, () => {
  /** Ticks to watch a wave: the seat calls its men in to the barracks door, rolls, and marches them the
   *  whole way from there. */
  const MARCH_TICKS = 1200;
  /** Enough men that the launch rolls come up well inside {@link MARCH_TICKS}, cheap enough to run the
   *  whole schedule three times for the replay case. */
  const WAR_BAND = 12;

  /** An AI-driven seat with a barracks and a wave, and an enemy seat within marching reach. */
  function warSim(modules?: Partial<AiModuleEnables>): Simulation {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    place(sim, HQ_TYPE, { x: rally.x + 40, y: rally.y + 20 }, FOE);
    spawn(sim, WAR_BAND, { x: rally.x, y: rally.y + 1 });
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

    // Every man ends up on the objective, and each wave left as one body from the barracks.
    const marching = [...sim.world.query(AttackOrder)];
    expect(marching).toHaveLength(WAR_BAND);
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
