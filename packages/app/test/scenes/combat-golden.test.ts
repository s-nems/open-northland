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
import { grassTerrain } from '../../src/catalog/buildings.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_CIVILIST,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
} from '../../src/catalog/jobs.js';
import { spawnSettlerDirect } from '../../src/game/sandbox/index.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { goodBySlug } from '../../src/scenes/sandbox-queries.js';
import type { SceneWorld } from '../../src/scenes/types.js';

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
  let run: CombatRun | undefined;
  const combat = (): CombatRun => (run ??= runCombat(TICKS));

  // Entities: each lane's victim then its striker, lane by lane (1/2 short sword on wool, 3/4 long sword
  // on leather, 5/6 short sword on chain, 7/8 long sword on plate, 9/10 iron spear on plate, 11/12 short
  // bow on leather, 13/14 long bow on plate), then 15 the amuleted champion, 16 its rival, 17 the
  // convalescent. Hitpoints are read after the tick, so a victim between blows shows its regeneration.
  // Civilians now return 400-point fist blows, changing facing, hit interruptions and subsequent rolls.
  // The champion's first 1200 is 1600 x3/2 halved by the defence amulet, its second 2400 a critical
  // double of that; the rival's first 1600 is the plain short-sword blow on bare cloth.
  const GOLDEN_TRACE: readonly string[] = [
    '20:miss:12',
    '24:hit:3>4:4600',
    '24:hit:5>6:4600',
    '25:hit:1>2:4600',
    '27:hit:10>9:2915',
    '27:hit:2>1:4205',
    '27:hit:6>5:4605',
    '28:hit:4>3:2155',
    '28:hit:9>10:4600',
    '30:hit:7>8:4600',
    '32:miss:12',
    '34:hit:8>7:4055',
    '35:hit:16>15:3400',
    '36:hit:15>16:3800',
    '36:miss:14',
    '39:hit:2>1:3418',
    '39:hit:6>5:4220',
    '40:hit:3>4:4214',
    '40:hit:5>6:4214',
    '41:hit:1>2:4214',
    '42:shot:12>11:4605',
    '44:hit:9>10:4214',
    '46:hit:7>8:4214',
    '47:hit:16>15:1804',
    '48:hit:15>16:1400',
    '51:hit:2>1:2627',
    '51:hit:6>5:3833',
    '52:miss:12',
    '54:hit:10>9:847',
    '56:hit:3>4:3826',
    '56:hit:5>6:3826',
    '57:hit:4>3:gone',
    '57:hit:1>2:3826',
    '57:died:3',
    '59:hit:16>15:200',
    '60:hit:15>16:200',
    '60:hit:9>10:3826',
    '61:miss:14',
    '62:hit:7>8:3826',
    '63:hit:8>7:3135',
    '63:hit:2>1:1832',
    '63:hit:6>5:3444',
    '63:shot:12>11:4231',
    '71:hit:16>15:gone',
    '71:died:15',
    '72:hit:5>6:3436',
    '73:hit:1>2:3436',
    '74:shot:12>11:3847',
    '75:hit:2>1:1033',
    '75:hit:6>5:3053',
    '76:hit:9>10:3436',
    '78:hit:7>8:3436',
    '81:hit:10>9:gone',
    '81:died:9',
    '85:miss:14',
    '85:shot:12>11:3463',
    '87:hit:2>1:230',
    '87:hit:6>5:2660',
    '88:hit:5>6:3044',
    '89:hit:1>2:3044',
    '92:hit:8>7:2210',
    '94:hit:7>8:3044',
    '99:hit:2>1:gone',
    '99:hit:6>5:2265',
    '99:died:1',
    '104:hit:5>6:2650',
    '110:hit:7>8:2650',
    '111:hit:6>5:1868',
    '111:shot:14>13:4645',
    '115:shot:12>11:3098',
    '120:hit:5>6:2254',
    '121:hit:8>7:1280',
    '123:hit:6>5:1469',
    '126:hit:7>8:2254',
    '135:hit:6>5:1068',
    '136:hit:5>6:1856',
    '137:shot:14>13:4316',
    '142:hit:7>8:1856',
    '143:hit:13>14:4600',
    '146:shot:12>11:2734',
    '147:hit:6>5:664',
    '150:hit:8>7:345',
    '152:hit:5>6:1456',
    '158:hit:7>8:1456',
    '159:hit:6>5:258',
    '168:hit:5>6:1054',
    '171:hit:6>5:gone',
    '171:died:5',
    '174:hit:7>8:1054',
    '177:shot:12>11:2370',
    '179:hit:8>7:gone',
    '179:died:7',
    '293:shot:14>13:4117',
    '299:hit:13>14:4354',
    '306:shot:12>11:2104',
    '392:shot:12>11:1795',
  ];

  it('holds every core invariant on every tick', () => {
    expect(combat().invariantViolations).toEqual([]);
  });

  it('matches the golden final state hash', () => {
    // Moves on any intentional combat change, including a new shape of the stored swing that leaves the
    // hit trace alone; name the change in the commit that moves it.
    expect(combat().hash).toBe('8af4d97f');
  });

  it('matches the golden hit trace', () => {
    expect(combat().trace).toEqual(GOLDEN_TRACE);
  });
});
