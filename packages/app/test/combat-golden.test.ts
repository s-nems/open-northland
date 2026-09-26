import {
  CORE_INVARIANTS,
  checkInvariants,
  components,
  type Entity,
  fx,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_CIVILIST,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
} from '../src/catalog/jobs.js';
import { spawnSettlerDirect } from '../src/game/sandbox/index.js';
import { createSceneSim } from '../src/scenes/runtime.js';
import { goodBySlug } from '../src/scenes/sandbox-queries.js';
import type { SceneWorld } from '../src/scenes/types.js';

/**
 * The combat golden: one seeded fight over the sandbox catalog's extracted `weapons.ini` and
 * `armortypes.ini` rows, pinning the final state hash and the ordered hit trace. The hash says that combat
 * changed; the trace says which blow changed and when, with the hitpoints it left.
 *
 * Each lane is one blue striker ordered onto one red civilian set to DEFEND, so it stands under the blows
 * instead of running from them, and being unarmed never strikes back or turns; every blow in a lane is
 * then one weapon on one armor column from one side:
 *  - short sword vs wool and vs chain, from the east, the victim's back side (x1.25);
 *  - long sword vs leather from the west, its front, and vs plate from the north-east, behind it (x1.5);
 *  - iron spear vs plate from the east, the column where spear and long sword swap;
 *  - short bow vs leather and long bow vs plate from fresh archers, whose shots scatter.
 * Every melee lane ends in its victim's death, and the rising fight experience lifts later blows. Far off,
 * a swordsman with the strength and critical-hit amulets fights a rival wearing the defence amulet to the
 * death, both striking and turning, and a wounded civilian alone on the field regenerates, as every victim
 * does between blows.
 */

const BLUE = 0;
const LANE_RED = 1;
const DUEL_RED = 2;

const MAP_W = 64;
const MAP_H = 60;

/** The lanes' victims stand in one column. Eight cells (sixteen nodes) between lanes puts each victim past
 *  an idle civilian's twelve-node walk to a chat partner, so none leaves its lane. */
const TARGET_X = 10;
const LANE_PITCH = 8;
const FIRST_LANE_Y = 3;
/** Where a striker starts, in cells from its victim: the side it strikes from. */
const FROM_EAST = { dx: 2, dy: 0 } as const;
const FROM_WEST = { dx: -2, dy: 0 } as const;
const FROM_NORTH_EAST = { dx: 1, dy: -2 } as const;
/** Inside each bow's band, past its dead zone. */
const SHORT_BOW_STANDOFF = { dx: -6, dy: 0 } as const;
const LONG_BOW_STANDOFF = { dx: -8, dy: 0 } as const;

interface Lane {
  readonly job: number;
  readonly armor: string | null;
  readonly from: { readonly dx: number; readonly dy: number };
}
const LANES: readonly Lane[] = [
  { job: JOB_SOLDIER_SWORD, armor: 'armor_wool', from: FROM_EAST },
  { job: JOB_SOLDIER_BROADSWORD, armor: 'armor_leather', from: FROM_WEST },
  { job: JOB_SOLDIER_SWORD, armor: 'armor_chain', from: FROM_EAST },
  { job: JOB_SOLDIER_BROADSWORD, armor: 'armor_plate', from: FROM_NORTH_EAST },
  { job: JOB_SOLDIER_SPEAR, armor: 'armor_plate', from: FROM_EAST },
  { job: JOB_ARCHER, armor: 'armor_leather', from: SHORT_BOW_STANDOFF },
  { job: JOB_ARCHER_LONG, armor: 'armor_plate', from: LONG_BOW_STANDOFF },
];

/** Forty cells east of the lanes, past the alarm's reach, so neither fight answers the other. */
const DUEL_Y = 10;
const CHAMPION_X = 52;
const RIVAL_X = 55;
const CHAMPION_AMULETS = ['amulet_strength', 'amulet_crithit'];
const RIVAL_AMULETS = ['amulet_defense'];

const CONVALESCENT = { x: 58, y: 40 } as const;
const CONVALESCENT_WOUND_SHARE = 2;

const { Equipment, Health, MISC_EQUIP_SLOTS, Stance } = components;

