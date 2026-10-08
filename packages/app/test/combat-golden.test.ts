import {
  CORE_INVARIANTS,
  checkInvariants,
  components,
  type Entity,
  fx,
  type MilitaryMode,
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
 * Each lane pairs a blue striker with a red civilian ordered to DEFEND. Civilians hold their ground,
 * turn and return fist blows. The lanes cover short sword against wool and chain, long sword against
 * leather and plate, iron spear against plate, and both bows at range. Melee attackers approach from
 * different sides, so facing, interruptions and rising fight experience affect subsequent blows.
 * Far off, a swordsman wearing strength and critical-hit amulets fights a rival with the defence amulet,
 * while a wounded civilian regenerates alone. The trace also includes regeneration between blows.
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

function setStance(sim: Simulation, e: Entity, mode: MilitaryMode): void {
  const stance = sim.world.mut(e, Stance);
  stance.mode = mode;
  stance.anchorCell = null;
}

/** A fighter that stands where it is once its order is done, instead of joining another lane. */
function holdGround(sim: Simulation, e: Entity): void {
  setStance(sim, e, systems.MILITARY_MODE.IGNORE);
}

/** A civilian ordered to defend his ground fights back with his tribe’s bare hands. */
function standAndDefend(sim: Simulation, e: Entity): void {
  setStance(sim, e, systems.MILITARY_MODE.DEFEND);
}

function build(sim: Simulation): void {
  for (const [i, lane] of LANES.entries()) {
    const y = FIRST_LANE_Y + i * LANE_PITCH;
    const victim = spawnSettlerDirect(sim, JOB_CIVILIST, TARGET_X, y, LANE_RED);
    dress(sim, victim, lane.armor, []);
    standAndDefend(sim, victim);
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
  // Civilians now return 400-point fist blows, changing facing, hit interruptions and subsequent rolls.
  // The champion's first 2400 is a critical double of 1600 x3/2 halved by the defence amulet;
  // the rival's first 1600 is the plain short-sword blow on bare cloth.
  const GOLDEN_TRACE: readonly string[] = [
    '18:hit:1>2:4600',
    '19:hit:5>6:4600',
    '19:hit:9>10:4600',
    '20:miss:12',
    '23:hit:3>4:4600',
    '25:hit:7>8:4600',
    '26:hit:2>1:4205',
    '26:hit:6>5:4605',
    '27:hit:4>3:2155',
    '29:hit:15>16:2600',
    '31:miss:12',
    '33:hit:8>7:4055',
    '34:hit:10>9:2915',
    '34:hit:16>15:3400',
    '34:hit:1>2:4214',
    '35:hit:5>6:4214',
    '35:hit:9>10:4214',
    '35:miss:14',
    '38:hit:2>1:3418',
    '38:hit:6>5:4220',
    '39:hit:3>4:4214',
    '40:miss:12',
    '41:hit:15>16:1406',
    '41:hit:7>8:4214',
    '46:hit:16>15:1804',
    '50:hit:2>1:2627',
    '50:hit:6>5:3833',
    '50:hit:1>2:3826',
    '51:hit:5>6:3826',
    '51:hit:9>10:3826',
    '51:shot:12>11:4605',
    '53:hit:15>16:206',
    '55:hit:3>4:3826',
    '56:hit:4>3:gone',
    '56:died:3',
    '57:hit:7>8:3826',
    '58:hit:16>15:200',
    '60:miss:14',
    '61:hit:10>9:847',
    '62:hit:8>7:3135',
    '62:hit:2>1:1832',
    '62:hit:6>5:3444',
    '62:shot:12>11:4221',
    '65:hit:15>16:gone',
    '65:died:16',
    '66:hit:1>2:3436',
    '67:hit:5>6:3436',
    '67:hit:9>10:3436',
    '72:miss:12',
    '73:hit:7>8:3436',
    '74:hit:2>1:1033',
    '74:hit:6>5:3053',
    '82:hit:1>2:3044',
    '83:hit:5>6:3044',
    '83:hit:9>10:3044',
    '84:shot:14>13:4645',
    '84:shot:12>11:3848',
    '86:hit:2>1:230',
    '86:hit:6>5:2660',
    '88:hit:10>9:gone',
    '88:died:9',
    '89:hit:7>8:3044',
    '91:hit:8>7:2210',
    '98:hit:2>1:gone',
    '98:hit:6>5:2265',
    '98:hit:1>2:2650',
    '98:died:1',
    '99:hit:5>6:2650',
    '105:hit:7>8:2650',
    '109:miss:14',
    '110:hit:6>5:1868',
    '115:hit:5>6:2254',
    '120:hit:8>7:1280',
    '121:hit:7>8:2254',
    '122:hit:6>5:1469',
    '129:shot:12>11:3498',
    '131:hit:5>6:1856',
    '134:hit:6>5:1068',
    '137:hit:7>8:1856',
    '146:hit:6>5:664',
    '147:hit:5>6:1456',
    '149:hit:8>7:345',
    '153:hit:7>8:1456',
    '158:hit:6>5:258',
    '163:hit:5>6:1054',
    '169:hit:7>8:1054',
    '170:hit:6>5:gone',
    '170:died:5',
    '178:hit:8>7:gone',
    '178:died:7',
    '241:shot:14>13:4447',
    '323:miss:12',
    '344:shot:14>13:4195',
    '370:shot:12>11:3344',
  ];

  it('holds every core invariant on every tick', () => {
    expect(runCombat(TICKS).invariantViolations).toEqual([]);
  });

  it('matches the golden final state hash', () => {
    // Moves on any intentional combat change, including a new shape of the stored swing that leaves the
    // hit trace alone; name the change in the commit that moves it.
    expect(runCombat(TICKS).hash).toBe('1acc3ce1');
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
