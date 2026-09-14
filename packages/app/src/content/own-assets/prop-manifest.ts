import type { OwnPropManifest } from '@open-northland/art-contracts';
import type { ContentIr } from '../ir/rows.js';

export { type OwnPropManifest, ownPropManifest } from '@open-northland/art-contracts';

import type {
  ResourceTypeBinding,
  SpriteAtlas,
  SpriteBindings,
  StockpileBinding,
} from '@open-northland/render';

/** The sprite-sheet family a delivered prop draws from. */
export function ownPropLayer(id: string): string {
  return `own-prop-${id}`;
}

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
        layer: ownPropLayer(m.id),
        bob,
      }));
  }
  return { ...base, byGfxIndex };
}

/** The stump and the delivery flag each bind one prop; a second delivered one is a packaging error. */
function singlePropOfKind(
  manifests: readonly OwnPropManifest[],
  kind: OwnPropManifest['kind'],
): OwnPropManifest | undefined {
  const [first, ...rest] = manifests.filter((m) => m.kind === kind);
  if (rest.length > 0) throw new Error(`Multiple own ${kind} bindings`);
  return first;
}

/** The delivery flag's wave loop from the one `flag` prop; `fallback` keeps its own loop without one. */
export function ownPropFlagBinding(
  fallback: StockpileBinding,
  manifests: readonly OwnPropManifest[],
): StockpileBinding {
  const flag = singlePropOfKind(manifests, 'flag');
  if (flag === undefined) return fallback;
  const layer = ownPropLayer(flag.id);
  const rest = Array.from({ length: (flag.frames?.length ?? 1) - 1 }, (_, i) => ({ layer, bob: i + 1 }));
  return { ...fallback, flag: [{ layer, bob: 0 }, ...rest] };
}

export function ownPropStumpBinding(
  fallback: SpriteBindings['stump'],
  manifests: readonly OwnPropManifest[],
): SpriteBindings['stump'] {
  const stump = singlePropOfKind(manifests, 'stump');
  return stump === undefined ? fallback : { byGood: {}, default: { layer: ownPropLayer(stump.id), bob: 0 } };
}
