import { describe, expect, it } from 'vitest';
import {
  Age,
  CurrentAtomic,
  Residence,
  Resting,
  Settler,
  setSettlerJob,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, Simulation } from '../../src/index.js';
import { atomicSystem, CHILD_MALE, needBar } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, grassMap, needsSettlerAt } from './needs/support.js';

/**
 * The clip-event rules: a settler's bars move by what the animation it is playing says
 * (`atomicanimations.ini` `event <at> <channel> <delta>`), scaled by where it stands.
 *
 * Fixture vocabulary: the chop (atomic 24, "viking_chop", 3 ticks) spends `-10` on the rest and food
 * channels both; the meal (atomic 10, "viking_eat", 5 ticks) pays `+4000` on the food channel. The
 * woodcutter (job 1) is a trade that goes home; the soldier (job 31) is one `jobtypes.ini` marks
 * `ignoresHomeHouseFlag`. The nap (atomic 8, "viking_sleep", 6 ticks) pulses `+4000` twice, and
 * "viking_eat_home" is the meal's at-home twin, at `+6000`.
 */

const SOLDIER = 31;
const CHOP_ATOMIC = 24;
const CHOP_CLIP_TICKS = 3;
const EAT_ATOMIC = 10;
const EAT_CLIP_TICKS = 5;
const SLEEP_ATOMIC = 8;
const SLEEP_CLIP_TICKS = 6;
const SWING_DRAIN: Fixed = needBar(10);
const MEAL: Fixed = needBar(4000);
/** The at-home twin of the meal clip ("viking_eat_home"), worth half again as much. */
const HOME_MEAL: Fixed = needBar(6000);

/** Run `atomicId` to completion on `e` and nothing else, so only the clip's own events move its bars. */
function playClip(sim: Simulation, e: Entity, atomicId: number, ticks: number): void {
  sim.world.add(e, CurrentAtomic, {
    atomicId,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: ticks,
    effect:
      atomicId === EAT_ATOMIC
        ? ({ kind: 'eat', goodType: 3, from: null } as const)
        : atomicId === SLEEP_ATOMIC
          ? ({ kind: 'sleep' } as const)
          : ({ kind: 'idle' } as const),
    targetEntity: null,
    targetTile: null,
  });
  for (let i = 0; i < ticks; i++) atomicSystem(sim.world, ctxOf(sim));
}

describe('atomic need events - a work swing costs what its clip says', () => {
  it('costs the same in rest and food wherever it is swung', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = needsSettlerAt(sim, 0, 0, {});
    const soldier = needsSettlerAt(sim, 1, 0, {}, SOLDIER);

    playClip(sim, settler, CHOP_ATOMIC, CHOP_CLIP_TICKS);
    playClip(sim, soldier, CHOP_ATOMIC, CHOP_CLIP_TICKS);

    // What the swing spends is never halved - only rest a settler gains in the open is.
    for (const e of [settler, soldier]) {
      const s = sim.world.get(e, Settler);
      expect(s.hunger).toBe(SWING_DRAIN);
      expect(s.fatigue).toBe(SWING_DRAIN);
    }
  });

  it('gives a trade with a house to go back to half the rest it sleeps off in the open', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const housed = needsSettlerAt(sim, 0, 0, { fatigue: fx.fromInt(1) });
    const homeless = needsSettlerAt(sim, 1, 0, { fatigue: fx.fromInt(1) }, SOLDIER);

    playClip(sim, housed, SLEEP_ATOMIC, SLEEP_CLIP_TICKS);
    playClip(sim, homeless, SLEEP_ATOMIC, SLEEP_CLIP_TICKS);

    // The clip pulses `+4000` twice; the soldier never goes home, so he keeps both in full.
    expect(sim.world.get(housed, Settler).fatigue).toBe(fx.sub(fx.fromInt(1), needBar(4000)));
    expect(sim.world.get(homeless, Settler).fatigue).toBe(fx.sub(fx.fromInt(1), needBar(8000)));
  });

  it('moves no bar at all on a settler that is still growing', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const child = needsSettlerAt(sim, 0, 0, {});
    setSettlerJob(sim.world, child, CHILD_MALE);
    sim.world.add(child, Age, { ticks: 0 });

    playClip(sim, child, CHOP_ATOMIC, CHOP_CLIP_TICKS);

    const s = sim.world.get(child, Settler);
    expect(s.hunger).toBe(fx.fromInt(0));
    expect(s.fatigue).toBe(fx.fromInt(0));
  });
});

describe('atomic need events - a meal under the settler own roof', () => {
  it('pays what the at-home twin of the clip says, not what the field one does', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const outdoors = needsSettlerAt(sim, 0, 0, { hunger: fx.fromInt(1) });
    const indoors = needsSettlerAt(sim, 1, 0, { hunger: fx.fromInt(1) });
    const home = sim.world.create();
    sim.world.add(indoors, Residence, { home });
    sim.world.add(indoors, Resting, { at: home });

    playClip(sim, outdoors, EAT_ATOMIC, EAT_CLIP_TICKS);
    playClip(sim, indoors, EAT_ATOMIC, EAT_CLIP_TICKS);

    expect(sim.world.get(outdoors, Settler).hunger).toBe(fx.sub(fx.fromInt(1), MEAL));
    expect(sim.world.get(indoors, Settler).hunger).toBe(fx.sub(fx.fromInt(1), HOME_MEAL));
  });
});
