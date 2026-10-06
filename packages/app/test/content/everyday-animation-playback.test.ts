import {
  buildSpriteScene,
  resolveSettlerBobId,
  type SettlerStateBinding,
  subClipKey,
} from '@open-northland/render';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_BABY_FEMALE, JOB_BABY_MALE, JOB_DRUID, JOB_FISHER } from '../../src/catalog/jobs.js';
import { inHouseProgramLookup } from '../../src/content/ir/joins.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { everydayGesturesScene } from '../../src/scenes/everyday-gestures.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { characterTablesUnderTest, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

describe.runIf(hasRealIr())('everyday animation playback', () => {
  const table = characterTablesUnderTest([1])?.get(1);
  if (table === undefined) return;

  it('plays each baby pose as an occasional idle gesture and stops it on movement', () => {
    for (const job of [JOB_BABY_FEMALE, JOB_BABY_MALE]) {
      const binding = table.youngByJob?.[job]?.binding;
      if (binding === undefined) throw new Error('missing baby look');
      expect(binding.idleFidgets?.map((clip) => clip.start)).toContain(146);
      const frames = new Set<number>();
      for (let facing = 0; facing < 8; facing++) {
        for (let tick = 0; tick < 900; tick++) {
          const item = { kind: 'settler', ref: 1, x: 0, y: 0, depth: 0, facing, state: 'idle' } as const;
          const bob = resolveSettlerBobId(binding, item, tick, tick, tick);
          if (bob >= 146 && bob < 185) {
            frames.add(bob);
            expect(resolveSettlerBobId(binding, { ...item, state: 'moving' }, tick)).toBeLessThan(104);
          }
        }
      }
      expect([...frames].sort((a, b) => a - b)).toEqual(Array.from({ length: 39 }, (_, i) => 146 + i));
    }
  });

  it('reaches brewing, rod walking and baby gestures from ordinary simulation state', async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(everydayGesturesScene, { content: merge.content });
    const lookup = inHouseProgramLookup(rawIrUnderTest() as ContentIr, sim.content.goods);
    const druid = table.byJob[JOB_DRUID]?.binding;
    expect(druid?.bySubClip?.[subClipKey(4, 0)]).toMatchObject({ start: 661 });
    expect(table.byJob[JOB_FISHER]?.binding.moving).toMatchObject({ start: 959, dirs: 8, stride: 12 });
    const reached = new Set<string>();
    const brewingFrames = new Set<number>();
    for (let tick = 0; tick < 900; tick++) {
      sim.step();
      const jobs = new Map<number, number | null>(
        [...sim.world.query(components.Settler)].map((e) => [
          e,
          sim.world.get(e, components.Settler).jobType,
        ]),
      );
      const scene = buildSpriteScene(sim.snapshot(), { inHousePrograms: lookup });
      for (const item of scene) {
        if (item.kind !== 'settler') continue;
        const job = jobs.get(item.ref);
        let binding: SettlerStateBinding | undefined;
        if (job === JOB_BABY_FEMALE || job === JOB_BABY_MALE) binding = table.youngByJob?.[job]?.binding;
        else if (job === JOB_DRUID || job === JOB_FISHER) binding = table.byJob[job]?.binding;
        if (binding === undefined) continue;
        const bob = resolveSettlerBobId(binding, item, sim.tick, sim.tick, tick);
        if (job === JOB_DRUID && item.craftClip !== undefined && bob >= 661 && bob < 677) {
          reached.add('brewing');
          brewingFrames.add(bob);
        }
        if (job === JOB_FISHER && item.state === 'moving') {
          if (!item.carrying && bob >= 959 && bob < 1055) reached.add('rod walk');
          if (item.carrying) {
            expect(bob < 959 || bob >= 1055).toBe(true);
            reached.add('carrying catch');
          }
        }
        if ((job === JOB_BABY_FEMALE || job === JOB_BABY_MALE) && bob >= 146 && bob < 185)
          reached.add('baby gesture');
      }
    }
    expect([...brewingFrames].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => 661 + i));
    expect(reached).toEqual(new Set(['brewing', 'rod walk', 'carrying catch', 'baby gesture']));
  });
});
