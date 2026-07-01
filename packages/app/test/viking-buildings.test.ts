import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  VIKING,
  VIKING_BUILDINGS,
  findVikingBuildings,
  resolveVikingBuilding,
  vikingBuildingById,
  vikingBuildingByTypeId,
} from '../src/viking-buildings.js';

/**
 * The committed viking-building catalog is the single source of truth for name → typeId. This test pins it
 * back to the pipeline's real output (`content/ir.json`) so it cannot silently drift: every catalog entry
 * must match `ir.json`'s building `id` + `kind`, and every catalog typeId must have a viking `buildingBobs`
 * row (a bound bob → "graphics in place"). `content/` is gitignored, so on a checkout without it the test
 * SKIPS — the same "must still boot / test without decoded bytes" stance the app itself takes.
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

const IR_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../content/ir.json');

/** Read + parse ir.json if present; an absent OR malformed file degrades to null (skip), never crashing the file. */
function loadIr(): Ir | null {
  if (!existsSync(IR_PATH)) return null;
  try {
    return JSON.parse(readFileSync(IR_PATH, 'utf8')) as Ir;
  } catch {
    return null;
  }
}
const ir = loadIr();

describe('viking building catalog', () => {
  it('has a unique typeId and id per entry', () => {
    expect(new Set(VIKING_BUILDINGS.map((b) => b.typeId)).size).toBe(VIKING_BUILDINGS.length);
    expect(new Set(VIKING_BUILDINGS.map((b) => b.id)).size).toBe(VIKING_BUILDINGS.length);
  });

  it.runIf(ir !== null)('matches ir.json building id + kind for every entry', () => {
    const byTypeId = new Map((ir as Ir).buildings.map((b) => [b.typeId, b]));
    for (const cat of VIKING_BUILDINGS) {
      const real = byTypeId.get(cat.typeId);
      expect(real, `typeId ${cat.typeId} (${cat.id}) missing from ir.json`).toBeDefined();
      expect(real?.id, `id for typeId ${cat.typeId}`).toBe(cat.id);
      expect(real?.kind, `kind for ${cat.id}`).toBe(cat.kind);
    }
  });

  it.runIf(ir !== null)('every catalog typeId has a bound viking bob (graphics in place)', () => {
    const boundTypeIds = new Set(
      (ir as Ir).buildingBobs.filter((r) => r.tribeId === VIKING).map((r) => r.typeId),
    );
    for (const cat of VIKING_BUILDINGS) {
      expect(boundTypeIds.has(cat.typeId), `${cat.id} (typeId ${cat.typeId}) has no buildingBobs row`).toBe(
        true,
      );
    }
  });
});

describe('viking building lookups', () => {
  it('resolves a building by its exact id and typeId', () => {
    expect(vikingBuildingById('stock_02')?.typeId).toBe(9);
    expect(vikingBuildingByTypeId(9)?.id).toBe('stock_02');
    expect(vikingBuildingById('does_not_exist')).toBeUndefined();
  });

  it('finds buildings by a fuzzy id/label query (the "warehouse level 2" use case)', () => {
    // The label carries the human synonym ("Warehouse"), so a search the game/user would type resolves the
    // three stocks even though the machine ids say "stock_*".
    const warehouses = findVikingBuildings('warehouse');
    expect(warehouses.map((b) => b.id)).toEqual(['stock_00', 'stock_01', 'stock_02']);
    expect(findVikingBuildings('temple').map((b) => b.typeId)).toEqual([37]);
  });

  it('resolves by id or typeId and throws on an unknown ref', () => {
    expect(resolveVikingBuilding('headquarters').typeId).toBe(1);
    expect(resolveVikingBuilding(1).id).toBe('headquarters');
    expect(() => resolveVikingBuilding('nope')).toThrow();
    expect(() => resolveVikingBuilding(999)).toThrow();
  });
});
