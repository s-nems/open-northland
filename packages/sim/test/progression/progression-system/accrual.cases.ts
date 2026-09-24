import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  Building,
  Carrying,
  Position,
  Settler,
  SettlerProgress,
  Stockpile,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import {
  atomicSystem,
  grantCarryExperience,
  grantProductionExperience,
  MAX_EXPERIENCE_REPEATS,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import {
  CARPENTER,
  CARPENTER_GENERAL_TRACK,
  CARRIER,
  CARRIER_TRACK,
  ctxOf,
  MINER,
  makeSettler,
  WOOD,
  WOODCUTTER,
} from './support.js';

// The executor applies the typed effect; the atomic id only names the animation, so any id serves.
const ANY_ATOMIC = 24;

describe('grantProductionExperience - one completed batch trains one operator', () => {
  it('accrues the job-GENERAL track, bypassing the good-specific one (profession-level XP)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const op = makeSettler(sim, CARPENTER);
    grantProductionExperience(sim.world, ctxOf(sim), 1, { kind: 'staffed', operators: [op] });
    const xp = sim.world.get(op, SettlerProgress).experience;
    expect(xp.get(CARPENTER_GENERAL_TRACK)).toBe(100); // carpenter_general experienceFactor
    expect(xp.size).toBe(1); // the good-specific carpenter_plank track stays untouched
  });

  it('never trains more operators than completed batches (canonical order)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const a = makeSettler(sim, CARPENTER);
    const b = makeSettler(sim, CARPENTER);
    grantProductionExperience(sim.world, ctxOf(sim), 1, { kind: 'staffed', operators: [a, b] });
    expect(sim.world.get(a, SettlerProgress).experience.get(CARPENTER_GENERAL_TRACK)).toBe(100);
    expect(sim.world.get(b, SettlerProgress).experience.size).toBe(0); // only one batch finished
  });

  it('caps at the operators on station when more batches than operators complete', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const op = makeSettler(sim, CARPENTER);
    grantProductionExperience(sim.world, ctxOf(sim), 3, { kind: 'staffed', operators: [op] });
    expect(sim.world.get(op, SettlerProgress).experience.get(CARPENTER_GENERAL_TRACK)).toBe(100); // once, not thrice
  });

  it('stops at the track cap without writing the settler again', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const op = makeSettler(sim, CARPENTER);
    const cap = 100 * MAX_EXPERIENCE_REPEATS; // carpenter_general experienceFactor times the repeat cap
    sim.world.mut(op, SettlerProgress).experience.set(CARPENTER_GENERAL_TRACK, cap);
    const generation = sim.world.componentValueGeneration(Settler);
    grantProductionExperience(sim.world, ctxOf(sim), 1, { kind: 'staffed', operators: [op] });
    expect(sim.world.get(op, SettlerProgress).experience.get(CARPENTER_GENERAL_TRACK)).toBe(cap);
    expect(sim.world.componentValueGeneration(Settler)).toBe(generation);
  });

  it('is a no-op for an unstaffed-by-design workplace and a general-trackless profession', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const trackless = makeSettler(sim, MINER /* no tracks */);
    grantProductionExperience(sim.world, ctxOf(sim), 1, { kind: 'unstaffed' });
    grantProductionExperience(sim.world, ctxOf(sim), 1, { kind: 'staffed', operators: [trackless] });
    expect(sim.world.get(trackless, SettlerProgress).experience.size).toBe(0);
  });

  it('excludes a carrier operator (a carrier-run utility trains only on deliveries)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const carrier = makeSettler(sim, CARRIER);
    grantProductionExperience(sim.world, ctxOf(sim), 1, { kind: 'staffed', operators: [carrier] });
    expect(sim.world.get(carrier, SettlerProgress).experience.size).toBe(0);
  });
});

describe('grantCarryExperience - a landed delivery trains the transport trade', () => {
  it('accrues the carrier general track for a carrier', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, CARRIER);
    grantCarryExperience(sim.world, ctxOf(sim), e);
    expect(sim.world.get(e, SettlerProgress).experience.get(CARRIER_TRACK)).toBe(50); // carrier_general factor
  });

  it('is a no-op for a non-carrier hauling its own goods', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    grantCarryExperience(sim.world, ctxOf(sim), e);
    expect(sim.world.get(e, SettlerProgress).experience.size).toBe(0);
  });
});

describe('AtomicSystem grants carry XP on a completed pileup', () => {
  /** A built fixture headquarters (stores wood, capacity 150) holding `wood` units. */
  function headquarters(sim: Simulation, wood: number) {
    const hq = sim.world.create();
    sim.world.add(hq, Building, { buildingType: 1, tribe: 1, built: ONE, level: 0 });
    sim.world.add(hq, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(hq, Stockpile, { amounts: new Map([[WOOD, wood]]) });
    return hq;
  }

  function pileupAtomic(sim: Simulation, e: Entity, store: Entity): void {
    sim.world.add(e, Carrying, { goodType: WOOD, amount: 1 });
    addCurrentAtomic(sim.world, e, {
      atomicId: ANY_ATOMIC,
      duration: 1,
      effect: { kind: 'pileup', store },
      targetEntity: null,
      targetTile: null,
    });
  }

  it('a carrier delivering into a store accrues the carrier track', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hq = headquarters(sim, 0);
    const e = makeSettler(sim, CARRIER);
    pileupAtomic(sim, e, hq);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hq, Stockpile).amounts.get(WOOD)).toBe(1); // the delivery landed
    expect(sim.world.get(e, SettlerProgress).experience.get(CARRIER_TRACK)).toBe(50);
  });

  it('a blocked deposit (store full) trains nothing', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hq = headquarters(sim, 150); // at the wood capacity - no room
    const e = makeSettler(sim, CARRIER);
    pileupAtomic(sim, e, hq);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Carrying)).toEqual({ goodType: WOOD, amount: 1 }); // still on the back
    expect(sim.world.get(e, SettlerProgress).experience.size).toBe(0);
  });
});
