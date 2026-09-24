import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { atlasFromManifest } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import {
  buildVehicleBinding,
  type DrawableFrames,
  vehicleAtlasStems,
  vehicleGraphicsRows,
} from '../../src/content/vehicle-gfx/index.js';
import { contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';

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
      const path = resolve(bobs, `${stem}.atlas.json`);
      if (!existsSync(path)) return [];
      loaded.add(stem);
      const atlas = atlasFromManifest(JSON.parse(readFileSync(path, 'utf8')));
      const drawable = new Set<number>();
      for (const [id, f] of atlas.frames) if (f.width > 0 && f.height > 0) drawable.add(id);
      return [[stem, drawable] as const];
    }),
  );
  const binding = buildVehicleBinding(rows, loaded, frames, VIKING);

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

  it('stands the byzantine ox cart while moving, and fires the viking catapult on the 48-tick clip', () => {
    expect(binding?.byTribe[BYZANTINE]?.[OXCART]?.moving).toBeUndefined();
    expect(binding?.byTribe[VIKING]?.[CATAPULT]?.attack).toBeDefined();
    expect(binding?.byTribe[EGYPT]).toBeUndefined();
    expect(binding?.fallbackTribe).toBe(VIKING);
  });
});
