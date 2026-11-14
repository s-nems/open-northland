import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ATTACK_ATOMIC } from '../../../src/catalog/atomics.js';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import {
  buildVehicleBinding,
  type DrawableFrames,
  vehicleAtlasStems,
  vehicleAttackClipTicks,
  vehicleGraphicsRows,
} from '../../../src/content/vehicle-gfx/index.js';
import {
  contentDir,
  hasRealIr,
  loadContentUnderTest,
  rawIrUnderTest,
  servedAtlasManifest,
} from '../helpers.js';

/**
 * The shipped `vehicleGraphics` rows over the REAL baked atlases: every row binds a look, and the data
 * holes docs/formats/VEHICLES.md names resolve the way the renderer expects (the viking big ship sails
 * on its empty hull, the byzantine carts stand while moving, Egypt draws viking vehicles).
 */

const VIKING = 1;
const BYZANTINE = 3;
const EGYPT = 7;
const OXCART = 2;
const SHIP_BIG = 4;
const CATAPULT = 5;

describe.runIf(hasRealIr())('the vehicle looks over the decoded content', () => {
  const ir = rawIrUnderTest() as ContentIr;
  const bobs = resolve(contentDir(), 'bobs');
  if (!existsSync(bobs)) return;

  const rows = vehicleGraphicsRows(ir);
  const { stems } = vehicleAtlasStems(rows);
  const loaded = new Set<string>();
  const frames: DrawableFrames = new Map(
    [...stems].flatMap((stem) => {
      const manifest = servedAtlasManifest(stem);
      if (manifest === undefined) return [];
      loaded.add(stem);
      const drawable = new Set<number>();
      for (const { bobId, rect } of manifest.frames)
        if (rect.width > 0 && rect.height > 0) drawable.add(bobId);
      return [[stem, drawable] as const];
    }),
  );
  const binding = buildVehicleBinding(rows, loaded, frames, VIKING, {
    attackTicks: vehicleAttackClipTicks(ir),
  });

  it('binds a look for every row that authors a wait or a drive', () => {
    expect(binding).toBeDefined();
    for (const row of rows) {
      const authored = row.clips.length > 0 || row.gaits.length > 0;
      expect(
        binding?.byTribe[row.tribe]?.[row.vehicleType] !== undefined,
        `${row.tribe}/${row.vehicleType}`,
      ).toBe(authored);
    }
  });

  it('sails the viking big ship on its empty hull, its loaded hull having no baked frames', () => {
    const look = binding?.byTribe[VIKING]?.[SHIP_BIG];
    expect(look?.layer).toBe('ve_test_ship.human_ship01');
    expect(look?.moving).toBeDefined();
    expect(look?.loadedMoving).toBeUndefined();
  });

  it('drives the byzantine ox cart on the viking drive, and fires the viking catapult', () => {
    expect(binding?.byTribe[BYZANTINE]?.[OXCART]?.moving).toBe(binding?.byTribe[VIKING]?.[OXCART]?.moving);
    expect(binding?.byTribe[VIKING]?.[CATAPULT]?.attack).toBeDefined();
    expect(binding?.byTribe[EGYPT]).toBeUndefined();
    expect(binding?.fallbackTribe).toBe(VIKING);
  });

  it('plays each shot over the attack clip the simulation times that shot by', async () => {
    const { real } = await loadContentUnderTest();
    const shooting = rows.filter(
      (row) => binding?.byTribe[row.tribe]?.[row.vehicleType]?.attack !== undefined,
    );
    expect(shooting.length).toBeGreaterThan(0);
    for (const row of shooting) {
      const clip = systems.atomicDuration(real, { tribe: row.tribe, jobType: row.job }, ATTACK_ATOMIC);
      const attack = binding?.byTribe[row.tribe]?.[row.vehicleType]?.attack;
      const ticks = typeof attack === 'object' && 'ticks' in attack ? attack.ticks : undefined;
      expect(ticks, `${row.tribe}/${row.vehicleType}`).toBe(clip);
    }
  });
});
