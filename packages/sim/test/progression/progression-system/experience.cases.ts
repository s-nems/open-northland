import { describe, expect, it } from 'vitest';
import { Carrying, CurrentAtomic, Resource, Settler } from '../../../src/components/index.js';
import { fx, Simulation } from '../../../src/index.js';
import { atomicSystem, grantWorkExperience, trackFor } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, GENERAL_TRACK, makeSettler, WOOD, WOOD_TRACK, WOODCUTTER } from './support.js';

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
    expect(trackFor(ctxOf(sim), 2 /* carpenter: no tracks in fixture */, WOOD)).toBeUndefined();
  });
});

describe('grantWorkExperience — accrual on a completed work atomic', () => {
  it('adds the wood track factor to the matching specialization', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    grantWorkExperience(sim.world, ctxOf(sim), e, WOOD);
    expect(sim.world.get(e, Settler).experience.get(WOOD_TRACK)).toBe(10); // experienceFactor
    expect(sim.world.get(e, Settler).experience.has(GENERAL_TRACK)).toBe(false); // wood preferred
  });

  it('accumulates across repeated work (repetition builds expertise)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    const ctx = ctxOf(sim);
    grantWorkExperience(sim.world, ctx, e, WOOD);
    grantWorkExperience(sim.world, ctx, e, WOOD);
    grantWorkExperience(sim.world, ctx, e, WOOD);
    expect(sim.world.get(e, Settler).experience.get(WOOD_TRACK)).toBe(30); // 3 × 10
  });

  it('grants the general track when working a good with no specific track', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    grantWorkExperience(sim.world, ctxOf(sim), e, 2 /* plank: no specific track */);
    expect(sim.world.get(e, Settler).experience.get(GENERAL_TRACK)).toBe(1);
  });

  it('is a no-op for an unemployed settler (no job → no specialization)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, null);
    grantWorkExperience(sim.world, ctxOf(sim), e, WOOD);
    expect(sim.world.get(e, Settler).experience.size).toBe(0);
  });

  it('is a no-op when the job/good pairing has no track', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, 2 /* carpenter: no tracks */);
    grantWorkExperience(sim.world, ctxOf(sim), e, WOOD);
    expect(sim.world.get(e, Settler).experience.size).toBe(0);
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
});
