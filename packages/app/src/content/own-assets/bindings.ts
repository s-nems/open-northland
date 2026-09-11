import type { GroundPattern, TerrainTextureSet, TransitionPattern } from '@open-northland/render';

export function ownTerrainBindings(
  pages: TerrainTextureSet['pages'],
  bindings: ReadonlyMap<string, GroundPattern>,
  transitions: ReadonlyMap<string, TransitionPattern> = new Map(),
): TerrainTextureSet {
  const coordsA = [0, 0, 63, 63, 0, 63];
  const coordsB = [0, 0, 63, 0, 63, 63];
  const fallback: GroundPattern = { pageKey: 'missing-ground', coordsA, coordsB };
  return {
    pages,
    cellFor: () => ({
      pageKey: 'missing-ground',
      rect: { x: 0, y: 0, w: 64, h: 64 },
      fallbackColour: 0x656777,
    }),
    groundFor: (name) => bindings.get(name) ?? fallback,
    transitionFor: (name) =>
      transitions.get(name) ?? {
        pageKey: 'missing-transition',
        coordsA: Array.from({ length: 6 }, () => coordsA),
        coordsB: Array.from({ length: 6 }, () => coordsB),
      },
  };
}
