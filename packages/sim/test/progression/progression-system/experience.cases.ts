import { describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  Felling,
  Position,
  Resource,
  Settler,
} from '../../../src/components/index.js';
import { fx, Simulation } from '../../../src/index.js';
import { atomicSystem, grantWorkExperience, trackFor } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, GENERAL_TRACK, MINER, makeSettler, WOOD, WOOD_TRACK, WOODCUTTER } from './support.js';

describe('trackFor — (job, good) specialization lookup', () => {
  it('prefers the good-specific track over the general one for the same job', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const track = trackFor(ctxOf(sim), WOODCUTTER, WOOD);
    expect(track?.typeId).toBe(WOOD_TRACK); // the narrow (job, good) track, not the general fallback
  });

  it('falls back to the general track when no good-specific track matches', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Good 2 (plank) has no woodcutter-specific track → the general (no-good) track applies.
    const track = trackFor(ctxOf(sim), WOODCUTTER, 2);
    expect(track?.typeId).toBe(GENERAL_TRACK);
  });

  it('returns undefined when the job has no track at all', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    expect(trackFor(ctxOf(sim), MINER /* no tracks in fixture */, WOOD)).toBeUndefined();
  });
});

describe('grantWorkExperience — accrual on a completed work atomic', () => {
  it('trains both the good-specific and the job-general track, each at its own factor', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    grantWorkExperience(sim.world, ctxOf(sim), e, WOOD, 1);
    expect(sim.world.get(e, Settler).experience.get(WOOD_TRACK)).toBe(10); // specific factor 10
    expect(sim.world.get(e, Settler).experience.get(GENERAL_TRACK)).toBe(1); // general factor 1
  });

  it('accumulates across repeated work (repetition builds expertise)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    const ctx = ctxOf(sim);
    grantWorkExperience(sim.world, ctx, e, WOOD, 1);
    grantWorkExperience(sim.world, ctx, e, WOOD, 1);
    grantWorkExperience(sim.world, ctx, e, WOOD, 1);
    expect(sim.world.get(e, Settler).experience.get(WOOD_TRACK)).toBe(30); // 3 × 10
    expect(sim.world.get(e, Settler).experience.get(GENERAL_TRACK)).toBe(3); // 3 × 1
  });

  it('grants the general track once (not twice) when a good has no specific track', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    grantWorkExperience(sim.world, ctxOf(sim), e, 2 /* plank: no specific track */, 1);
    expect(sim.world.get(e, Settler).experience.get(GENERAL_TRACK)).toBe(1);
    expect(sim.world.get(e, Settler).experience.size).toBe(1);
  });

  it('is a no-op for an unemployed settler (no job → no specialization)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, null);
    grantWorkExperience(sim.world, ctxOf(sim), e, WOOD, 1);
    expect(sim.world.get(e, Settler).experience.size).toBe(0);
  });

  it('is a no-op when the job/good pairing has no track', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, MINER /* no tracks */);
    grantWorkExperience(sim.world, ctxOf(sim), e, WOOD, 1);
    expect(sim.world.get(e, Settler).experience.size).toBe(0);
  });

  it('scales with extracted units and skips a zero-unit swing (XP counts resources, not swings)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    const ctx = ctxOf(sim);
    grantWorkExperience(sim.world, ctx, e, WOOD, 5); // a felled trunk trains its whole yield at once
    grantWorkExperience(sim.world, ctx, e, WOOD, 0); // a mid-job chop trains nothing
    expect(sim.world.get(e, Settler).experience.get(WOOD_TRACK)).toBe(50); // 5 units × factor 10
    expect(sim.world.get(e, Settler).experience.get(GENERAL_TRACK)).toBe(5); // 5 units × factor 1
  });
});

describe('AtomicSystem grants XP on a completed harvest', () => {
  it('a woodcutter completing a wood harvest accrues the wood specialization', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    const resource = sim.world.create();
    sim.world.add(resource, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });
    sim.world.add(e, CurrentAtomic, {
      atomicId: 24,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1,
      effect: { kind: 'harvest', resource, goodType: WOOD },
      targetEntity: null,
      targetTile: null,
    });
    atomicSystem(sim.world, ctxOf(sim)); // completes this tick → harvest + XP grant
    expect(sim.world.get(e, Carrying)).toEqual({ goodType: WOOD, amount: 1 }); // harvest still happens
    expect(sim.world.get(e, Settler).experience.get(WOOD_TRACK)).toBe(10); // and trained the spec
  });

  it('a felling job trains only on the swing that drops the trunk, by its whole yield', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(1), y: fx.fromInt(1) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: 24 });
    sim.world.add(tree, Felling, { chopsLeft: 2 });
    const swing = () => {
      sim.world.add(e, CurrentAtomic, {
        atomicId: 24,
        elapsed: 0,
        progress: fx.fromInt(0),
        duration: 1,
        effect: { kind: 'harvest', resource: tree, goodType: WOOD },
        targetEntity: null,
        targetTile: null,
      });
      atomicSystem(sim.world, ctxOf(sim));
      sim.world.remove(e, CurrentAtomic); // shed any rest tail so the next swing starts clean
    };
    swing(); // chop 1 of 2 — nothing extracted yet
    expect(sim.world.get(e, Settler).experience.size).toBe(0);
    swing(); // the felling chop — the whole 4-unit trunk drops
    expect(sim.world.get(e, Settler).experience.get(WOOD_TRACK)).toBe(40); // 4 units × factor 10
  });
});
