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
  objectiveNode,
  RALLY_HOLD_RADIUS_NODES,
  STAGING_STANDOFF_NODES,
  stagingNode,
  takeCensus,
  WAVE_FULL_SOLDIERS,
  WAVE_MIN_SOLDIERS,
  weaponMix,
} from '../../src/systems/ai-player/index.js';
import { combatTargetNode } from '../../src/systems/conflict/target-node.js';
import type { SystemContext } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { interactionCell } from '../../src/systems/settlers/targets/index.js';
import { entityNode, manhattan } from '../../src/systems/spatial/nodes.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The strategic AI's military module: the muster it keeps at its barracks, the pseudo-random size a wave
 * grows to before it leaves, the staging point it forms up at short of the objective, and who it takes -
 * armed men only, with the recruits still waiting for a weapon left at home.
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

/** Where the seat's waves form up against `target`, as a node and as coordinates to spawn around. */
function stagingOf(sim: Simulation, target: Entity): { node: NodeId; x: number; y: number } {
  const terrain = terrainOf(sim);
  const home = rallyOf(sim).node;
  // The module stages off the wall the band would reach, not the door - mirror it here or the helper
  // names a point the module never picks.
  const face = combatTargetNode(sim.world, ctxOf(sim), terrain, home, target);
  const node = stagingNode(terrain, home, face);
  if (node === null) throw new Error('setup: the objective stands too close to stage against');
  return { node, ...terrain.coordsOf(node) };
}

function run(sim: Simulation, seed = EAGER_SEED): Command[] {
  return [...militaryModule.run(sim.world, ctxOf(sim, seed), SEAT)];
}

function attackTargets(commands: readonly Command[]): Entity[] {
  return commands.flatMap((c) => (c.kind === 'attackUnit' ? [c.target] : []));
}

function moveDestinations(commands: readonly Command[]): { x: number; y: number }[] {
  return commands.flatMap((c) => (c.kind === 'moveUnit' ? [{ x: c.x, y: c.y }] : []));
}

/** How many of `commands` walk a man to his own spot in the hold ring around `rally` - the band gathers
 *  spread out, so no destination is the rally node itself for everyone. */
function gatheringAt(sim: Simulation, commands: readonly Command[], rally: { x: number; y: number }): number {
  const terrain = terrainOf(sim);
  const centre = terrain.nodeAtClamped(rally.x, rally.y);
  return moveDestinations(commands).filter(
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
    expect(moveDestinations(commands)).toHaveLength(1);
    expect(gatheringAt(sim, commands, rally)).toBe(1);
    expect(commands.some((c) => c.kind === 'moveUnit' && c.entity === stray)).toBe(true);
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
    spawn(sim, WAVE_MIN_SOLDIERS, { x: rally.x, y: rally.y + 1 });
    const [waiting] = spawn(sim, 1, { x: rally.x + RALLY_HOLD_RADIUS_NODES + 2, y: rally.y });
    if (waiting === undefined) throw new Error('setup: no recruit');
    sim.world.add(waiting, AssistantRecruit, { intent: 'trainSword', armed: false });
    sim.enqueue({ kind: 'setJob', entity: waiting, jobType: FIST });
    sim.step();

    const staging = stagingOf(sim, buildingOfType(sim, HQ_TYPE, FOE));
    const commands = run(sim);
    expect(attackTargets(commands)).toEqual([]);
    // The armed men head for the staging point; he is called in to the barracks to be armed.
    expect(commands.some((c) => c.kind === 'moveUnit' && c.entity === waiting)).toBe(true);
    expect(gatheringAt(sim, commands, rally)).toBe(1);
    expect(gatheringAt(sim, commands, staging)).toBe(WAVE_MIN_SOLDIERS);
  });
});

