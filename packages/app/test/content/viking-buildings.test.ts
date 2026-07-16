import { describe, expect, it } from 'vitest';
import { VIKING, VIKING_BUILDINGS } from '../../src/catalog/buildings.js';
import { hasRealIr, rawIrUnderTest } from './helpers.js';

/**
 * Pins the committed viking-building catalog (the single source of truth for name → typeId) back to
 * the pipeline's real output so it cannot silently drift: every catalog entry must match ir.json's
 * building `id` + `kind`, and every catalog typeId must have a viking `buildingBobs` row (a bound
 * bob → "graphics in place"). The catalog's pure lookup tests live with the fixture suite
 * (`test/viking-buildings.test.ts`); this is their real-content half.
 */

interface IrBuilding {
  readonly typeId: number;
  readonly id: string;
  readonly kind: string;
}
interface IrBuildingBob {
  readonly tribeId: number;
  readonly typeId: number;
}
interface Ir {
  readonly buildings: readonly IrBuilding[];
  readonly buildingBobs: readonly IrBuildingBob[];
}

describe.runIf(hasRealIr())('viking building catalog vs real IR', () => {
  it('matches ir.json building id + kind for every entry', () => {
    const ir = rawIrUnderTest() as Ir;
    const byTypeId = new Map(ir.buildings.map((b) => [b.typeId, b]));
    for (const cat of VIKING_BUILDINGS) {
      const real = byTypeId.get(cat.typeId);
      expect(real, `typeId ${cat.typeId} (${cat.id}) missing from ir.json`).toBeDefined();
      expect(real?.id, `id for typeId ${cat.typeId}`).toBe(cat.id);
      expect(real?.kind, `kind for ${cat.id}`).toBe(cat.kind);
    }
  });

  it('every catalog typeId has a bound viking bob (graphics in place)', () => {
    const ir = rawIrUnderTest() as Ir;
    const boundTypeIds = new Set(ir.buildingBobs.filter((r) => r.tribeId === VIKING).map((r) => r.typeId));
    for (const cat of VIKING_BUILDINGS) {
      expect(boundTypeIds.has(cat.typeId), `${cat.id} (typeId ${cat.typeId}) has no buildingBobs row`).toBe(
        true,
      );
    }
  });
});
