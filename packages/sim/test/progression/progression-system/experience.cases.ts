import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  Carrying,
  Felling,
  Position,
  Resource,
  removeCurrentAtomic,
  SettlerProgress,
} from '../../../src/components/index.js';
import { fx, Simulation } from '../../../src/index.js';
import {
  anchorOnlyFootprint,
  atomicSystem,
  grantWorkExperience,
  stampResourceFootprintData,
  trackFor,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, GENERAL_TRACK, MINER, makeSettler, WOOD, WOOD_TRACK, WOODCUTTER } from './support.js';

describe('trackFor - (job, good) specialization lookup', () => {
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

describe('grantWorkExperience - accrual on a completed work atomic', () => {
  it('trains the general and good-specific tracks together', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    grantWorkExperience(sim.world, ctxOf(sim), e, WOOD, 1);
    expect(sim.world.get(e, SettlerProgress).experience.get(WOOD_TRACK)).toBe(10); // specific factor 10
    expect(sim.world.get(e, SettlerProgress).experience.get(GENERAL_TRACK)).toBe(1);
    expect(sim.world.get(e, SettlerProgress).experience.size).toBe(2);
  });

  it('accumulates across repeated work (repetition builds expertise)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    const ctx = ctxOf(sim);
    grantWorkExperience(sim.world, ctx, e, WOOD, 1);
    grantWorkExperience(sim.world, ctx, e, WOOD, 1);
    grantWorkExperience(sim.world, ctx, e, WOOD, 1);
    expect(sim.world.get(e, SettlerProgress).experience.get(WOOD_TRACK)).toBe(30); // 3 × 10
  });

  it('falls back to the general track when the good has no specific track', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    grantWorkExperience(sim.world, ctxOf(sim), e, 2 /* plank: no specific track */, 1);
    expect(sim.world.get(e, SettlerProgress).experience.get(GENERAL_TRACK)).toBe(1);
    expect(sim.world.get(e, SettlerProgress).experience.size).toBe(1);
  });

  it('is a no-op for an unemployed settler (no job → no specialization)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, null);
    grantWorkExperience(sim.world, ctxOf(sim), e, WOOD, 1);
    expect(sim.world.get(e, SettlerProgress).experience.size).toBe(0);
  });

  it('is a no-op when the job/good pairing has no track', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, MINER /* no tracks */);
    grantWorkExperience(sim.world, ctxOf(sim), e, WOOD, 1);
    expect(sim.world.get(e, SettlerProgress).experience.size).toBe(0);
  });

  it('scales with extracted units and skips a zero-unit swing (XP counts resources, not swings)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    const ctx = ctxOf(sim);
    grantWorkExperience(sim.world, ctx, e, WOOD, 5); // five completed works at once
    grantWorkExperience(sim.world, ctx, e, WOOD, 0); // a stroke that frees nothing trains nothing
    expect(sim.world.get(e, SettlerProgress).experience.get(WOOD_TRACK)).toBe(50); // 5 units × factor 10
  });
});

describe('AtomicSystem grants XP on a completed harvest', () => {
  it('a woodcutter completing a wood unit accrues the wood specialization once', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    const strokes = sim.content.jobExperience.find((t) => t.typeId === WOOD_TRACK)?.baseRepeatCounter ?? 0;
    const resource = sim.world.create();
    sim.world.add(resource, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });
    stampResourceFootprintData(sim.world, resource, anchorOnlyFootprint());
    addCurrentAtomic(sim.world, e, {
      atomicId: 24,
      duration: 1,
      effect: { kind: 'harvest', resource, goodType: WOOD },
      targetEntity: null,
      targetTile: null,
    });
    // The chop is stroke-counted: the chain lands the track's count, the last stroke freeing the unit.
    for (let stroke = 0; stroke < strokes; stroke++) {
      expect(sim.world.has(e, Carrying)).toBe(false);
      atomicSystem(sim.world, ctxOf(sim));
    }
    expect(sim.world.get(e, Carrying)).toEqual({ goodType: WOOD, amount: 1 }); // harvest still happens
    expect(sim.world.get(e, SettlerProgress).experience.get(WOOD_TRACK)).toBe(10); // and trained the spec
  });

  it('a felling job trains once, on the stroke that drops the trunk, not by its yield', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = makeSettler(sim, WOODCUTTER);
    const strokes = sim.content.jobExperience.find((t) => t.typeId === WOOD_TRACK)?.baseRepeatCounter ?? 0;
    const factor = sim.content.jobExperience.find((t) => t.typeId === WOOD_TRACK)?.experienceFactor ?? 0;
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(1), y: fx.fromInt(1) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: 24 });
    stampResourceFootprintData(sim.world, tree, anchorOnlyFootprint());
    sim.world.add(tree, Felling, { chops: 0 });
    const swing = () => {
      addCurrentAtomic(sim.world, e, {
        atomicId: 24,
        duration: 1,
        effect: { kind: 'harvest', resource: tree, goodType: WOOD },
        targetEntity: null,
        targetTile: null,
      });
      atomicSystem(sim.world, ctxOf(sim));
      removeCurrentAtomic(sim.world, e); // each swing starts clean
    };
    for (let stroke = 1; stroke < strokes; stroke++) swing(); // nothing extracted yet
    expect(sim.world.get(e, SettlerProgress).experience.size).toBe(0);
    swing(); // the felling stroke - the whole 4-unit trunk drops
    expect(sim.world.has(tree, Resource)).toBe(false);
    expect(sim.world.get(e, SettlerProgress).experience.get(WOOD_TRACK)).toBe(factor); // one work
  });
});