function dress(sim: Simulation, e: Entity, armor: string | null, amulets: readonly string[]): void {
  const whole = fx.fromInt(0);
  const misc = Array.from({ length: MISC_EQUIP_SLOTS }, (_, slot) => {
    const slug = amulets[slot];
    return slug === undefined ? null : { goodType: goodBySlug(sim, slug), degreeOfUse: whole };
  });
  sim.world.add(e, Equipment, {
    boots: null,
    tool: null,
    weapon: null,
    armor: armor === null ? null : { goodType: goodBySlug(sim, armor), degreeOfUse: whole },
    misc,
  });
}

type MilitaryMode = (typeof systems.MILITARY_MODE)[keyof typeof systems.MILITARY_MODE];

function setStance(sim: Simulation, e: Entity, mode: MilitaryMode): void {
  const stance = sim.world.mut(e, Stance);
  stance.mode = mode;
  stance.anchorCell = null;
}

/** A fighter that stands where it is once its order is done, instead of joining another lane. */
function holdGround(sim: Simulation, e: Entity): void {
  setStance(sim, e, systems.MILITARY_MODE.IGNORE);
}

/** An unarmed civilian that stands under blows: set to DEFEND by hand, it neither runs from a blow, as any
 *  other non-fighting stance would have it do, nor has anything to hit back with. */
function standAndTakeIt(sim: Simulation, e: Entity): void {
  setStance(sim, e, systems.MILITARY_MODE.DEFEND);
}

function build(sim: Simulation): void {
  for (const [i, lane] of LANES.entries()) {
    const y = FIRST_LANE_Y + i * LANE_PITCH;
    const victim = spawnSettlerDirect(sim, JOB_CIVILIST, TARGET_X, y, LANE_RED);
    dress(sim, victim, lane.armor, []);
    standAndTakeIt(sim, victim);
    const striker = spawnSettlerDirect(sim, lane.job, TARGET_X + lane.from.dx, y + lane.from.dy, BLUE);
    holdGround(sim, striker);
    sim.enqueueSetup({ kind: 'attackUnit', entity: striker, target: victim });
  }
  const champion = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, CHAMPION_X, DUEL_Y, BLUE);
  dress(sim, champion, null, CHAMPION_AMULETS);
  const rival = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, RIVAL_X, DUEL_Y, DUEL_RED);
  dress(sim, rival, null, RIVAL_AMULETS);

  const convalescent = spawnSettlerDirect(sim, JOB_CIVILIST, CONVALESCENT.x, CONVALESCENT.y, BLUE);
  holdGround(sim, convalescent);
  const health = sim.world.mut(convalescent, Health);
  health.hitpoints = Math.trunc(health.max / CONVALESCENT_WOUND_SHARE);
}

const COMBAT_GOLDEN: SceneWorld = { seed: 17, terrain: grassTerrain(MAP_W, MAP_H), build };

interface CombatRun {
  readonly hash: string;
  /** `tick:kind:striker>target:hitpoints left`, a miss as `tick:miss:shooter`, a death as `tick:died:entity`. */
  readonly trace: readonly string[];
  readonly invariantViolations: readonly string[];
}

function hitpointsOf(sim: Simulation, e: Entity): string {
  const health = sim.world.tryGet(e, Health);
  return health === undefined ? 'gone' : String(health.hitpoints);
}

function runCombat(ticks: number): CombatRun {
  const sim = createSceneSim(COMBAT_GOLDEN);
  const trace: string[] = [];
  const invariantViolations: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    for (const ev of sim.events.current()) {
      if (ev.kind === 'combatHit') {
        trace.push(`${sim.tick}:hit:${ev.attacker}>${ev.target}:${hitpointsOf(sim, ev.target)}`);
      } else if (ev.kind === 'projectileHit') {
        trace.push(`${sim.tick}:shot:${ev.shooter}>${ev.target}:${hitpointsOf(sim, ev.target)}`);
      } else if (ev.kind === 'projectileMissed') {
        trace.push(`${sim.tick}:miss:${ev.shooter}`);
      } else if (ev.kind === 'settlerDied') {
        trace.push(`${sim.tick}:died:${ev.entity}`);
      }
    }
    if (invariantViolations.length === 0) {
      const v = checkInvariants(sim.world, sim.content, CORE_INVARIANTS);
      if (v.length > 0) invariantViolations.push(`tick ${sim.tick}: ${v.join('; ')}`);
    }
  }
  return { hash: sim.hashState(), trace, invariantViolations };
}

