import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { CurrentAtomic } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { atomicSystem } from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';

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
function cuesOverSwing(jobType: number, atomicId: number): { tick: number; soundType: number }[] {
  const sim = new Simulation({ seed: 1, content: cueContent() });
  const e: Entity = settlerAt(sim, { jobType });
  sim.world.add(e, CurrentAtomic, {
    atomicId,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: CHOP_LENGTH,
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

  it('fires a cue authored past the clip length once, on the last tick', () => {
    expect(cuesOverSwing(COLLECTOR_JOB, OVERRUN_ATOMIC)).toEqual([{ tick: CHOP_LENGTH, soundType: AXE }]);
  });

  it('sounds a clip a trade inherits from the civilist body', () => {
    expect(cuesOverSwing(COLLECTOR_JOB, CIVILIST_ONLY_ATOMIC)).toEqual([{ tick: 3, soundType: VOICE }]);
  });
});
