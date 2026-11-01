import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { AttackOrder, Building, Position, Settler } from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../../../../src/index.js';
import {
  planSettlementDefence,
  settlementDefenceSystem,
} from '../../../../../src/systems/ai-shared/military/settlement-defence.js';
import {
  COMPUTER_DECISION_INTERVAL_TICKS,
  computerDecisionSlot,
  MILITARY_DECISION_PHASE,
  threatWatchNodes,
} from '../../../../../src/systems/computer-player/index.js';
import { STRIKE_BACK_PARTY } from '../../../../../src/systems/conflict/leash.js';
import { noteDrivenOff, noteOffence } from '../../../../../src/systems/conflict/offenders.js';
import { STRIKE_BACK_LEASH_NODES } from '../../../../../src/systems/conflict/strike-back.js';
import { setAiControl } from '../../../../../src/systems/orders/ai.js';
import { WEAPON_MAIN_TYPE } from '../../../../../src/systems/readviews/index.js';
import { entityNode } from '../../../../../src/systems/spatial/nodes.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { grassNodeMap } from '../../../../fixtures/terrain.js';

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const CIVILIST = 6;
const SCOUT = 27;
const SPEARMAN = 32;
const CIVILIAN_FIST = 98;
const HQ_AT = { x: 24, y: 20 };
/** Where the scout waits while the town is set up, out of every soldier's sight. */
const FAR_OFF = { x: 120, y: 90 };
/** Inside the headquarters' watch band, with room for the seat's people between. */
const INTRUDER_OFFSET = 10;
/** Further along the row from the scout than a civilian's strike-back leash reaches, inside the zone. */
const BEYOND_REACH = 2 * STRIKE_BACK_LEASH_NODES + 4;
/** The seat's first defence decision while the computer player runs it. */
const DEFENCE_TICK = computerDecisionSlot(SEAT) + MILITARY_DECISION_PHASE;

/** The AI fixture with fists for its civilians, who strike back with them. */
function content(): ContentSet {
  const base = aiContent();
  const soldierFist = base.weapons.find((w) => w.mainType === WEAPON_MAIN_TYPE.UNARMED);
  if (soldierFist === undefined) throw new Error('setup: the AI fixture lost its fist');
  const fist = { ...soldierFist, typeId: CIVILIAN_FIST, id: 'viking_civilian_fist', jobType: CIVILIST };
  return { ...base, weapons: [...base.weapons, fist] };
}