describe('golden: a seeded fight over the extracted weapon and armor rows', () => {
  const TICKS = 400;

  // Entities: each lane's victim then its striker, lane by lane (1/2 short sword on wool, 3/4 long sword
  // on leather, 5/6 short sword on chain, 7/8 long sword on plate, 9/10 iron spear on plate, 11/12 short
  // bow on leather, 13/14 long bow on plate), then 15 the amuleted champion, 16 its rival, 17 the
  // convalescent. Hitpoints are read after the tick, so a victim between blows shows its regeneration.
  // Reading the first blows: 995 is 800 x1.25 less 5 blocked, 1420 is 950 x1.5 less 5, 1200 is 1600 x3/2
  // halved by the defence amulet, and the rival's 1600 is the plain short-sword blow on bare cloth.
  const GOLDEN_TRACE: readonly string[] = [
    '23:miss:12',
    '29:hit:15>16:3800',
    '33:hit:8>7:3580',
    '34:hit:10>9:2393',
    '34:hit:2>1:4005',
    '34:hit:6>5:4505',
    '34:hit:16>15:3400',
    '34:shot:12>11:4605',
    '35:hit:4>3:2155',
    '40:miss:14',
    '41:hit:15>16:2606',
    '46:hit:2>1:3017',
    '46:hit:6>5:4020',
    '46:hit:16>15:1804',
    '46:miss:12',
    '53:hit:15>16:1406',
    '58:hit:2>1:2024',
    '58:hit:6>5:3532',
    '58:hit:16>15:200',
    '58:shot:12>11:4234',
    '61:hit:10>9:gone',
    '61:died:9',
    '62:hit:8>7:2183',
    '64:hit:4>3:gone',
    '64:died:3',
    '65:hit:15>16:200',
    '69:miss:14',
    '70:hit:2>1:1026',
    '70:hit:6>5:3042',
    '70:hit:16>15:gone',
    '70:died:15',
    '72:miss:12',
    '82:hit:2>1:23',
    '82:hit:6>5:2549',
    '83:miss:12',
    '91:hit:8>7:779',
    '94:hit:2>1:gone',
    '94:hit:6>5:2054',
    '94:shot:14>13:4645',
    '94:miss:12',
    '94:died:1',
    '106:hit:6>5:1556',
    '106:shot:12>11:3887',
    '118:hit:6>5:1056',
    '119:miss:12',
    '120:hit:8>7:gone',
    '120:died:7',
    '123:miss:14',
    '130:hit:6>5:553',
    '131:miss:12',
    '142:hit:6>5:48',
    '142:shot:12>11:3528',
    '149:miss:14',
    '154:hit:6>5:gone',
    '154:miss:12',
    '154:died:5',
    '166:miss:12',
    '178:miss:14',
    '178:shot:12>11:3169',
    '190:shot:12>11:2786',
    '202:shot:12>11:2403',
    '209:miss:14',
    '214:shot:12>11:2020',
    '226:shot:12>11:1637',
    '235:miss:14',
    '240:miss:12',
    '249:miss:12',
    '262:miss:14',
    '262:shot:12>11:1278',
    '274:shot:12>11:895',
    '286:miss:12',
    '291:miss:14',
    '299:miss:12',
    '310:shot:12>11:536',
    '321:miss:14',
    '322:shot:12>11:153',
    '334:shot:12>11:gone',
    '334:died:11',
    '348:miss:14',
    '376:miss:14',
  ];

  it('holds every core invariant on every tick', () => {
    expect(runCombat(TICKS).invariantViolations).toEqual([]);
  });

  it('matches the golden final state hash', () => {
    // Moves on any intentional combat change; name the change in the commit that moves it.
    expect(runCombat(TICKS).hash).toBe('4b42a8f2');
  });

  it('matches the golden hit trace', () => {
    expect(runCombat(TICKS).trace).toEqual(GOLDEN_TRACE);
  });

  it('is identical across two same-seed runs', () => {
    const a = runCombat(TICKS);
    const b = runCombat(TICKS);
    expect(a.hash).toBe(b.hash);
    expect(a.trace).toEqual(b.trace);
  });
});
