import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  Building,
  DefenceMode,
  JobAssignment,
  Militia,
  Position,
  Projectile,
  SeatOffenders,
  Settler,
  Sheltering,
  setDiplomacyStance,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  positionOfNode,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../../../src/index.js';
import { hexDistanceBetween } from '../../../../../src/nav/halfcell.js';
import {
  MILITIA_HOLD_TICKS,
  MILITIA_PER_ZONE_MAX,
  SCOUT_CHASE_HOLD_TICKS,
  SCOUT_CHASERS_PER_SCOUT,
  THREAT_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
} from '../../../../../src/systems/ai-shared/military/defence/index.js';
import { settlementDefenceSystem } from '../../../../../src/systems/ai-shared/military/settlement-defence.js';
import {
  AI_SEAT_SLOT_STEP_TICKS,
  COMPUTER_DECISION_INTERVAL_TICKS,
  MILITARY_DECISION_PHASE,
} from '../../../../../src/systems/computer-player/index.js';
import { DEMOBILIZE_UNTIL_TICK } from '../../../../../src/systems/computer-player/workforce/demobilize.js';
import { noteOffence } from '../../../../../src/systems/conflict/offenders.js';
import { setAiControl } from '../../../../../src/systems/orders/ai.js';
import { assignWorker } from '../../../../../src/systems/orders/work/employment.js';
import { WEAPON_MAIN_TYPE } from '../../../../../src/systems/readviews/index.js';
import { entityNode } from '../../../../../src/systems/spatial/nodes.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { grassNodeMap } from '../../../../fixtures/terrain.js';

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
/** The headquarters' shelter room in the AI fixture. */
const HQ_SHELTER_ROOM = 20;
const CIVILIST = 6;
const HUNTER = 15;
const CARRIER = 24;
const SCOUT = 27;
const SPEARMAN = 32;
const HUNTER_BOW = 30;
/** The bow's damage against an unarmoured man. */
const HUNTER_BOW_DAMAGE = 700;
const MAP = { width: 128, height: 96 };
const HQ_AT = { x: 24, y: 20 };
/** Where the raider waits while the town is set up, out of every soldier's sight. */
const FAR_OFF = { x: 120, y: 90 };
/** Inside the headquarters' watch band, beyond the bow's near reach of the seat's people. */
const RAIDER_OFFSET = 12;
/** The headquarters' carrier seats. */
const CARRIER_SEATS = 3;
/** Far outside the headquarters' zone. */
const ELSEWHERE = { x: 70, y: 80 };
/** Enough people that the per-zone cap, not the seat's share of its people, binds. */
const CROWD = 24;
/** The seat's first defence decision while the computer player runs it. */
const DEFENCE_TICK = SEAT * AI_SEAT_SLOT_STEP_TICKS + MILITARY_DECISION_PHASE;
/** The first of the seat's decisions after a militia armed at {@link DEFENCE_TICK} may stand down. */
const STAND_DOWN_TICK = DEFENCE_TICK + decisionsOver(MILITIA_HOLD_TICKS) * COMPUTER_DECISION_INTERVAL_TICKS;
/** Past the scout's band, inside the leash his chasers hold. */
const RIM_OFFSET = 3;

/** How many of the seat's decisions `ticks` spans, rounded up. */
function decisionsOver(ticks: number): number {
  return Math.ceil(ticks / COMPUTER_DECISION_INTERVAL_TICKS);
}

/** The AI fixture with the hunter's trade and bow. */
function content(): ContentSet {
  const base = aiContent();
  const bow = base.weapons.find((w) => w.mainType === WEAPON_MAIN_TYPE.BOW);
  const civilist = base.jobs.find((j) => j.typeId === CIVILIST);
  if (bow === undefined || civilist === undefined) throw new Error('setup: the AI fixture lost its bow');
  return {
    ...base,
    jobs: [...base.jobs, { ...civilist, typeId: HUNTER, id: 'hunter', name: 'hunter' }],
    weapons: [
      ...base.weapons,
      { ...bow, typeId: HUNTER_BOW, id: 'hunter_bow', jobType: HUNTER, damage: { '0': HUNTER_BOW_DAMAGE } },
    ],
  };
}

