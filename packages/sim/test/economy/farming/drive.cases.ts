import { describe, expect, it } from 'vitest';
import * as components from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, fx, positionOfNode, Simulation } from '../../../src/index.js';
import { plannerSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  Carrying,
  Crop,
  ctxOf,
  FARMER,
  FIELD_CAP,
  farmAt,
  farmerAt,
  fieldAt,
  GroundDrop,
  grassMap,
  PICKUP_ATOMIC,
  Position,
  plotAtCap,
  REAP_ATOMIC,
  RING_AROUND_FARM,
  Settler,
  SOW_ATOMIC,
  STAGES,
  Stockpile,
  VIKING,
  WATER_ATOMIC,
  WHEAT,
} from './support.js';

/** The grafted fixture farmer-wheat track id (the base fixture carries no farmer track at all). */
const FARMER_WHEAT_TRACK = 90;

/** The fixture plus a farmer-wheat track (rate 1) pinning `strokes` per reaped field. */
function contentWithStrokes(strokes: number): ReturnType<typeof testContent> {
  const base = testContent();
  return {
    ...base,
    jobExperience: [
      ...base.jobExperience,
      {
        typeId: FARMER_WHEAT_TRACK,
        id: 'farmer_wheat',
        name: 'farmer wheat',
        jobType: FARMER,
        goodType: WHEAT,
        experienceFactor: 1,
        baseRepeatCounter: strokes,
      },
    ],
  };
}

