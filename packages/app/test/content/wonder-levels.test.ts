import { describe, expect, it } from 'vitest';
import { WONDER_TRIBE, WONDERS } from '../../src/catalog/wonders.js';
import { hasRealIr, rawIrUnderTest } from './helpers.js';

interface WonderIr {
  readonly buildings: readonly { readonly typeId: number; readonly id: string; readonly kind: string }[];
  readonly buildingBobs: readonly {
    readonly tribeId: number;
    readonly typeId: number;
    readonly level: number;
  }[];
}

describe.runIf(hasRealIr())('the committed wonder table', () => {
  it('names every wonder the IR defines with the levels its records draw', () => {
    const ir = rawIrUnderTest() as WonderIr;
    const fromIr = ir.buildings
      .filter((b) => b.kind === 'wonder')
      .map(({ typeId, id }) => {
        const rows = ir.buildingBobs.filter((r) => r.typeId === typeId && r.tribeId === WONDER_TRIBE);
        return { typeId, id, levels: new Set(rows.map((r) => r.level)).size };
      });
    expect(fromIr).toEqual(WONDERS);
  });
});