function town(): { sim: Simulation; hq: Entity } {
  const sim = new Simulation({ seed: 1, content: content(), map: grassNodeMap(MAP.width, MAP.height) });
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ_TYPE, ...HQ_AT, tribe: VIKING, owner: SEAT });
  sim.step();
  const hq = [...sim.world.query(Building)][0];
  if (hq === undefined) throw new Error('setup: the headquarters was refused');
  return { sim, hq };
}

function spawn(sim: Simulation, jobType: number, x: number, y: number, owner: number): Entity {
  const before = new Set(sim.world.query(Settler));
  sim.enqueueSetup({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner });
  sim.step();
  const spawned = [...sim.world.query(Settler)].find((e) => !before.has(e));
  if (spawned === undefined) throw new Error('setup: the spawn was refused');
  return spawned;
}

/** `count` of the seat's civilians in a row below the headquarters. */
function crowd(sim: Simulation, count: number): Entity[] {
  return Array.from({ length: count }, (_, i) => spawn(sim, CIVILIST, HQ_AT.x - 8 + i, HQ_AT.y + 8, SEAT));
}

/** `seat` runs the computer player, the map AI alone, or nobody (a human). */
function control(sim: Simulation, seat: 'computer' | 'map' | 'human'): void {
  if (seat === 'human') return;
  setAiControl(sim.world, ctxOf(sim), {
    kind: 'setAiControl',
    player: SEAT,
    enabled: true,
    ...(seat === 'computer' ? {} : { computerEnabled: false }),
  });
}

/** An enemy spearman, stepped into the town with no tick between. */
function raiderIn(sim: Simulation): Entity {
  const raider = spawn(sim, SPEARMAN, FAR_OFF.x, FAR_OFF.y, FOE);
  sim.world.add(raider, Position, positionOfNode(HQ_AT.x + RAIDER_OFFSET, HQ_AT.y));
  return raider;
}

/** An enemy scout, stepped onto the headquarters' row `distance` from it with no tick between. */
function scoutAt(sim: Simulation, hq: Entity, distance: number): Entity {
  const scout = spawn(sim, SCOUT, FAR_OFF.x, FAR_OFF.y, FOE);
  standAt(sim, hq, scout, distance);
  return scout;
}

/** Stand `e` on the headquarters' row, `distance` east of it. */
function standAt(sim: Simulation, hq: Entity, e: Entity, distance: number): void {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain');
  const at = terrain.coordsOf(entityNode(sim.world, terrain, hq));
  let x = at.x;
  while (hexDistanceBetween(x, at.y, at.x, at.y) < distance) x++;
  sim.world.add(e, Position, positionOfNode(x, at.y));
}

/** Ring the headquarters' alarm and fill its shelter with the first of `people`; the rest cannot get in. */
function shelterFull(sim: Simulation, hq: Entity, people: readonly Entity[]): Entity[] {
  sim.world.add(hq, DefenceMode, {});
  for (const e of people.slice(0, HQ_SHELTER_ROOM)) sim.world.add(e, Sheltering, { shelter: hq });
  return people.slice(HQ_SHELTER_ROOM);
}

/** The computer player turns the soldiers a seat holds at the start into builders, so a fixture keeping
 *  its soldier spawns him once that window has passed and decides on a slot after it. */
function pastStartSoldiers(sim: Simulation): void {
  sim.run(DEMOBILIZE_UNTIL_TICK);
}
const LATE_DEFENCE_TICK =
  DEFENCE_TICK +
  Math.ceil(DEMOBILIZE_UNTIL_TICK / COMPUTER_DECISION_INTERVAL_TICKS) * COMPUTER_DECISION_INTERVAL_TICKS;

function decide(sim: Simulation, tick = DEFENCE_TICK): void {
  settlementDefenceSystem(sim.world, { ...ctxOf(sim), tick });
}

function militia(sim: Simulation): Entity[] {
  return [...sim.world.query(Militia)].sort((a, b) => a - b);
}

function band(sim: Simulation): number {
  return threatWatchNodes(ctxOf(sim), VIKING);
}

