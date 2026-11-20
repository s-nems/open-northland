import { MapModules } from '../../src/index.js';

const MINUTE = 60;
const STRONGHOLD_SEAT = 2;
const TRIBE = 'frank';
const GUARD_JOB = 'soldier_sword_long';
const ARCHER_JOB = 'soldier_bow_long';
const ATTACK_TITLE = 9001;
const STRONGER_TITLE = 9002;
const STRONGER_DETAIL = 9003;
const HERO_NAME = 9004;

/** A compact siege map: one stronghold seat raiding two player seats from two camps, with gear steps,
 *  one hero and the flags the other modules take. Points lie on a 300 x 300 cell map. */
export const MODULES: MapModules = MapModules.parse({
  siege: {
    version: 1,
    stronghold: { seat: STRONGHOLD_SEAT, building: 'barracks', x: 150, y: 150, range: 10 },
    tribe: TRIBE,
    jobMix: [
      { job: GUARD_JOB, weight: 2 },
      { job: ARCHER_JOB, weight: 1 },
    ],
    attacks: {
      launches: [
        { atSeconds: 30 * MINUTE, landMen: 10, ships: 0 },
        { atSeconds: 60 * MINUTE, landMen: 20, ships: 1 },
      ],
      repeat: { everySeconds: 20 * MINUTE, waves: [{ landMen: 30, ships: 1 }] },
      endDeadPct: 80,
      endAfterSeconds: 10 * MINUTE,
      targets: [
        { seat: 0, raider: 3, x: 50, y: 50, landings: [{ spawnX: 5, spawnY: 50, x: 20, y: 50 }] },
        { seat: 1, raider: 4, x: 250, y: 250, landings: [{ spawnX: 295, spawnY: 250, x: 280, y: 250 }] },
      ],
      notice: { title: ATTACK_TITLE },
    },
    guard: {
      base: 100,
      perSeatStep: 5,
      stepSeconds: 30 * MINUTE,
      perSeatMax: 30,
      refill: { everySeconds: 40, baseMen: 2, stepMen: 1, stepSeconds: 15 * MINUTE, maxMen: 16 },
    },
    towerGarrison: { slots: [{ job: ARCHER_JOB, count: 4 }] },
    landings: { vehicle: 'ship_small', menPerShip: 20, notice: { title: ATTACK_TITLE }, revealNodes: 12 },
    catapults: { respawnSeconds: 10 * MINUTE },
    builders: { count: 8 },
    porters: { count: 3, vehicle: 'handcart', x: 150, y: 150, radius: 40 },
  },
  gearSchedule: {
    version: 1,
    seats: [STRONGHOLD_SEAT, 3, 4],
    steps: [
      {
        atSeconds: 60 * MINUTE,
        notice: { title: STRONGER_TITLE, detail: STRONGER_DETAIL },
        grants: [{ goods: ['armor_wool', 'armor_leather'] }],
        weaponUpgrades: [{ from: 'bow_short', to: 'bow_long' }],
      },
      {
        atSeconds: 90 * MINUTE,
        notice: { title: STRONGER_TITLE },
        grants: [{ goods: ['amulet_strength'], extraChancePct: 30 }],
      },
    ],
  },
  heroes: {
    version: 1,
    placed: [
      {
        seat: STRONGHOLD_SEAT,
        job: GUARD_JOB,
        tribe: TRIBE,
        x: 150,
        y: 150,
        hitpoints: 30000,
        equipment: ['sword_long', 'armor_plate'],
        nameStringId: HERO_NAME,
        hero: true,
        scalePct: 120,
      },
    ],
  },
  deathDrops: { version: 1, withheldSeats: [STRONGHOLD_SEAT, 3, 4] },
  demobilizedStart: { version: 1 },
});
