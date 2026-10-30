import { describe, expect, it } from 'vitest';
import { aiControlEntity, ComputerStrategy, type MilitaryRule } from '../../../../src/components/index.js';
import type { Simulation } from '../../../../src/index.js';
import { ownedSettlers } from '../../../../src/systems/ai-shared/seat-roster.js';
import { SpareForce } from '../../../../src/systems/ai-shared/workforce/pool.js';
import { AI_PROFILES } from '../../../../src/systems/computer-player/difficulty.js';
import {
  ARMY_FLOOR_LEAD_TICKS,
  claimArmyFloor,
  garrisonArms,
} from '../../../../src/systems/computer-player/workforce/garrison.js';
import type { SystemContext } from '../../../../src/systems/context.js';
import {
  aiSim,
  armedContent,
  BARRACKS_TYPE,
  CIVILIST,
  ctxOf,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  makeAiSeat,
  SEAT,
  SWORD,
  spawnMen,
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
