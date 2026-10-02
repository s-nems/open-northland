import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Age,
  addCurrentAtomic,
  Building,
  Position,
  Residence,
  Resting,
  setSettlerJob,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, positionOfNode, Simulation } from '../../src/index.js';
import { atomicSystem, CHILD_MALE, interactionNode, needBar } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, nextTickCtxOf } from '../fixtures/context.js';
import { needsOf } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { grassMap, needsSettlerAt } from './needs/support.js';

/**
 * The clip-event rules: a settler's bars move by what the animation it is playing says
 * (`atomicanimations.ini` `event <at> <channel> <delta>`), scaled by where it stands.
 *
 * Fixture vocabulary: the chop (atomic 24, "viking_chop", 3 ticks) spends `-10` on the rest and food
 * channels both; the meal (atomic 10, "viking_eat", 5 ticks) pays `+4000` on the food channel. The
 * woodcutter (job 1) is a trade that goes home; the soldier (job 31) is one `jobtypes.ini` marks
 * `ignoresHomeHouseFlag`. The nap (atomic 8, "viking_sleep", 6 ticks) pulses `+4000` twice.
 */

const SOLDIER = 31;
const CHOP_ATOMIC = 24;
const CHOP_CLIP_TICKS = 3;
const EAT_ATOMIC = 10;
const EAT_CLIP_TICKS = 5;
const SLEEP_ATOMIC = 8;
const SLEEP_CLIP_TICKS = 6;
const SWING_DRAIN = 10;
const MEAL = 4000;
const NAP = 8000;
/** What being at home multiplies a meal by. */
const AT_HOME_FACTOR = 2;

/** A house type with its door one half-cell node east of its anchor, so the doorstep is not the anchor. */
const HOUSE_TYPE = 97;
const HOUSE_ANCHOR = { hx: 10, hy: 10 } as const;
const HOUSE_DOOR = { dx: 1, dy: 0 } as const;
/** A node clear of the house and its door. */
const FIELD_NODE = { hx: 20, hy: 10 } as const;

/** Run `atomicId` to completion on `e` and nothing else, so only the clip's own events move its bars. */
function playClip(sim: Simulation, e: Entity, atomicId: number, ticks: number): void {
  addCurrentAtomic(sim.world, e, {
    atomicId,
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
  for (let i = 0; i < ticks; i++) atomicSystem(sim.world, nextTickCtxOf(sim));
}

/** Test content plus {@link HOUSE_TYPE}. */
function houseContent() {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: HOUSE_TYPE,
        id: 'need_events_house',
        kind: 'home',
        homeSize: 1,
        footprint: { blocked: [{ dx: 0, dy: 0 }], door: HOUSE_DOOR },
      },
    ],
  });
}

/** A finished house of {@link HOUSE_TYPE} at {@link HOUSE_ANCHOR}, and the node its door stands on. */
function houseAt(sim: Simulation): { house: Entity; door: { x: Fixed; y: Fixed } } {
  const house = sim.world.create();
  sim.world.add(house, Position, positionOfNode(HOUSE_ANCHOR.hx, HOUSE_ANCHOR.hy));
  sim.world.add(house, Building, { buildingType: HOUSE_TYPE, tribe: 1, built: ONE, level: 0 });
  const node = interactionNode(sim.world, ctxOf(sim), house);
  if (node === null) throw new Error('house has no door node');
  expect(node).toEqual({ x: HOUSE_ANCHOR.hx + HOUSE_DOOR.dx, y: HOUSE_ANCHOR.hy });
  return { house, door: positionOfNode(node.x, node.y) };
}

/** A woodcutter standing at `at` with the given needs, living in `home` when one is given. */
function residentAt(
  sim: Simulation,
  at: { x: Fixed; y: Fixed },
  needs: { hunger?: Fixed; fatigue?: Fixed },
  home?: Entity,
  jobType?: number,
): Entity {
  const e = needsSettlerAt(sim, 0, 0, needs, jobType);
  const p = sim.world.mut(e, Position);
  p.x = at.x;
  p.y = at.y;
  if (home !== undefined) sim.world.add(e, Residence, { home });
  return e;
}

