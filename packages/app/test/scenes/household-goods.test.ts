import { isIndoorSettler } from '@open-northland/render/data';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_WOMAN } from '../../src/catalog/jobs.js';
import { BUILDING_DRUID_HUT } from '../../src/game/sandbox/ids/index.js';
import { householdGoodsScene } from '../../src/scenes/household-goods.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(householdGoodsScene, import.meta.url);

describe('household goods wedding', () => {
  it('lets the druid finish the current oil batch, then brings him outdoors for the kiss', () => {
    const sim = createSceneSim(householdGoodsScene);
    const {
      Building,
      CurrentAtomic,
      JobAssignment,
      Marriage,
      Production,
      Resting,
      Settler,
      Stockpile,
      Wedding,
    } = components;
    const hut = [...sim.world.query(Building)].find(
      (e) => sim.world.get(e, Building).buildingType === BUILDING_DRUID_HUT,
    );
    const druid = [...sim.world.query(JobAssignment)].find(
      (e) => sim.world.get(e, JobAssignment).workplace === hut,
    );
    const woman = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === JOB_WOMAN);
    if (hut === undefined || druid === undefined || woman === undefined) throw new Error('scene setup');
    expect(sim.world.get(druid, JobAssignment).workplace).toBe(hut);
    const oil = sim.content.goods.find((good) => good.id === 'holy_oil')?.typeId;
    if (oil === undefined) throw new Error('holy oil missing');

    for (let i = 0; i < 300 && sim.world.tryGet(druid, CurrentAtomic)?.effect.kind !== 'produce'; i++)
      sim.step();
    const batch = sim.world.tryGet(hut, Production)?.cycles[0];
    expect(batch).toBeDefined();
    expect(sim.world.tryGet(druid, CurrentAtomic)?.effect.kind).toBe('produce');
    expect(sim.world.get(druid, Resting).at).toBe(hut);
    const elapsed = batch?.elapsed ?? 0;
    expect(sim.world.get(hut, Stockpile).amounts.get(oil) ?? 0).toBe(0);

    sim.enqueueSetup({ kind: 'marry', entity: woman });
    sim.step();
    expect(sim.world.get(druid, Wedding).partner).toBe(woman);
    expect(sim.world.tryGet(druid, CurrentAtomic)?.effect.kind).toBe('produce');
    expect(sim.world.get(druid, Resting).at).toBe(hut);
    expect(sim.world.get(hut, Production).cycles[0]?.elapsed).toBe(elapsed + 1);

    let sawKiss = false;
    for (let i = 0; i < 600; i++) {
      sim.step();
      if (sim.world.tryGet(druid, Wedding)?.kissing !== true) continue;
      expect(sim.world.has(druid, Resting)).toBe(false);
      expect(sim.world.has(woman, Resting)).toBe(false);
      expect(sim.world.get(hut, Stockpile).amounts.get(oil) ?? 0).toBeGreaterThan(0);
      const snapshot = sim.snapshot();
      const groom = snapshot.entities.find((entity) => entity.id === druid);
      if (groom === undefined) throw new Error('groom missing');
      expect(isIndoorSettler(snapshot, groom.components)).toBe(false);
      sawKiss = true;
      break;
    }
    expect(sawKiss).toBe(true);
    for (let i = 0; i < 600 && !sim.world.has(druid, Marriage); i++) sim.step();
    expect(sim.world.get(druid, Marriage).spouse).toBe(woman);
  });
});