describe('military module - the campaign', () => {
  /** A seat with a barracks and `count` standing soldiers, and an enemy seat with a headquarters. */
  function armedSim(count: number, jobType = SPEARMAN): Simulation {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    const rally = rallyOf(sim);
    spawn(sim, count, { x: rally.x, y: rally.y + 1 }, jobType);
    return sim;
  }

  it('sends the wave to form up short of the enemy seat, not straight at it', () => {
    const sim = armedSim(WAVE_MIN_SOLDIERS);
    const terrain = terrainOf(sim);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    const staging = stagingOf(sim, foeHq);

    const commands = run(sim);
    expect(attackTargets(commands)).toEqual([]);
    expect(gatheringAt(sim, commands, staging)).toBe(WAVE_MIN_SOLDIERS);
    // The forming-up point stands one standoff short of the WALL the band would reach, on the way home -
    // measured off the door, a big house would let the muster stand against its near side.
    const home = rallyOf(sim).node;
    const face = combatTargetNode(sim.world, ctxOf(sim), terrain, home, foeHq);
    expect(Math.abs(manhattan(terrain, staging.node, face) - STAGING_STANDOFF_NODES)).toBeLessThanOrEqual(1);
    expect(manhattan(terrain, staging.node, home)).toBeLessThan(manhattan(terrain, face, home));
  });

  it('stages off the wall it would reach, not off a door on the far side', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    // Due south, so the band comes at its north wall while the fixture HQ's door faces south.
    place(sim, HQ_TYPE, { x: BARRACKS.x, y: BARRACKS.y + 60 }, FOE);
    const terrain = terrainOf(sim);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    const home = rallyOf(sim).node;
    const staging = stagingOf(sim, foeHq);

    const wall = combatTargetNode(sim.world, ctxOf(sim), terrain, home, foeHq);
    const door = objectiveNode(sim.world, ctxOf(sim), terrain, foeHq);
    expect(manhattan(terrain, staging.node, wall)).toBeLessThanOrEqual(STAGING_STANDOFF_NODES + 1);
    // Measured off the door instead, the same standoff would put the band against that near wall.
    expect(manhattan(terrain, staging.node, door)).toBeGreaterThan(STAGING_STANDOFF_NODES + 1);
  });

  it('charges the objective once the group has formed up at the staging point', () => {
    const sim = armedSim(0);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    const staging = stagingOf(sim, foeHq);
    const wave = pack(sim, WAVE_MIN_SOLDIERS, { x: staging.x, y: staging.y });
    for (const e of wave) sim.world.add(e, Stance, { mode: MILITARY_MODE.DEFEND, anchorCell: null });

    const commands = run(sim);
    expect(attackTargets(commands)).toEqual(new Array(WAVE_MIN_SOLDIERS).fill(foeHq));
    // Men off a defended post are put back on the attack for the charge.
    expect(stanceModes(commands)).toEqual(new Array(WAVE_MIN_SOLDIERS).fill(MILITARY_MODE.ATTACK));
  });

  it('holds the formed-up group short of the objective until its roll comes up', () => {
    const sim = armedSim(0);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    const staging = stagingOf(sim, foeHq);
    pack(sim, WAVE_MIN_SOLDIERS, { x: staging.x, y: staging.y });

    // Formed up already, so nobody is walked anywhere; they are only put on hold where they stand, so
    // the band waits as a band instead of each man picking his own house to attack.
    const held = run(sim, PATIENT_SEED);
    expect(attackTargets(held)).toEqual([]);
    expect(moveDestinations(held)).toEqual([]);
    expect(stanceModes(held)).toEqual(new Array(WAVE_MIN_SOLDIERS).fill(MILITARY_MODE.DEFEND));
    expect(attackTargets(run(sim, EAGER_SEED))).toHaveLength(WAVE_MIN_SOLDIERS);
  });

  it('walks a lone survivor home instead of sending him at the enemy', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    const rally = rallyOf(sim);
    const [survivor] = spawn(sim, 1, { x: rally.x + 60, y: rally.y });
    if (survivor === undefined) throw new Error('setup: no soldier');

    // One man is no wave, so there is nothing to gather out in the field: he comes back to the barracks,
    // where the army waits on the attack so it meets whatever comes to the door.
    const commands = run(sim);
    expect(attackTargets(commands)).toEqual([]);
    expect(moveDestinations(commands)).toHaveLength(1);
    expect(gatheringAt(sim, commands, rally)).toBe(1);
    expect(commands.some((c) => c.kind === 'moveUnit' && c.entity === survivor)).toBe(true);
    expect(stanceModes(commands)).toEqual([]); // a fighter already defaults to ATTACK - nothing to restate
  });

  it('pulls the last man forward instead of stranding a band short of the objective', () => {
    const sim = armedSim(0);
    const staging = stagingOf(sim, buildingOfType(sim, HQ_TYPE, FOE));
    pack(sim, WAVE_MIN_SOLDIERS - 1, { x: staging.x, y: staging.y }); // one short of a wave
    const rally = rallyOf(sim);
    const [last] = spawn(sim, 1, { x: rally.x, y: rally.y + 1 });
    if (last === undefined) throw new Error('setup: no soldier');

    // The band at the staging point can never charge by itself, so the roll that sends the last man out
    // has to count him with them - measured over the men at home alone, the two halves wait forever.
    const commands = run(sim);
    expect(attackTargets(commands)).toEqual([]);
    expect(moveDestinations(commands)).toHaveLength(1);
    expect(gatheringAt(sim, commands, staging)).toBe(1);
    expect(commands.some((c) => c.kind === 'moveUnit' && c.entity === last)).toBe(true);
  });

  it('leaves a man who stopped short of the staging ring closing on it, never walks him back', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    // Close enough that the staging point falls inside the settlement's own spread - the geometry where
    // an arrival short of the ring reads as "still at home".
    place(sim, HQ_TYPE, { x: BARRACKS.x + 40, y: BARRACKS.y + 20 }, FOE);
    const staging = stagingOf(sim, buildingOfType(sim, HQ_TYPE, FOE));
    pack(sim, WAVE_MIN_SOLDIERS, { x: staging.x, y: staging.y });
    const [late] = spawn(sim, 1, { x: staging.x - RALLY_HOLD_RADIUS_NODES - 3, y: staging.y });
    if (late === undefined) throw new Error('setup: no soldier');

    // He is past the halfway mark, so a lost roll must not march him back to the barracks and out again.
    const commands = run(sim, PATIENT_SEED);
    expect(moveDestinations(commands)).toHaveLength(1);
    expect(gatheringAt(sim, commands, staging)).toBe(1);
    expect(commands.some((c) => c.kind === 'moveUnit' && c.entity === late)).toBe(true);
  });

  it('keeps a muster below the wave minimum at home', () => {
    const sim = armedSim(WAVE_MIN_SOLDIERS - 1);
    const rally = rallyOf(sim);
    const commands = run(sim);
    expect(attackTargets(commands)).toEqual([]);
    // Nobody is sent out; the ones the row spread put outside the rally ring are called back in.
    expect(gatheringAt(sim, commands, rally)).toBe(moveDestinations(commands).length);
  });

  it('varies the wave: the same muster leaves in one game and waits in another', () => {
    const sim = armedSim(WAVE_MIN_SOLDIERS);
    const staging = stagingOf(sim, buildingOfType(sim, HQ_TYPE, FOE));
    const leaving = (commands: readonly Command[]): number => gatheringAt(sim, commands, staging);

    expect(leaving(run(sim, EAGER_SEED))).toBe(WAVE_MIN_SOLDIERS);
    expect(leaving(run(sim, PATIENT_SEED))).toBe(0);

    // A full band leaves whatever the draw.
    const full = armedSim(CERTAIN_WAVE);
    expect(leaving(run(full, PATIENT_SEED))).toBe(CERTAIN_WAVE);
  });

  it('never marches a shooting line while the seat still owns somebody to lead it', () => {
    const sim = armedSim(0);
    const staging = stagingOf(sim, buildingOfType(sim, HQ_TYPE, FOE));
    pack(sim, CERTAIN_WAVE, { x: staging.x, y: staging.y }, BOWMAN);
    // The one spearman is back at the barracks, so the seat HAS a front rank - it just is not here yet.
    const rally = rallyOf(sim);
    spawn(sim, 1, { x: rally.x, y: rally.y + 1 }, SPEARMAN);
    expect(attackTargets(run(sim))).toEqual([]);

    // And once one of them stands with the band, the band goes in - the man left at the barracks is not
    // part of this wave, only of the seat's melee tally.
    pack(sim, 1, { x: staging.x, y: staging.y + 1 }, SPEARMAN);
    expect(attackTargets(run(sim))).toHaveLength(CERTAIN_WAVE + 1);
  });

  it('sends an all-archer army rather than benching it for a swordsman it will never own', () => {
    const sim = armedSim(0);
    const staging = stagingOf(sim, buildingOfType(sim, HQ_TYPE, FOE));
    pack(sim, CERTAIN_WAVE, { x: staging.x, y: staging.y }, BOWMAN);

    // Nobody in the whole army fights in reach, so the melee core is waived: holding out for a front
    // rank the seat cannot raise would bench its army for the rest of the game.
    expect(attackTargets(run(sim))).toHaveLength(CERTAIN_WAVE);
  });

  it('leaves a band that outnumbers the free count standing, instead of marching it home', () => {
    const sim = armedSim(0);
    const staging = stagingOf(sim, buildingOfType(sim, HQ_TYPE, FOE));
    const band = pack(sim, WAVE_MIN_SOLDIERS, { x: staging.x, y: staging.y });
    // A skirmish takes two of them: the census drops the engaged, so the FREE count falls under the
    // minimum. The men still standing there are already forward and must not be walked home for it.
    for (const e of band.slice(0, 2)) sim.world.add(e, Engagement, { repathAt: 0 });

    const commands = run(sim, PATIENT_SEED);
    expect(attackTargets(commands)).toEqual([]);
    expect(moveDestinations(commands)).toEqual([]);
  });

  it('charges an objective inside the settlement straight from the barracks', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    place(sim, HQ_TYPE, { x: rally.x + STAGING_STANDOFF_NODES - 8, y: rally.y }, FOE);
    // An enemy this close is in sight from the barracks, and a man who has already started a fight of
    // his own is nobody's to order - cleared here so the whole muster is still the module's to send.
    for (const e of pack(sim, WAVE_MIN_SOLDIERS, { x: rally.x, y: rally.y })) {
      sim.world.remove(e, Engagement);
    }

    // The fight is at the door - there is no ground left between it and the barracks to form up on.
    const terrain = terrainOf(sim);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    expect(stagingNode(terrain, rally.node, objectiveNode(sim.world, ctxOf(sim), terrain, foeHq))).toBeNull();
    expect(attackTargets(run(sim))).toEqual(new Array(WAVE_MIN_SOLDIERS).fill(foeHq));
  });

  it('leaves a fighter already chasing its focus alone', () => {
    const sim = armedSim(WAVE_MIN_SOLDIERS);
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    for (const e of sim.world.query(Settler, Owner)) {
      if (sim.world.get(e, Owner).player === SEAT) sim.world.add(e, AttackOrder, { target: foeHq });
    }
    expect(run(sim)).toEqual([]);
  });

  it('keeps the next rank walking out after the first wave charges, instead of turning it around', () => {
    const sim = armedSim(0);
    const staging = stagingOf(sim, buildingOfType(sim, HQ_TYPE, FOE));
    // The wave that just left carries its attack orders, so the census no longer counts it. The trailers
    // behind it must not read that as a collapse and U-turn 40 nodes from the enemy.
    const gone = pack(sim, WAVE_MIN_SOLDIERS, { x: staging.x, y: staging.y });
    const foeHq = buildingOfType(sim, HQ_TYPE, FOE);
    for (const e of gone) sim.world.add(e, AttackOrder, { target: foeHq });
    // Three more already most of the way there - committed forward, but too few on their own to muster.
    const trailers = spawn(sim, 3, { x: staging.x - 3 * RALLY_HOLD_RADIUS_NODES, y: staging.y });
    const rally = rallyOf(sim);

    const commands = run(sim, PATIENT_SEED);
    expect(gatheringAt(sim, commands, rally)).toBe(0);
    expect(gatheringAt(sim, commands, staging)).toBe(trailers.length);
  });

  it('leaves a soldier the recall would strand mid-march in the stance he set out in', () => {
    const sim = armedSim(0);
    const staging = stagingOf(sim, buildingOfType(sim, HQ_TYPE, FOE));
    const [walker] = spawn(sim, 1, { x: staging.x - 20, y: staging.y });
    if (walker === undefined) throw new Error('setup: no soldier');
    sim.world.add(walker, Stance, { mode: MILITARY_MODE.DEFEND, anchorCell: null });
    sim.world.add(walker, MoveGoal, { cell: terrainOf(sim).nodeAtClamped(staging.x, staging.y) });

    // He is travelling, so the drive will not re-route him; flipping his stance alone would anchor his
    // defend post on the road, or drop him to ATTACK where he picks his own fight and leaves the census.
    expect(run(sim, PATIENT_SEED)).toEqual([]);
  });

  it('releases the field hold when the seat loses the barracks it was mustering for', () => {
    const sim = armedSim(WAVE_MIN_SOLDIERS);
    const band = [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Owner).player === SEAT);
    for (const e of band) sim.world.add(e, Stance, { mode: MILITARY_MODE.DEFEND, anchorCell: null });
    sim.world.destroy(buildingOfType(sim, BARRACKS_TYPE, SEAT));

    // With no rally left there is nothing to gather for, and nothing else ever re-stances an AI fighter:
    // left held, the band would guard a post in an empty field for the rest of the game.
    expect(stanceModes(run(sim))).toEqual(new Array(band.length).fill(MILITARY_MODE.ATTACK));
  });

  it('calls everyone home when there is nothing left to march on', () => {
    const sim = aiSim();
    place(sim, BARRACKS_TYPE, BARRACKS);
    const rally = rallyOf(sim);
    const [survivor] = spawn(sim, 1, { x: rally.x + 60, y: rally.y });
    if (survivor === undefined) throw new Error('setup: no soldier');

    const commands = run(sim);
    expect(moveDestinations(commands)).toHaveLength(1);
    expect(gatheringAt(sim, commands, rally)).toBe(1);
    expect(commands.some((c) => c.kind === 'moveUnit' && c.entity === survivor)).toBe(true);
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
  /** Ticks to watch a wave: the seat decides on tick 2, walks out to the staging point, forms up there
   *  and charges from it - two decisions with a march between them. */
  const MARCH_TICKS = 1200;
  /** Enough men that both launch rolls come up well inside {@link MARCH_TICKS}, cheap enough to run the
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

    // The whole band goes in together - the point of the two-stage muster.
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
