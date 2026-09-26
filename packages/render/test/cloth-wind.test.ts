import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { type ClothIndexRanges, sailWind } from '../src/gpu/cloth-wind.js';
import { resolveLayers } from '../src/gpu/sprite-pool/resolve-layers.js';
import type { SpriteSheet } from '../src/gpu/sprite-sheet.js';

const SAIL: ClothIndexRanges = [104, 111, 128, 159];
const TAU = Math.PI * 2;

describe('sailWind', () => {
  it('blows harder under sail than standing at sea, through the same cloth', () => {
    const sailing = sailWind(SAIL, 5, 10, 20, true);
    const standing = sailWind(SAIL, 5, 10, 20, false);
    expect(sailing.displacementPx).toBeGreaterThan(standing.displacementPx);
    expect(sailing.shadeDepth).toBeGreaterThan(standing.shadeDepth);
    expect(standing.displacementPx).toBeGreaterThan(0);
    expect(sailing.ranges).toBe(SAIL);
  });

  it('advances its phase every tick inside one turn, and phases two ships apart by their anchors', () => {
    const phases = Array.from({ length: 40 }, (_, tick) => sailWind(SAIL, tick, 0, 0, true).phase);
    for (const phase of phases) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(TAU);
    }
    expect(new Set(phases).size).toBeGreaterThan(1);
    expect(sailWind(SAIL, 7, 0, 0, true).phase).not.toBe(sailWind(SAIL, 7, 300, 120, true).phase);
  });
});

describe('the wind in a drawn ship', () => {
  const VIKING = 1;
  const SHIP = 3;
  const source = Texture.WHITE.source;
  const frame = { x: 0, y: 0, width: 8, height: 8, offsetX: -4, offsetY: -7 };
  const atlas = { width: 8, height: 8, frames: new Map([[0, frame]]) };
  const hull = { start: 0, frameLists: Array.from({ length: 8 }, () => [0]), loop: true };
  const sheetOf = (
    indexed: boolean,
    sailRanges: Record<string, ClothIndexRanges> = { ship: SAIL },
  ): SpriteSheet => ({
    source,
    atlas,
    bindings: {
      settler: 0,
      building: 0,
      resource: 0,
      vehicle: {
        byTribe: { [VIKING]: { [SHIP]: { layer: 'ship', idle: hull, afloat: true, indexed } } },
        fallbackTribe: VIKING,
      },
    },
    families: { ship: { source, atlas, shadow: { source, atlas } } },
    vehiclePalette: { source, colours: 10, sailRanges },
  });
  const ship = { kind: 'vehicle' as const, ref: 1, x: 30, y: 50, depth: 0, tribe: VIKING, typeId: SHIP };

  it('ripples the set sail of an indexed hull and leaves its shadow alone', () => {
    const [shadow, body] = resolveLayers(sheetOf(true), ship, 9) ?? [];
    expect(body?.cloth).toEqual(sailWind(SAIL, 9, ship.x, ship.y, false));
    expect(resolveLayers(sheetOf(true), { ...ship, state: 'moving' }, 9)?.[1]?.cloth).toEqual(
      sailWind(SAIL, 9, ship.x, ship.y, true),
    );
    expect(shadow?.shadow).toBe(true);
    expect(shadow?.cloth).toBeUndefined();
  });

  it('draws a moored ship, a fog ghost, a baked hull and an atlas with no sail ranges rigid', () => {
    expect(resolveLayers(sheetOf(true), { ...ship, moored: true }, 9)?.[1]?.cloth).toBeUndefined();
    expect(resolveLayers(sheetOf(true), { ...ship, ghost: true }, 9)?.[1]?.cloth).toBeUndefined();
    expect(resolveLayers(sheetOf(false), ship, 9)?.[1]?.cloth).toBeUndefined();
    expect(resolveLayers(sheetOf(true, { other: SAIL }), ship, 9)?.[1]?.cloth).toBeUndefined();
  });
});
