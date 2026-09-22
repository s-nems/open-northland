import type { CustomGoodManifest } from '@open-northland/art-contracts/custom';
import type { SpriteAtlas, SpriteBindings, StockpileBinding } from '@open-northland/render';
import type { GoodRef } from '../../content/settler-gfx/index.js';

export { type CustomGoodManifest, customGoodManifest } from '@open-northland/art-contracts/custom';

export function customGoodAtlas(m: CustomGoodManifest): SpriteAtlas {
  return {
    width: m.width,
    height: m.height,
    frames: new Map(
      m.frames.map((f, i) => [
        i,
        {
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          offsetX: -f.anchor.x,
          offsetY: -f.anchor.y,
        },
      ]),
    ),
  };
}

export function customGoodBindings(
  fallback: SpriteBindings['stockpile'],
  goods: readonly GoodRef[],
  manifests: readonly CustomGoodManifest[],
): StockpileBinding {
  const base: StockpileBinding =
    typeof fallback === 'object' ? fallback : { byGood: {}, flag: [fallback ?? 0], default: fallback ?? 0 };
  const byGood = { ...base.byGood };
  const ids = new Set<string>();
  for (const m of manifests) {
    if (ids.has(m.id)) throw new Error(`Duplicate custom good: ${m.id}`);
    ids.add(m.id);
    const good = goods.find((g) => g.id === m.id);
    if (good)
      byGood[good.typeId] = Array.from({ length: 5 }, (_, bob) => ({ layer: `custom-good-${m.id}`, bob }));
  }
  return { ...base, byGood };
}