describe('computer defence - desperate militia', () => {
  it('arms the people its rung shelters cannot hold against an overwhelming raid, up to the zone cap', () => {
    const { sim, hq } = town();
    control(sim, 'computer');
    const people = crowd(sim, CROWD);
    shelterFull(sim, hq, people);
    const raider = raiderIn(sim);
    // The full shelter's claims as the decision finds them.
    const outside = people.filter((e) => !sim.world.has(e, Sheltering));

    decide(sim);

    const armed = militia(sim);
    expect(armed).toHaveLength(MILITIA_PER_ZONE_MAX);
    for (const e of armed) {
      expect(outside).toContain(e);
      expect(sim.world.get(e, Settler).jobType).toBe(HUNTER);
      expect(sim.world.get(e, AttackOrder).target).toBe(raider);
      expect(sim.world.get(e, Militia).zone).toBe(hq);
    }
    // A second decision on the same zone arms nobody more.
    decide(sim, DEFENCE_TICK + COMPUTER_DECISION_INTERVAL_TICKS);
    expect(militia(sim)).toEqual(armed);

    // And the hunters shoot him.
    const shooters = new Set<Entity>();
    for (let t = 0; t < COMPUTER_DECISION_INTERVAL_TICKS && shooters.size === 0; t++) {
      sim.step();
      for (const shot of sim.world.query(Projectile)) {
        const { source, target } = sim.world.get(shot, Projectile);
        if (target === raider && armed.includes(source)) shooters.add(source);
      }
    }
    expect(shooters.size).toBeGreaterThan(0);
  });

  it('rings its shelters first, and with room left arms only those who cannot take cover', () => {
    const { sim, hq } = town();
    control(sim, 'computer');
    // Fewer than the shelter holds, enough that the seat's share of its people would allow a militia.
    const people = crowd(sim, HQ_SHELTER_ROOM - MILITIA_PER_ZONE_MAX);
    const ownScout = spawn(sim, SCOUT, HQ_AT.x, HQ_AT.y + 8, SEAT);
    raiderIn(sim);

    decide(sim);
    expect(militia(sim)).toEqual([]);
    sim.step();
    expect(sim.world.has(hq, DefenceMode)).toBe(true);

    // Rung, with room left: whoever can still run for cover does; a scout never shelters, so only a scout
    // may be armed.
    decide(sim, DEFENCE_TICK + COMPUTER_DECISION_INTERVAL_TICKS);
    expect(militia(sim)).toContain(ownScout);
    for (const e of [...people, ownScout]) {
      if (sim.world.has(e, Militia)) expect(sim.world.get(e, Militia).previousJob).toBe(SCOUT);
    }
  });

  it('arms nobody against a raid its soldiers roughly match, even with them already in the fight', () => {
    const { sim, hq } = town();
    pastStartSoldiers(sim);
    control(sim, 'computer');
    const soldier = spawn(sim, SPEARMAN, HQ_AT.x, HQ_AT.y + 6, SEAT);
    shelterFull(sim, hq, crowd(sim, CROWD));
    const raider = raiderIn(sim);

    decide(sim, LATE_DEFENCE_TICK);
    expect(militia(sim)).toEqual([]);

    sim.world.add(soldier, AttackOrder, { target: raider });
    decide(sim, LATE_DEFENCE_TICK + COMPUTER_DECISION_INTERVAL_TICKS);
    expect(militia(sim)).toEqual([]);
  });

  it('puts a militiaman back to his trade and workplace once the zone has been safe the hold', () => {
    const { sim, hq } = town();
    const carriers = crowd(sim, CARRIER_SEATS);
    for (const e of carriers) {
      const ctx = ctxOf(sim);
      assignWorker(sim.world, ctx, { kind: 'assignWorker', entity: e, building: hq, jobPriority: [CARRIER] });
    }
    // Far outside the zone, so only the carriers are near enough to arm; they fill the shelter.
    const elsewhere = Array.from({ length: CROWD }, (_, i) =>
      spawn(sim, CIVILIST, ELSEWHERE.x + i, ELSEWHERE.y, SEAT),
    );
    shelterFull(sim, hq, elsewhere);
    // Only now, so the computer player's own staffing leaves the setup as it is.
    control(sim, 'computer');
    const raider = raiderIn(sim);
    decide(sim);
    const armed = militia(sim);
    expect(armed).toEqual(carriers);
    for (const e of armed) expect(sim.world.has(e, JobAssignment)).toBe(false);

    sim.world.destroy(raider);
    decide(sim, STAND_DOWN_TICK - COMPUTER_DECISION_INTERVAL_TICKS);
    expect(militia(sim)).toEqual(armed);
    decide(sim, STAND_DOWN_TICK);

    expect(militia(sim)).toEqual([]);
    for (const e of armed) {
      expect(sim.world.get(e, Settler).jobType).toBe(CARRIER);
      expect(sim.world.get(e, JobAssignment).workplace).toBe(hq);
    }
  });

  it('stands its militia down and forgets its offenders once the computer stops running the seat', () => {
    const handovers = [
      { kind: 'setAiControl', player: SEAT, enabled: false },
      { kind: 'setAiControl', player: SEAT, enabled: true, computerEnabled: false },
    ] as const;
    for (const handover of handovers) {
      const { sim, hq } = town();
      control(sim, 'computer');
      const people = crowd(sim, CROWD);
      shelterFull(sim, hq, people);
      noteOffence(sim.world, ctxOf(sim), raiderIn(sim), SEAT);
      const trades = new Map(people.map((e) => [e, sim.world.get(e, Settler).jobType]));
      decide(sim);
      const armed = militia(sim);
      expect(armed).toHaveLength(MILITIA_PER_ZONE_MAX);
      expect([...sim.world.query(SeatOffenders)]).toHaveLength(1);

      setAiControl(sim.world, ctxOf(sim), handover);

      expect(militia(sim)).toEqual([]);
      for (const e of armed) expect(sim.world.get(e, Settler).jobType).toBe(trades.get(e));
      expect([...sim.world.query(SeatOffenders)]).toEqual([]);
    }
  });

  it('never arms the people of a human seat or one only the map AI runs, against a raid or a scout', () => {
    for (const seat of ['human', 'map'] as const) {
      const { sim, hq } = town();
      control(sim, seat);
      shelterFull(sim, hq, crowd(sim, CROWD));
      raiderIn(sim);
      scoutAt(sim, hq, RAIDER_OFFSET);

      for (let tick = 0; tick < COMPUTER_DECISION_INTERVAL_TICKS; tick++) decide(sim, tick);

      expect(militia(sim)).toEqual([]);
    }
  });

  it('keeps its militia through a save', () => {
    const { sim, hq } = town();
    control(sim, 'computer');
    shelterFull(sim, hq, crowd(sim, CROWD));
    raiderIn(sim);
    scoutAt(sim, hq, RAIDER_OFFSET);
    decide(sim);

    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content: sim.content,
      map: grassNodeMap(MAP.width, MAP.height),
    });

    expect(restored.hashState()).toBe(sim.hashState());
    expect(militia(restored)).toEqual(militia(sim));
  });
});