describe('planFarmer - the drive ladder', () => {
  it('sows: an idle bound farmer with no fields starts the plant atomic (or walks to the node)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    const farmer = farmerAt(sim, 4, 4, farm);

    plannerSystem(sim.world, ctxOf(sim));

    // The nearest jittered-lattice node may or may not be underfoot - either it walks or it sows.
    const atomic = sim.world.tryGet(farmer, components.CurrentAtomic);
    const goal = sim.world.tryGet(farmer, components.MoveGoal);
    expect(atomic?.atomicId === SOW_ATOMIC || goal !== undefined).toBe(true);
  });

  it('a farmer keeps the sow spot it set out for: arriving there sows instead of drawing a fresh one', () => {
    // The arrival replan re-picks; without the kept intent it would draw among the five nearest again and
    // walk off four times in five. Four seeds, so a lucky redraw cannot pass this on its own.
    for (const seed of [1, 2, 3, 4]) {
      const sim = new Simulation({ seed, content: testContent(), map: grassMap(8, 8) });
      const farm = farmAt(sim, 4, 4);
      const farmer = farmerAt(sim, 4, 4, farm);
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('scene sim has terrain');
      plannerSystem(sim.world, ctxOf(sim));
      const spot = terrain.coordsOf(sim.world.get(farmer, components.FarmTask).node);
      expect(sim.world.tryGet(farmer, components.MoveGoal)).toBeDefined(); // the store holds the anchor

      // Stand the farmer on its spot with the walk over: the state the arrival replan sees.
      const stand = positionOfNode(spot.x, spot.y);
      const p = sim.world.mut(farmer, Position);
      p.x = stand.x;
      p.y = stand.y;
      sim.world.remove(farmer, components.MoveGoal);
      if (sim.world.has(farmer, components.PathRequest)) sim.world.remove(farmer, components.PathRequest);
      if (sim.world.has(farmer, components.PathFollow)) sim.world.remove(farmer, components.PathFollow);
      plannerSystem(sim.world, ctxOf(sim));

      const atomic = sim.world.get(farmer, components.CurrentAtomic);
      expect(atomic.atomicId, `seed ${seed}`).toBe(SOW_ATOMIC);
      expect(atomic.effect).toMatchObject({ kind: 'sow', x: spot.x, y: spot.y });
    }
  });

  it('sows before reaping while the plot is under its cap - the plot fills before it turns over', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    fieldAt(sim, farm, 4, 4, { stage: STAGES }); // ripe, underfoot - and still not the pick
    const farmer = farmerAt(sim, 4, 4, farm);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(farmer, components.FarmTask).sow).toBe(true);
    expect(sim.world.tryGet(farmer, components.CurrentAtomic)?.atomicId).not.toBe(REAP_ATOMIC);
  });

  it('reaps a ripe field once the plot is at its cap', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const { field, farmer } = plotAtCap(sim, { stage: STAGES });

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(farmer, components.CurrentAtomic);
    expect(atomic.atomicId).toBe(REAP_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'harvest', resource: field, goodType: WHEAT });
  });

  it("the field falls on the stroke that completes the track's count, never earlier", () => {
    // Whether the field still stands after each successive full clip, at `strokes` per field.
    const standsAfterClips = (strokes: number): boolean[] => {
      const sim = new Simulation({ seed: 1, content: contentWithStrokes(strokes), map: grassMap(8, 8) });
      const { field, farmer } = plotAtCap(sim, { stage: STAGES });
      plannerSystem(sim.world, ctxOf(sim));
      const clip = sim.world.get(farmer, components.CurrentAtomic).duration;
      const stands: boolean[] = [];
      for (let swing = 0; swing < 2; swing++) {
        sim.run(clip);
        stands.push(sim.world.has(field, Crop));
      }
      return stands;
    };
    expect(standsAfterClips(1)).toEqual([false, false]);
    expect(standsAfterClips(2)).toEqual([true, false]);
  });

  it('a two-stroke reap re-arms the same clip from zero after its first stroke', () => {
    const sim = new Simulation({ seed: 1, content: contentWithStrokes(2), map: grassMap(8, 8) });
    const { farmer } = plotAtCap(sim, { stage: STAGES });
    plannerSystem(sim.world, ctxOf(sim));
    const clip = sim.world.get(farmer, components.CurrentAtomic).duration;

    sim.run(clip);

    const atomic = sim.world.get(farmer, components.CurrentAtomic);
    expect(atomic.atomicId).toBe(REAP_ATOMIC);
    expect(atomic.elapsed).toBe(0);
    expect(atomic.duration).toBe(clip);
  });

  it('the stroke count never stretches a clip: reap and water last one clip at any count', () => {
    const clipTicks = (strokes: number): { reap: number; water: number } => {
      const reaping = new Simulation({ seed: 1, content: contentWithStrokes(strokes), map: grassMap(8, 8) });
      const reaper = plotAtCap(reaping, { stage: STAGES }).farmer;
      plannerSystem(reaping.world, ctxOf(reaping));
      const watering = new Simulation({ seed: 1, content: contentWithStrokes(strokes), map: grassMap(8, 8) });
      const waterer = plotAtCap(watering, {}).farmer;
      plannerSystem(watering.world, ctxOf(watering));
      return {
        reap: reaping.world.get(reaper, components.CurrentAtomic).duration,
        water: watering.world.get(waterer, components.CurrentAtomic).duration,
      };
    };
    expect(clipTicks(2)).toEqual(clipTicks(1));
  });

  it('a master reaps a two-stroke field in one swing - experience buys fewer strokes, never faster ones', () => {
    const sim = new Simulation({ seed: 1, content: contentWithStrokes(2), map: grassMap(8, 8) });
    const { field, farmer } = plotAtCap(sim, { stage: STAGES });
    sim.world.mut(farmer, Settler).experience.set(FARMER_WHEAT_TRACK, 100); // 100 XP at rate 1 = mastery

    plannerSystem(sim.world, ctxOf(sim));
    sim.run(sim.world.get(farmer, components.CurrentAtomic).duration);

    expect(sim.world.has(field, Crop)).toBe(false);
  });

  it('waters the least-grown field once the plot is at its cap (the can circles between sowings)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    // The sow branch is closed at the cap, so the drive reaches for the can. (Under the cap it sows FIRST -
    // every field below its top stage is thirsty, and a water-first farmer would never expand the plot.)
    const { field, farmer } = plotAtCap(sim, {});

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(farmer, components.CurrentAtomic);
    expect(atomic.atomicId).toBe(WATER_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'water', crop: field });
  });

  it('the can passes a nearer field for a less grown one farther away', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    fieldAt(sim, farm, 4, 4, { stage: 3 }); // underfoot, but ahead
    const laggard = fieldAt(sim, farm, 1, 1, { stage: 2 });
    for (const [x, y] of RING_AROUND_FARM.slice(0, FIELD_CAP - 2)) fieldAt(sim, farm, x, y, { stage: 3 });
    const farmer = farmerAt(sim, 4, 4, farm);

    plannerSystem(sim.world, ctxOf(sim));

    const task = sim.world.get(farmer, components.FarmTask);
    const at = cellAnchorNode(1, 1);
    expect(task.node).toBe(sim.terrain?.nodeAt(at.hx, at.hy));
    expect(sim.world.tryGet(farmer, components.MoveGoal)).toBeDefined(); // walking to the laggard
    expect(sim.world.tryGet(farmer, components.CurrentAtomic)).toBeUndefined();
    expect(sim.world.has(laggard, Crop)).toBe(true);
  });

  it('picks up a cut sheaf lying by the farm before anything else (then the delivery rung routes it home)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    const sheaf = sim.world.create();
    sim.world.add(sheaf, Position, { x: fx.fromInt(4), y: fx.fromInt(4) });
    sim.world.add(sheaf, Stockpile, { amounts: new Map([[WHEAT, 1]]) });
    sim.world.add(sheaf, GroundDrop, { goodType: WHEAT });
    fieldAt(sim, farm, 3, 3, { stage: STAGES }); // a ripe field and an open plot both wait behind the sheaf
    const farmer = farmerAt(sim, 4, 4, farm);

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(farmer, components.CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: WHEAT, from: sheaf });
  });

  it('a farmer carrying wheat delivers it into the farm store (the bound storage sink)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    const farmer = farmerAt(sim, 4, 4, farm);
    sim.world.add(farmer, Carrying, { goodType: WHEAT, amount: 1 });

    plannerSystem(sim.world, ctxOf(sim));
    // Standing on the farm's interaction cell already → the deposit atomic starts at once.
    const atomic = sim.world.get(farmer, components.CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'pileup', store: farm });
  });

  it('never sows past the farm plot cap', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 10) });
    farmerAt(sim, 5, 5, farmAt(sim, 5, 5));
    let peak = 0;
    for (let t = 0; t < 400; t++) {
      sim.run(1);
      peak = Math.max(peak, [...sim.world.query(Crop)].length);
    }
    expect(peak).toBe(FIELD_CAP);
  });

  it("the plot cap is the FARM's, not the crew's: a second farmer does not enlarge it", () => {
    // Measured in the original: a farm holds the same ~24 plants whether one farmer or four work it -
    // extra hands turn the plot over faster, they never widen it. Track the PEAK standing-field count,
    // since the reap-and-resow churn keeps the roster dipping below the cap.
    const peakFields = (crew: number): number => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 12) });
      const farm = farmAt(sim, 6, 6);
      for (let i = 0; i < crew; i++) farmerAt(sim, 6, 6, farm);
      let peak = 0;
      for (let t = 0; t < 400; t++) {
        sim.run(1);
        let fields = 0;
        for (const _e of sim.world.query(Crop)) fields++;
        if (fields > peak) peak = fields;
      }
      return peak;
    };
    expect(peakFields(1)).toBe(FIELD_CAP);
    expect(peakFields(2)).toBe(FIELD_CAP);
  });

  it('a spawned farmer is farm-bound, NOT a flag gatherer (no auto work flag)', () => {
    // The spawn auto-plant (`syncWorkFlagToJob`) flags every job that can harvest a FLAG-GATHERED
    // good; the farmer's only harvestable good is FIELD-FARMED (a `farming` block), so it must stay
    // flagless - a flag would hijack every sheaf delivery to the flag instead of the farm's store.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: FARMER, x: 8, y: 8, tribe: VIKING });
    sim.run(1);
    const spawned = [...sim.world.query(Settler)];
    expect(spawned).toHaveLength(1);
    expect(sim.world.tryGet(spawned[0] as Entity, components.WorkFlag)).toBeUndefined();
  });

  it('a farm still under construction fields no crew (jobtypes.ini mustHaveFinishedWorkHouseFlag 1)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    sim.world.add(farm, components.UnderConstruction, { labor: fx.fromInt(0) });
    const farmer = farmerAt(sim, 4, 4, farm);

    plannerSystem(sim.world, ctxOf(sim));

    // The field loop never engages a foundation: no claim, no sow/water/reap swing.
    expect(sim.world.tryGet(farmer, components.FarmTask)).toBeUndefined();
    const atomic = sim.world.tryGet(farmer, components.CurrentAtomic)?.atomicId;
    expect([SOW_ATOMIC, WATER_ATOMIC, REAP_ATOMIC]).not.toContain(atomic);
    expect([...sim.world.query(Crop)]).toHaveLength(0);
  });
});
