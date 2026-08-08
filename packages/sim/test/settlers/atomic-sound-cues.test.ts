import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Felling, Position, Resource } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { atomicSystem } from '../../src/systems/index.js';
import { TEST_MANIFEST, testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

/**
 * The AtomicSystem's authored sound cues: a settler's action sounds on its animation's
 * `event <at> 34 <id>` frames (`ATOMIC_ANIMATION_EVENT_TYPE_PLAY_SOUND_FX`), carrying the sound bank's
 * `logicSoundType` id. The engine picks no sound of its own, so a clip with no such row is silent.
 */

const PLAY_SOUND_FX = 34;
const VIKING = 1;
const CIVILIST_JOB = 6;
const COLLECTOR_JOB = 8;
/** `logicSoundType` ids the clips below name - the axe and the male chat voice. */
const AXE = 9;
const VOICE = 61;

const CHOP_ATOMIC = 24;
/** The shared fixture's woodcutter and its wood good - the trade that binds `viking_chop` to CHOP_ATOMIC. */
const WOODCUTTER_JOB = 1;
const WOOD = 1;
const SILENT_ATOMIC = 25;
const TWO_CUE_ATOMIC = 26;
const OVERRUN_ATOMIC = 27;
const CIVILIST_ONLY_ATOMIC = 28;

const CHOP_LENGTH = 6;

/** Content whose clips differ only in their cue rows, so each case reads as one authored difference. */
function cueContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    // Nothing here harvests or builds; the swings run on their animation clocks alone. The two trades
    // exist only so the `setatomic` rows below resolve.
    goods: [],
    jobs: [
      { typeId: CIVILIST_JOB, id: 'civilist' },
      { typeId: COLLECTOR_JOB, id: 'collector' },
    ],
    buildings: [],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [
          { jobType: COLLECTOR_JOB, atomicId: CHOP_ATOMIC, animation: 'chop' },
          { jobType: COLLECTOR_JOB, atomicId: SILENT_ATOMIC, animation: 'silent' },
          { jobType: COLLECTOR_JOB, atomicId: TWO_CUE_ATOMIC, animation: 'two_cue' },
          { jobType: COLLECTOR_JOB, atomicId: OVERRUN_ATOMIC, animation: 'overrun' },
          // Bound on the civilist body only, the original's `baseatomics 6` inheritance.
          { jobType: CIVILIST_JOB, atomicId: CIVILIST_ONLY_ATOMIC, animation: 'inherited' },
        ],
      },
    ],
    atomicAnimations: [
      { id: 'chop', name: 'chop', length: CHOP_LENGTH, events: [{ at: 4, type: PLAY_SOUND_FX, value: AXE }] },
      { id: 'silent', name: 'silent', length: CHOP_LENGTH },
      {
        id: 'two_cue',
        name: 'two_cue',
        length: CHOP_LENGTH,
        events: [
          { at: 2, type: PLAY_SOUND_FX, value: AXE },
          { at: 5, type: PLAY_SOUND_FX, value: VOICE },
        ],
      },
      // A cue the data puts past the clip's own length.
      {
        id: 'overrun',
        name: 'overrun',
        length: CHOP_LENGTH,
        events: [{ at: 99, type: PLAY_SOUND_FX, value: AXE }],
      },
      {
        id: 'inherited',
        name: 'inherited',
        length: CHOP_LENGTH,
        events: [{ at: 3, type: PLAY_SOUND_FX, value: VOICE }],
      },
    ],
  });
}

/** Run one `atomicId` swing to completion, returning `(tick, soundType)` for every cue it fired. */
function cuesOverSwing(
  jobType: number,
  atomicId: number,
  duration = CHOP_LENGTH,
): { tick: number; soundType: number }[] {
  const sim = new Simulation({ seed: 1, content: cueContent() });
  const e: Entity = settlerAt(sim, { jobType });
  sim.world.add(e, CurrentAtomic, {
    atomicId,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration,
    effect: { kind: 'idle' },
    targetEntity: null,
    targetTile: null,
  });
  const fired: { tick: number; soundType: number }[] = [];
  for (let tick = 1; tick <= CHOP_LENGTH; tick++) {
    sim.events.clear();
    atomicSystem(sim.world, ctxOf(sim));
    for (const ev of sim.events.current()) {
      if (ev.kind === 'atomicSound') fired.push({ tick, soundType: ev.soundType });
    }
  }
  return fired;
}

