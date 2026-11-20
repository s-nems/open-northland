import type { ContentSet, MapAiSeat, MapModulesInput } from '@open-northland/data';
import { MapModules, parseContentSet } from '@open-northland/data';
import { Owner, Person, Position, Settler } from '../../../src/components/index.js';
import { TICKS_PER_SECOND } from '../../../src/core/loop.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { hexDistanceBetween, nodeOfPosition } from '../../../src/nav/halfcell.js';
import { CONDITION_ALWAYS } from '../../../src/systems/map-ai/index.js';
import { isFighterJob } from '../../../src/systems/readviews/index.js';
import { aiContent } from '../ai-content.js';
import { grassNodeMap } from '../terrain.js';

/**
 * A synthetic siege map: a fortress seat whose keep spawns each attack for the raider of every
 * occupied target seat, the raider's own Attack task marching it, and a guard that refills toward its
 * growing cap while the garrison holds its post.
 */

export const VIKING = 1;
export const VIKING_SLUG = 'viking';
export const HQ_TYPE = 1;
const HQ_SLUG = 'headquarters';
export const SPEARMAN = 32;
export const SPEARMAN_SLUG = 'soldier_spear_wooden';
export const BOWMAN = 40;
export const BOWMAN_SLUG = 'soldier_bow_short';
export const MAP = 160;

export const FORTRESS = 6;
export const PLAYER = 0;
export const EMPTY_SEAT = 1;
export const RAIDER = 7;
export const IDLE_RAIDER = 8;
export const KEEP = { x: 40, y: 80 };
export const TARGET = { x: 130, y: 80 };
export const POST = { x: 40, y: 96, range: 10 };

export const FIRST_LAUNCH_SECONDS = 10;
const FIRST_WAVE_MEN = 3;
/** Two of the first wave's three men dead end it, one does not. */
const END_DEAD_PCT = 60;
export const END_AFTER_SECONDS = 120;
export const GUARD_BASE = 3;
export const REFILL_EVERY_SECONDS = 10;

export type SiegeInput = NonNullable<MapModulesInput['siege']>;

export const SIEGE: SiegeInput = {
  version: 1,
  stronghold: { seat: FORTRESS, building: HQ_SLUG, ...KEEP, range: 4 },
  tribe: VIKING_SLUG,
  jobMix: [
    { job: SPEARMAN_SLUG, weight: 2 },
    { job: BOWMAN_SLUG, weight: 1 },
  ],
  attacks: {
    launches: [
      { atSeconds: FIRST_LAUNCH_SECONDS, landMen: FIRST_WAVE_MEN, ships: 0 },
      { atSeconds: 400, landMen: 5, ships: 0 },
    ],
    repeat: { everySeconds: 400, waves: [{ landMen: 1, ships: 0 }] },
    endDeadPct: END_DEAD_PCT,
    endAfterSeconds: END_AFTER_SECONDS,
    targets: [
      { seat: PLAYER, raider: RAIDER, ...TARGET },
      { seat: EMPTY_SEAT, raider: IDLE_RAIDER, x: 10, y: 10 },
    ],
  },
  guard: {
    base: GUARD_BASE,
    perSeatStep: 1,
    stepSeconds: 30,
    perSeatMax: 2,
    refill: { everySeconds: REFILL_EVERY_SECONDS, baseMen: 2, stepMen: 0, stepSeconds: 60, maxMen: 2 },
  },
};

export const MODULES: MapModulesInput = { siege: SIEGE };

const seat = (player: number, tasks: MapAiSeat['tasks']): MapAiSeat => ({
  player,
  allDisabled: false,
  computerDisabled: true,
  disabledComputerModules: [],
  conditions: [],
  tasks,
});

export const SCRIPT: MapAiSeat[] = [
  seat(FORTRESS, [{ kind: 'defend', priority: 10, condition: CONDITION_ALWAYS, ...POST, min: 0, max: 0 }]),
  seat(RAIDER, [
    {
      kind: 'attack',
      priority: 100,
      condition: CONDITION_ALWAYS,
      ...TARGET,
      range: 20,
      min: 0,
      max: 0,
      rallyX: 80,
      rallyY: 80,
      stance: 1,
    },
  ]),
];

/** The keep world after its setup tick. `inMatch` makes the player and fortress match participants;
 *  `scriptedFortress` leaves the fortress seat to its map AI alone, as a map's scripted seat is. */
