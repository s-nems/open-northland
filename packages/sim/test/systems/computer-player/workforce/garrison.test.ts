import { describe, expect, it } from 'vitest';
import { aiControlEntity, ComputerStrategy, type MilitaryRule } from '../../../../src/components/index.js';
import { Simulation } from '../../../../src/index.js';
import { ownedSettlers } from '../../../../src/systems/ai-shared/seat-roster.js';
import { SpareForce } from '../../../../src/systems/ai-shared/workforce/pool.js';
import { AI_PROFILES } from '../../../../src/systems/computer-player/difficulty.js';
import {
  ARMY_FLOOR_LEAD_TICKS,
  claimArmyFloor,
  garrisonArms,
} from '../../../../src/systems/computer-player/workforce/garrison.js';
import type { SystemContext } from '../../../../src/systems/context.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import {
  aiSim,
  armedContent,
  BARRACKS_TYPE,
  BOW,
  CIVILIST,
  collectModule,
  ctxOf,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  makeAiSeat,
  SEAT,
  SWORD,
  spawnMen,
  TOWER_TYPE,
  VIKING,
} from '../support.js';

/** Idle men enough for the floor's smallest claim. */
const IDLE_MEN = 5;
/** A barracks clear of the headquarters. */
const BARRACKS_AT = { x: HQ_X + 10, y: HQ_Y };

describe('the army floor before its lead', () => {
  /** A seat with a barracks, a sword in store and idle men, its deadline twice the floor's lead away. */
  function earlySeat(): { sim: Simulation; ctx: SystemContext } {
    const content = armedContent();
    const sim = aiSim(1, content);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x: HQ_X,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      initialGoods: [{ good: SWORD, amount: 1 }],
    });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      ...BARRACKS_AT,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: 2 * ARMY_FLOOR_LEAD_TICKS, players: [SEAT] });
    spawnMen(sim, IDLE_MEN, CIVILIST);
    makeAiSeat(sim, SEAT);
    sim.step();
    return { sim, ctx: { ...ctxOf(sim, sim.tick), content } };
  }

  function standDefending(sim: Simulation, evidence: MilitaryRule[]): void {
    const carrier = aiControlEntity(sim.world, SEAT);
    const military = carrier === null ? undefined : sim.world.tryGet(carrier, ComputerStrategy)?.military;
    if (carrier === null || military === undefined) throw new Error('setup: no strategy');
    sim.world.mut(carrier, ComputerStrategy).military = {
      ...military,
      challenger: null,
      posture: 'defend',
      evidence,
    };
  }

  function claimed(sim: Simulation, ctx: SystemContext): number {
    const men = ownedSettlers(sim.world, SEAT);
    const arms = garrisonArms(sim.world, ctx, SEAT, AI_PROFILES.hard);
    return claimArmyFloor(sim.world, ctx, SEAT, new SpareForce(men), arms, AI_PROFILES.hard).men.length;
  }

  it('drafts nobody for a stronger enemy alone, and drafts against a raid', () => {
    const { sim, ctx } = earlySeat();
    standDefending(sim, ['outmatched']);
    expect(claimed(sim, ctx)).toBe(0);
    standDefending(sim, ['underAttack']);
    expect(claimed(sim, ctx)).toBeGreaterThan(0);
  });
});

describe('the draft and the empty towers', () => {
  /** Men enough that the ladder leaves a draft past the towers' archers. */
  const SPARE = 40;
  const TOWERS = 2;

  /** The counter wants of a seat holding swords and bows, a barracks and `towers` standing empty towers. */
  function wants(towers: number): { trainSword: number; trainBow: number } {
    const content = armedContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 32) });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x: HQ_X,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      initialGoods: [
        { good: SWORD, amount: 1 },
        { good: BOW, amount: 1 },
      ],
    });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      ...BARRACKS_AT,
      tribe: VIKING,
      owner: SEAT,
    });
    for (let i = 0; i < towers; i++) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: TOWER_TYPE,
        x: 60 + 8 * i,
        y: 8,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    spawnMen(sim, SPARE, CIVILIST);
    makeAiSeat(sim, SEAT);
    sim.step();
    const out = { trainSword: 0, trainBow: 0 };
    for (const c of collectModule.run(sim.world, { ...ctxOf(sim, sim.tick), content }, SEAT)) {
      if (c.kind === 'setAssistantCounter' && (c.counter === 'trainSword' || c.counter === 'trainBow')) {
        out[c.counter] = c.value;
      }
    }
    return out;
  }

  it('gives each empty tower its first archer, then splits the rest as before', () => {
    const open = wants(0);
    const drafted = open.trainSword + open.trainBow;
    expect(drafted).toBeGreaterThan(TOWERS);
    const rest = drafted - TOWERS;
    expect(wants(TOWERS)).toEqual({
      trainSword: Math.ceil(rest / 2),
      trainBow: TOWERS + Math.floor(rest / 2),
    });
  });
});