function town(): { sim: Simulation; hq: Entity } {
  const sim = new Simulation({ seed: 1, content: content(), map: grassNodeMap(128, 96) });
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

function seat(sim: Simulation, computer: boolean): void {
  setAiControl(sim.world, ctxOf(sim), {
    kind: 'setAiControl',
    player: SEAT,
    enabled: true,
    ...(computer ? {} : { computerEnabled: false }),
  });
}

/** An enemy of `jobType`, stepped into the town with no tick between, so no soldier sees him before the
 *  decision. */
function intruderIn(sim: Simulation, jobType: number): Entity {
  const intruder = spawn(sim, jobType, FAR_OFF.x, FAR_OFF.y, FOE);
  sim.world.add(intruder, Position, positionOfNode(HQ_AT.x + INTRUDER_OFFSET, HQ_AT.y));
  return intruder;
}

const scoutIn = (sim: Simulation): Entity => intruderIn(sim, SCOUT);
const thiefIn = (sim: Simulation): Entity => intruderIn(sim, CIVILIST);

function decide(sim: Simulation): void {
  settlementDefenceSystem(sim.world, { ...ctxOf(sim), tick: DEFENCE_TICK });
}

function onto(sim: Simulation, target: Entity): Entity[] {
  return [...sim.world.query(AttackOrder)].filter((e) => sim.world.get(e, AttackOrder).target === target);
}

function scoutChases(sim: Simulation): Entity[] {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: the map has no terrain');
  const plan = planSettlementDefence(sim.world, { ...ctxOf(sim), tick: DEFENCE_TICK }, terrain, SEAT, true);
  return plan.intruders.scoutChases.map((c) => c.scout);
}

describe('computer defence - answering unarmed intruders', () => {
  it('sends one free soldier at any enemy civilian walking into the town, scout or not, before he offends', () => {
    for (const jobType of [SCOUT, CIVILIST]) {
      const { sim } = town();
      seat(sim, true);
      spawn(sim, SPEARMAN, HQ_AT.x, HQ_AT.y + 6, SEAT);
      const nearest = spawn(sim, SPEARMAN, HQ_AT.x + 2, HQ_AT.y + 6, SEAT);
      const civilian = spawn(sim, CIVILIST, HQ_AT.x + 2, HQ_AT.y + 8, SEAT);
      const intruder = intruderIn(sim, jobType);

      decide(sim);

      expect(onto(sim, intruder)).toEqual([nearest]);
      expect(sim.world.has(civilian, AttackOrder)).toBe(false);
      // The leash reaches past the band he was answered inside, so the chase ends at the town's edge.
      expect(sim.world.get(nearest, AttackOrder).leash?.radius).toBeGreaterThan(
        threatWatchNodes(ctxOf(sim), VIKING),
      );
    }
  });

  it('with no soldier, hands a walking scout to the militia and leaves a walking civilian alone', () => {
    const { sim } = town();
    seat(sim, true);
    const civilian = spawn(sim, CIVILIST, HQ_AT.x + INTRUDER_OFFSET + 2, HQ_AT.y, SEAT);
    const walker = thiefIn(sim);
    expect(scoutChases(sim)).toEqual([]);

    const scout = scoutIn(sim);
    decide(sim);

    expect(scoutChases(sim)).toEqual([scout]);
    expect(onto(sim, walker)).toEqual([]);
    // The militia arms nobody in content without a hunter's trade, and nobody strikes him with fists.
    expect(sim.world.has(civilian, AttackOrder)).toBe(false);
  });

  it('sends a free soldier at a thief, and nobody more once one is on him', () => {
    const { sim } = town();
    seat(sim, true);
    const soldier = spawn(sim, SPEARMAN, HQ_AT.x, HQ_AT.y + 6, SEAT);
    const civilian = spawn(sim, CIVILIST, HQ_AT.x + INTRUDER_OFFSET + 2, HQ_AT.y, SEAT);
    const thief = thiefIn(sim);
    noteOffence(sim.world, ctxOf(sim), thief, SEAT);

    decide(sim);
    expect(onto(sim, thief)).toEqual([soldier]);
    expect(sim.world.has(civilian, AttackOrder)).toBe(false);
    // A second decision sends nobody more: the soldier already on him is counted.
    decide(sim);
    expect(onto(sim, thief)).toEqual([soldier]);
  });

  it('with no soldier, sends the civilians nearest the thief at him, two at most', () => {
    const { sim } = town();
    seat(sim, true);
    const thief = thiefIn(sim);
    const nearest = spawn(sim, CIVILIST, HQ_AT.x + INTRUDER_OFFSET + 2, HQ_AT.y, SEAT);
    const next = spawn(sim, CIVILIST, HQ_AT.x + INTRUDER_OFFSET + 4, HQ_AT.y, SEAT);
    const farther = spawn(sim, CIVILIST, HQ_AT.x + INTRUDER_OFFSET + 6, HQ_AT.y, SEAT);
    noteOffence(sim.world, ctxOf(sim), thief, SEAT);

    decide(sim);

    expect(onto(sim, thief)).toEqual([nearest, next]);
    expect(onto(sim, thief)).toHaveLength(STRIKE_BACK_PARTY);
    expect(sim.world.has(farther, AttackOrder)).toBe(false);
    // Each on the short strike-back leash of where it stood, not the zone's.
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: the map has no terrain');
    for (const e of [nearest, next]) {
      expect(sim.world.get(e, AttackOrder).leash).toEqual({
        at: entityNode(sim.world, terrain, e),
        radius: STRIKE_BACK_LEASH_NODES,
      });
    }
  });

  it('sends no civilian the thief already stands past the strike-back reach of', () => {
    const { sim } = town();
    seat(sim, true);
    const thief = thiefIn(sim);
    const civilian = spawn(sim, CIVILIST, HQ_AT.x + INTRUDER_OFFSET + BEYOND_REACH, HQ_AT.y, SEAT);
    noteOffence(sim.world, ctxOf(sim), thief, SEAT);

    decide(sim);

    expect(sim.world.has(civilian, AttackOrder)).toBe(false);
  });

  it('sends no civilian again at a thief they let go, until he offends anew', () => {
    const { sim } = town();
    seat(sim, true);
    const thief = thiefIn(sim);
    const civilian = spawn(sim, CIVILIST, HQ_AT.x + INTRUDER_OFFSET + 2, HQ_AT.y, SEAT);
    noteOffence(sim.world, ctxOf(sim), thief, SEAT);
    decide(sim);
    expect(onto(sim, thief)).toEqual([civilian]);

    // He steps past the civilian's leash, still inside the zone: the civilian lets him go.
    sim.world.add(thief, Position, positionOfNode(HQ_AT.x + INTRUDER_OFFSET + BEYOND_REACH, HQ_AT.y));
    sim.step();
    expect(onto(sim, thief)).toEqual([]);

    // Back beside the civilian, he is not sent at him again.
    sim.world.add(thief, Position, positionOfNode(HQ_AT.x + INTRUDER_OFFSET, HQ_AT.y));
    decide(sim);
    expect(onto(sim, thief)).toEqual([]);

    // A new offence is a new answer.
    noteOffence(sim.world, { ...ctxOf(sim), tick: sim.tick + 1 }, thief, SEAT);
    decide(sim);
    expect(onto(sim, thief)).toEqual([civilian]);
  });

  it('keeps a soldier on a thief across the zone, and sends one at a thief the civilians let go', () => {
    const { sim } = town();
    seat(sim, true);
    const soldier = spawn(sim, SPEARMAN, HQ_AT.x, HQ_AT.y + 6, SEAT);
    const thief = thiefIn(sim);
    noteOffence(sim.world, ctxOf(sim), thief, SEAT);
    noteDrivenOff(sim.world, SEAT, thief);

    decide(sim);
    expect(onto(sim, thief)).toEqual([soldier]);

    sim.world.add(thief, Position, positionOfNode(HQ_AT.x + INTRUDER_OFFSET + BEYOND_REACH, HQ_AT.y));
    sim.step();
    expect(onto(sim, thief)).toEqual([soldier]);
  });

  it('leaves a seat closed to the computer as it was: no offender is kept, nobody is sent', () => {
    const { sim } = town();
    seat(sim, false);
    spawn(sim, SPEARMAN, HQ_AT.x, HQ_AT.y + 6, SEAT);
    const scout = scoutIn(sim);
    noteOffence(sim.world, ctxOf(sim), scout, SEAT);

    // Every tick of one interval, so the map AI's own decision slot comes round.
    for (let tick = 0; tick < COMPUTER_DECISION_INTERVAL_TICKS; tick++) {
      settlementDefenceSystem(sim.world, { ...ctxOf(sim), tick });
    }

    expect(onto(sim, scout)).toEqual([]);
  });
});