export function keepWorld(
  modules: MapModulesInput = MODULES,
  content: ContentSet = aiContent(),
  options: { readonly inMatch?: boolean; readonly scriptedFortress?: boolean } = {},
): { sim: Simulation; garrison: Entity[] } {
  const sim = new Simulation({
    seed: 3,
    content,
    map: grassNodeMap(MAP, MAP),
    mapAiScript: SCRIPT,
    mapModules: MapModules.parse(modules),
  });
  if (options.inMatch === true)
    sim.enqueueSetup({ kind: 'setMatchParticipants', players: [PLAYER, FORTRESS] });
  const fortressSide = [FORTRESS, RAIDER, IDLE_RAIDER];
  for (const player of fortressSide) {
    const enabled = !(options.scriptedFortress === true && player === FORTRESS);
    sim.enqueueSetup({ kind: 'setAiControl', player, enabled, modules: { military: false } });
    for (const ally of fortressSide) {
      if (ally !== player)
        sim.enqueueSetup({ kind: 'setDiplomacy', from: player, to: ally, state: 'friend' });
    }
  }
  const house = (owner: number, at: { x: number; y: number }) =>
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      ...at,
      tribe: VIKING,
      owner,
      force: true,
      underConstruction: false,
    });
  house(FORTRESS, KEEP);
  house(PLAYER, TARGET);
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: 0,
    x: TARGET.x,
    y: TARGET.y + 6,
    tribe: VIKING,
    owner: PLAYER,
  });
  for (let i = 0; i < GUARD_BASE; i++) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: SPEARMAN,
      x: POST.x + 2 * i,
      y: POST.y,
      tribe: VIKING,
      owner: FORTRESS,
    });
  }
  sim.step();
  return { sim, garrison: ownedFighters(sim, FORTRESS) };
}

export function ownedFighters(sim: Simulation, player: number): Entity[] {
  return [...sim.world.query(Settler, Owner)].filter(
    (e) => sim.world.get(e, Owner).player === player && sim.world.get(e, Settler).jobType !== 0,
  );
}

/** The soldiers a seat fields, as its statistics count them. */
export function soldiersOf(sim: Simulation, seat: number): number {
  return [...sim.world.query(Person, Settler, Owner)].filter((e) => {
    const jobType = sim.world.get(e, Settler).jobType;
    return sim.world.get(e, Owner).player === seat && jobType !== null && isFighterJob(sim.content, jobType);
  }).length;
}

export function distance(sim: Simulation, e: Entity, to: { x: number; y: number }): number {
  const at = sim.world.get(e, Position);
  const node = nodeOfPosition(at.x, at.y);
  return hexDistanceBetween(node.hx, node.hy, to.x, to.y);
}

export function runToSecond(sim: Simulation, seconds: number): void {
  sim.run(seconds * TICKS_PER_SECOND - sim.tick);
}

export const WOOL = 60;
export const LEATHER = 61;
export const SHOES = 62;
export const DEFENSE_AMULET = 63;
export const CATAPULT = 5;
export const LIGHT_ARMOR_SECONDS = 20;
export const AMULET_SECONDS = 30;
export const CATAPULT_RESPAWN_SECONDS = 10;

/** {@link aiContent} with two armors, shoes, the defense amulet and a catapult the soldiers crew. */
export function gearContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: WOOL, id: 'armor_wool', weight: 0, equip: { category: 'armor' } },
      { typeId: LEATHER, id: 'armor_leather', weight: 0, equip: { category: 'armor' } },
      { typeId: SHOES, id: 'shoes', weight: 0, equip: { category: 'boots', wears: true, uses: 10000 } },
      {
        typeId: DEFENSE_AMULET,
        id: 'amulet_defense',
        weight: 0,
        equip: { category: 'misc', damageTakenPct: 50 },
      },
    ],
    vehicles: [
      {
        typeId: CATAPULT,
        id: 'catapult',
        jobId: 54,
        stockSlots: 0,
        logicSize: 1,
        passengerJobs: [SPEARMAN, BOWMAN],
        commanderJob: SPEARMAN,
        hitpoints: 3000,
      },
    ],
  });
}

/** Map string ids the gear steps' notices name. */
export const LIGHT_ARMOR_NOTICE = { title: 1, detail: 2 };
export const AMULET_NOTICE = { title: 1, detail: 3 };

/** Two gear steps for the fortress and its raider. */
export const GEAR_SCHEDULE: NonNullable<MapModulesInput['gearSchedule']> = {
  version: 1,
  seats: [FORTRESS, RAIDER],
  steps: [
    {
      atSeconds: LIGHT_ARMOR_SECONDS,
      notice: LIGHT_ARMOR_NOTICE,
      grants: [{ goods: ['armor_wool', 'armor_leather'] }, { goods: ['shoes'] }],
    },
    {
      atSeconds: AMULET_SECONDS,
      notice: AMULET_NOTICE,
      grants: [{ goods: ['amulet_defense'] }],
    },
  ],
};

/** {@link SIEGE} with catapults that return, and the {@link GEAR_SCHEDULE}. */
export const GEARED: MapModulesInput = {
  siege: { ...SIEGE, catapults: { respawnSeconds: CATAPULT_RESPAWN_SECONDS } },
  gearSchedule: GEAR_SCHEDULE,
};