describe('computer defence - scout chasers', () => {
  it('with no soldier, arms two hunters at a scout walking in, and puts them back soon after he leaves', () => {
    const { sim, hq } = town();
    control(sim, 'computer');
    const people = crowd(sim, CROWD);
    const trades = new Map(people.map((e) => [e, sim.world.get(e, Settler).jobType]));
    const scout = scoutAt(sim, hq, RAIDER_OFFSET);

    decide(sim);

    const chasers = militia(sim);
    expect(chasers).toHaveLength(SCOUT_CHASERS_PER_SCOUT);
    for (const e of chasers) {
      expect(sim.world.get(e, Settler).jobType).toBe(HUNTER);
      expect(sim.world.get(e, Militia).quarry).toBe(scout);
      expect(sim.world.get(e, AttackOrder).target).toBe(scout);
      expect(sim.world.get(e, AttackOrder).leash?.radius).toBe(band(sim) + THREAT_STAND_DOWN_MARGIN_NODES);
    }
    decide(sim, DEFENCE_TICK + COMPUTER_DECISION_INTERVAL_TICKS);
    expect(militia(sim)).toEqual(chasers);

    // He walks off past the leash: they hold the short hold, then go back to their trades.
    const left = DEFENCE_TICK + COMPUTER_DECISION_INTERVAL_TICKS;
    standAt(sim, hq, scout, band(sim) + THREAT_STAND_DOWN_MARGIN_NODES + RIM_OFFSET);
    const release = left + decisionsOver(SCOUT_CHASE_HOLD_TICKS) * COMPUTER_DECISION_INTERVAL_TICKS;
    decide(sim, release - COMPUTER_DECISION_INTERVAL_TICKS);
    expect(militia(sim)).toEqual(chasers);
    decide(sim, release);

    expect(militia(sim)).toEqual([]);
    for (const e of chasers) expect(sim.world.get(e, Settler).jobType).toBe(trades.get(e));
  });

  it('stands its chasers down after the hold once the scout is no longer an enemy, though he stays', () => {
    const { sim, hq } = town();
    control(sim, 'computer');
    const people = crowd(sim, CROWD);
    const trades = new Map(people.map((e) => [e, sim.world.get(e, Settler).jobType]));
    scoutAt(sim, hq, RAIDER_OFFSET);
    decide(sim);
    const chasers = militia(sim);
    expect(chasers).toHaveLength(SCOUT_CHASERS_PER_SCOUT);

    setDiplomacyStance(sim.world, SEAT, FOE, 'neutral');
    setDiplomacyStance(sim.world, FOE, SEAT, 'neutral');
    const release = DEFENCE_TICK + decisionsOver(SCOUT_CHASE_HOLD_TICKS) * COMPUTER_DECISION_INTERVAL_TICKS;
    decide(sim, release);

    expect(militia(sim)).toEqual([]);
    for (const e of chasers) expect(sim.world.get(e, Settler).jobType).toBe(trades.get(e));
  });

  it('keeps its scout chasers on their quarry through a save', () => {
    const { sim, hq } = town();
    control(sim, 'computer');
    crowd(sim, CROWD);
    const scout = scoutAt(sim, hq, RAIDER_OFFSET);
    decide(sim);

    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content: sim.content,
      map: grassNodeMap(MAP.width, MAP.height),
    });

    expect(restored.hashState()).toBe(sim.hashState());
    const chasers = militia(restored);
    expect(chasers).toHaveLength(SCOUT_CHASERS_PER_SCOUT);
    for (const e of chasers) expect(restored.world.get(e, Militia).quarry).toBe(scout);
  });

  it('keeps the same chasers while a scout paces the rim, and arms nobody new when he comes back to it', () => {
    const { sim, hq } = town();
    control(sim, 'computer');
    crowd(sim, CROWD);
    const rim = band(sim) + RIM_OFFSET;
    const scout = scoutAt(sim, hq, rim);
    let tick = DEFENCE_TICK;
    const next = (): number => {
      tick += COMPUTER_DECISION_INTERVAL_TICKS;
      return tick;
    };

    // On the rim, outside the band: nobody is armed yet.
    decide(sim, tick);
    expect(militia(sim)).toEqual([]);

    standAt(sim, hq, scout, RAIDER_OFFSET);
    decide(sim, next());
    const chasers = militia(sim);
    expect(chasers).toHaveLength(SCOUT_CHASERS_PER_SCOUT);

    // Back on the rim, still inside the leash, for far longer than the hold: the same men stay armed.
    standAt(sim, hq, scout, rim);
    for (let i = 0; i <= 2 * decisionsOver(SCOUT_CHASE_HOLD_TICKS); i++) {
      decide(sim, next());
      expect(militia(sim)).toEqual(chasers);
    }

    // Gone past the leash long enough to stand them down, then back on the rim: nobody new.
    standAt(sim, hq, scout, rim + THREAT_STAND_DOWN_MARGIN_NODES);
    for (let i = 0; i <= decisionsOver(SCOUT_CHASE_HOLD_TICKS); i++) decide(sim, next());
    expect(militia(sim)).toEqual([]);
    standAt(sim, hq, scout, rim);
    decide(sim, next());
    expect(militia(sim)).toEqual([]);
  });

  it('sends a free soldier at the scout instead, and arms nobody', () => {
    const { sim, hq } = town();
    pastStartSoldiers(sim);
    control(sim, 'computer');
    const soldier = spawn(sim, SPEARMAN, HQ_AT.x, HQ_AT.y + 6, SEAT);
    crowd(sim, CROWD);
    const scout = scoutAt(sim, hq, RAIDER_OFFSET);

    decide(sim, LATE_DEFENCE_TICK);

    expect(militia(sim)).toEqual([]);
    expect(sim.world.get(soldier, AttackOrder).target).toBe(scout);
  });
});
