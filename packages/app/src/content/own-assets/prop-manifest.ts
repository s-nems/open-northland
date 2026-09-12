import type { OwnPropManifest } from '@open-northland/art-contracts';
import type { ContentIr } from '../ir/rows.js';

export { type OwnPropManifest, ownPropManifest } from '@open-northland/art-contracts';

import type { ResourceTypeBinding, SpriteAtlas, SpriteBindings } from '@open-northland/render';

export function ownPropAtlas(m: OwnPropManifest): SpriteAtlas {
  if (m.frames)
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
  return {
    width: m.width,
    height: m.height,
    frames: new Map([
      [
        0,
        {
          x: 0,
          y: 0,
          width: m.width,
          height: m.height,
          offsetX: -m.anchor.x,
          offsetY: -m.anchor.y,
        },
      ],
    ]),
  };
}

/** How far above its feet a prop paints, in world px: its tallest frame's anchor height at the manifest
 *  scale. */
export function ownPropPaintedHeight(m: OwnPropManifest): number {
  const anchorY = m.frames === undefined ? m.anchor.y : Math.max(...m.frames.map((f) => f.anchor.y));
  return anchorY * m.scale;
}

export function ownPropFrameIndex(level: number | undefined, count: number): number {
  return level !== undefined && Number.isInteger(level) && level >= 1 && level <= count
    ? level - 1
    : count - 1;
}

export function ownPropNames(manifests: readonly OwnPropManifest[]): ReadonlyMap<string, OwnPropManifest> {
  const names = new Map<string, OwnPropManifest>();
  const ids = new Set<string>();
  for (const m of manifests) {
    if (ids.has(m.id)) throw new Error(`Duplicate own prop id: ${m.id}`);
    ids.add(m.id);
    for (const name of m.editNames) {
      if (names.has(name)) throw new Error(`Duplicate own prop name: ${name}`);
      names.set(name, m);
    }
  }
  return names;
}

export function ownPropResourceBinding(
  fallback: SpriteBindings['resource'],
  ir: ContentIr | null,
  manifests: readonly OwnPropManifest[],
): ResourceTypeBinding {
  const base = typeof fallback === 'number' ? { default: fallback, byGood: {} } : fallback;
  const byGfxIndex = { ...base.byGfxIndex };
  const names = ownPropNames(manifests);
  for (const row of ir?.landscapeGfx ?? []) {
    const m = row.editName === undefined ? undefined : names.get(row.editName);
    if (m?.kind === 'resource')
      byGfxIndex[row.index] = Array.from({ length: m.frames?.length ?? 1 }, (_, bob) => ({
        layer: `own-prop-${m.id}`,
        bob,
      }));
  }
  return { ...base, byGfxIndex };
}

export function ownPropStumpBinding(
  fallback: SpriteBindings['stump'],
  manifests: readonly OwnPropManifest[],
): SpriteBindings['stump'] {
  const stumps = manifests.filter((m) => m.kind === 'stump');
  if (stumps.length > 1) throw new Error('Multiple own stump bindings');
  const stump = stumps[0];
  return stump === undefined ? fallback : { byGood: {}, default: { layer: `own-prop-${stump.id}`, bob: 0 } };
}
