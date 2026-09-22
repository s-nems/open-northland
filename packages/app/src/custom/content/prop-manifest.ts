import type { CustomPropManifest } from '@open-northland/art-contracts/custom';
import type { ContentIr } from '../../content/ir/rows.js';

export { type CustomPropManifest, customPropManifest } from '@open-northland/art-contracts/custom';

import type {
  ResourceTypeBinding,
  SpriteAtlas,
  SpriteBindings,
  StockpileBinding,
} from '@open-northland/render';

/** The sprite-sheet family a delivered prop draws from. */
export function customPropLayer(id: string): string {
  return `custom-prop-${id}`;
}

export function customPropAtlas(m: CustomPropManifest): SpriteAtlas {
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
export function customPropPaintedHeight(m: CustomPropManifest): number {
  const anchorY = m.frames === undefined ? m.anchor.y : Math.max(...m.frames.map((f) => f.anchor.y));
  return anchorY * m.scale;
}

export function customPropFrameIndex(level: number | undefined, count: number): number {
  return level !== undefined && Number.isInteger(level) && level >= 1 && level <= count
    ? level - 1
    : count - 1;
}

export function customPropNames(
  manifests: readonly CustomPropManifest[],
): ReadonlyMap<string, CustomPropManifest> {
  const names = new Map<string, CustomPropManifest>();
  const ids = new Set<string>();
  for (const m of manifests) {
    if (ids.has(m.id)) throw new Error(`Duplicate custom prop id: ${m.id}`);
    ids.add(m.id);
    for (const name of m.editNames) {
      if (names.has(name)) throw new Error(`Duplicate custom prop name: ${name}`);
      names.set(name, m);
    }
  }
  return names;
}

export function customPropResourceBinding(
  fallback: SpriteBindings['resource'],
  ir: ContentIr | null,
  manifests: readonly CustomPropManifest[],
): ResourceTypeBinding {
  const base = typeof fallback === 'number' ? { default: fallback, byGood: {} } : fallback;
  const byGfxIndex = { ...base.byGfxIndex };
  const names = customPropNames(manifests);
  for (const row of ir?.landscapeGfx ?? []) {
    const m = row.editName === undefined ? undefined : names.get(row.editName);
    if (m?.kind === 'resource')
      byGfxIndex[row.index] = Array.from({ length: m.frames?.length ?? 1 }, (_, bob) => ({
        layer: customPropLayer(m.id),
        bob,
      }));
  }
  return { ...base, byGfxIndex };
}

/** The stump and the delivery flag each bind one prop; a second delivered one is a packaging error. */
function singlePropOfKind(
  manifests: readonly CustomPropManifest[],
  kind: CustomPropManifest['kind'],
): CustomPropManifest | undefined {
  const [first, ...rest] = manifests.filter((m) => m.kind === kind);
  if (rest.length > 0) throw new Error(`Multiple own ${kind} bindings`);
  return first;
}

/** The delivery flag's wave loop from the one `flag` prop; `fallback` keeps its own loop without one. */
export function customPropFlagBinding(
  fallback: StockpileBinding,
  manifests: readonly CustomPropManifest[],
): StockpileBinding {
  const flag = singlePropOfKind(manifests, 'flag');
  if (flag === undefined) return fallback;
  const layer = customPropLayer(flag.id);
  const rest = Array.from({ length: (flag.frames?.length ?? 1) - 1 }, (_, i) => ({ layer, bob: i + 1 }));
  return { ...fallback, flag: [{ layer, bob: 0 }, ...rest] };
}

export function customPropStumpBinding(
  fallback: SpriteBindings['stump'],
  manifests: readonly CustomPropManifest[],
): SpriteBindings['stump'] {
  const stump = singlePropOfKind(manifests, 'stump');
  return stump === undefined
    ? fallback
    : { byGood: {}, default: { layer: customPropLayer(stump.id), bob: 0 } };
}