describe('atomic need events - away from home', () => {
  it('halves the rest a work swing costs a trade that goes home, but not its food', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = needsSettlerAt(sim, 0, 0, {});

    playClip(sim, settler, CHOP_ATOMIC, CHOP_CLIP_TICKS);

    const s = needsOf(sim, settler);
    expect(s.fatigue).toBe(needBar(Math.trunc(SWING_DRAIN / 2)));
    expect(s.hunger).toBe(needBar(SWING_DRAIN));
  });

  it('charges a trade that never goes home the whole swing', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const soldier = needsSettlerAt(sim, 0, 0, {}, SOLDIER);

    playClip(sim, soldier, CHOP_ATOMIC, CHOP_CLIP_TICKS);

    const s = needsOf(sim, soldier);
    expect(s.fatigue).toBe(needBar(SWING_DRAIN));
    expect(s.hunger).toBe(needBar(SWING_DRAIN));
  });

  it('gives a trade with a house to go back to half the rest it sleeps off in the open', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const housed = needsSettlerAt(sim, 0, 0, { fatigue: fx.fromInt(1) });
    const homeless = needsSettlerAt(sim, 1, 0, { fatigue: fx.fromInt(1) }, SOLDIER);

    playClip(sim, housed, SLEEP_ATOMIC, SLEEP_CLIP_TICKS);
    playClip(sim, homeless, SLEEP_ATOMIC, SLEEP_CLIP_TICKS);

    // The clip pulses `+4000` twice; the soldier never goes home, so he keeps both in full.
    expect(needsOf(sim, housed).fatigue).toBe(fx.sub(fx.fromInt(1), needBar(NAP / 2)));
    expect(needsOf(sim, homeless).fatigue).toBe(fx.sub(fx.fromInt(1), needBar(NAP)));
  });

  it('pays a field meal what its clip says', () => {
    const sim = new Simulation({ seed: 1, content: houseContent(), map: grassNodeMap(32, 20) });
    const { house } = houseAt(sim);
    const settler = residentAt(sim, positionOfNode(FIELD_NODE.hx, FIELD_NODE.hy), { hunger: ONE }, house);

    playClip(sim, settler, EAT_ATOMIC, EAT_CLIP_TICKS);

    expect(needsOf(sim, settler).hunger).toBe(fx.sub(ONE, needBar(MEAL)));
  });

  it('moves no bar at all on a settler that is still growing', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const child = needsSettlerAt(sim, 0, 0, {});
    setSettlerJob(sim.world, child, CHILD_MALE);
    sim.world.add(child, Age, { ticks: 0, asOf: null });

    playClip(sim, child, CHOP_ATOMIC, CHOP_CLIP_TICKS);

    const s = needsOf(sim, child);
    expect(s.hunger).toBe(fx.fromInt(0));
    expect(s.fatigue).toBe(fx.fromInt(0));
  });
});

describe('atomic need events - at the settler own home', () => {
  it('doubles a larder meal eaten on its own doorstep, the clip itself unchanged', () => {
    const sim = new Simulation({ seed: 1, content: houseContent(), map: grassNodeMap(32, 20) });
    const { house, door } = houseAt(sim);
    const resident = residentAt(sim, door, { hunger: ONE }, house);
    // A neighbour on the same doorstep eats at someone else's house.
    const visitor = residentAt(sim, door, { hunger: ONE });

    playClip(sim, resident, EAT_ATOMIC, EAT_CLIP_TICKS);
    playClip(sim, visitor, EAT_ATOMIC, EAT_CLIP_TICKS);

    expect(needsOf(sim, resident).hunger).toBe(fx.sub(ONE, needBar(MEAL * AT_HOME_FACTOR)));
    expect(needsOf(sim, visitor).hunger).toBe(fx.sub(ONE, needBar(MEAL)));
  });

  it('doubles a meal indoors too', () => {
    const sim = new Simulation({ seed: 1, content: houseContent(), map: grassNodeMap(32, 20) });
    const { house, door } = houseAt(sim);
    const resident = residentAt(sim, door, { hunger: ONE }, house);
    sim.world.add(resident, Resting, { at: house });

    playClip(sim, resident, EAT_ATOMIC, EAT_CLIP_TICKS);

    expect(needsOf(sim, resident).hunger).toBe(fx.sub(ONE, needBar(MEAL * AT_HOME_FACTOR)));
  });

  it('counts the whole nap at home, and doubles nothing without furniture', () => {
    const sim = new Simulation({ seed: 1, content: houseContent(), map: grassNodeMap(32, 20) });
    const { house, door } = houseAt(sim);
    const resident = residentAt(sim, door, { fatigue: ONE }, house);
    sim.world.add(resident, Resting, { at: house });

    playClip(sim, resident, SLEEP_ATOMIC, SLEEP_CLIP_TICKS);

    expect(needsOf(sim, resident).fatigue).toBe(fx.sub(ONE, needBar(NAP)));
  });
});