describe('atomicSystem - authored sound cues', () => {
  it('fires the clip’s cue on its authored frame, with the id the data names', () => {
    expect(cuesOverSwing(COLLECTOR_JOB, CHOP_ATOMIC)).toEqual([{ tick: 4, soundType: AXE }]);
  });

  it('keeps a clip with no cue silent for the whole swing, completion included', () => {
    expect(cuesOverSwing(COLLECTOR_JOB, SILENT_ATOMIC)).toEqual([]);
  });

  it('fires every cue a clip authors, each on its own frame', () => {
    expect(cuesOverSwing(COLLECTOR_JOB, TWO_CUE_ATOMIC)).toEqual([
      { tick: 2, soundType: AXE },
      { tick: 5, soundType: VOICE },
    ]);
  });

  it('stays silent for a cue authored past the clip it belongs to', () => {
    // There is no frame to land on, and guessing one would put the sound somewhere the data never asked.
    expect(cuesOverSwing(COLLECTOR_JOB, OVERRUN_ATOMIC)).toEqual([]);
  });

  it('stays silent when the atomic runs shorter than the clip, so frames cannot be placed', () => {
    // The at-home sleeper's case: the drive starts a short `_home` twin under the bound clip's atomic id,
    // so the bound clip's frames belong to an animation this atomic is not playing.
    expect(cuesOverSwing(COLLECTOR_JOB, CHOP_ATOMIC, CHOP_LENGTH - 1)).toEqual([]);
    expect(cuesOverSwing(COLLECTOR_JOB, CHOP_ATOMIC)).toHaveLength(1); // same clip, its own clock
  });

  it('sounds a clip a trade inherits from the civilist body', () => {
    expect(cuesOverSwing(COLLECTOR_JOB, CIVILIST_ONLY_ATOMIC)).toEqual([{ tick: 3, soundType: VOICE }]);
  });

  it('sounds a multi-swing harvest once per swing, and never through the breather between them', () => {
    // The fixture chop is 3 ticks with its cue at frame 2; a harvest burst re-arms the clip in place and
    // appends a rest tail every few swings, so the cue must track the swings, not the atomic's lifetime.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const cutter = settlerAt(sim, {
      jobType: WOODCUTTER_JOB,
      position: { x: fx.fromInt(0), y: fx.fromInt(0) },
    });
    // A standing tree is FELLED over several chops that each yield nothing, so the swing re-arms in place.
    const felling = testContent().goods.find((g) => g.id === 'wood')?.gathering;
    const chops = felling?.chopsToFell ?? 0;
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(tree, Resource, {
      goodType: WOOD,
      remaining: felling?.yieldPerNode ?? 0,
      harvestAtomic: CHOP_ATOMIC,
    });
    sim.world.add(tree, Felling, { chopsLeft: chops });
    sim.world.add(cutter, CurrentAtomic, {
      atomicId: CHOP_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 3,
      effect: { kind: 'harvest', resource: tree, goodType: WOOD },
      targetEntity: tree,
      targetTile: null,
    });

    let swings = 0;
    let cues = 0;
    let cuesInBreather = 0;
    for (let tick = 0; tick < 60; tick++) {
      const before = sim.world.tryGet(cutter, CurrentAtomic);
      if (before === undefined) break;
      const resting = before.restTail === true;
      if (before.elapsed === 0) swings += 1;
      sim.events.clear();
      atomicSystem(sim.world, ctxOf(sim));
      for (const ev of sim.events.current()) {
        if (ev.kind !== 'atomicSound') continue;
        cues += 1;
        if (resting) cuesInBreather += 1;
      }
    }

    expect(swings).toBeGreaterThan(2); // the burst really did re-arm, so the count means something
    expect(swings).toBeLessThanOrEqual(chops); // and it stopped once the tree came down
    expect(cues).toBe(swings);
    expect(cuesInBreather).toBe(0);
  });
});
