import type { AssetSet } from '../../view/settings-store.js';

export type GalleryTab = 'animations' | 'buildings' | 'terrain' | 'goods';
export const GALLERY_ZOOMS = [1, 2, 4, 8] as const;
export const GALLERY_COMPARISON_LIMIT = 4;
export type GalleryZoom = (typeof GALLERY_ZOOMS)[number];
export function galleryZoom(value: string | null): GalleryZoom {
  return GALLERY_ZOOMS.find((zoom) => String(zoom) === value) ?? 2;
}
export interface GalleryState {
  tab: GalleryTab;
  asset: string;
  compare: string[];
  q: string;
  terrainKind: 'all' | 'material' | 'prop';
  zoom: GalleryZoom;
  direction: number;
  clip: string;
  playing: boolean;
  speed: number;
  time: number;
  frame?: number;
  progress: number;
  terrainView: 'atlas' | 'repeat';
  background: 'dark' | 'light' | 'checker';
  geometry: boolean;
  /** Which art the building panels draw over the shared geometry, named like the map's `assets` switch. */
  assets: AssetSet;
}
function bounded(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
export function readGalleryState(params: URLSearchParams): GalleryState {
  const tab = params.get('tab');
  const background = params.get('background');
  return {
    tab: tab === 'buildings' || tab === 'terrain' || tab === 'goods' ? tab : 'animations',
    asset: params.get('asset') ?? '',
    compare: [...new Set((params.get('compare') ?? '').split(',').filter(Boolean))].slice(
      0,
      GALLERY_COMPARISON_LIMIT,
    ),
    q: params.get('q') ?? '',
    terrainKind:
      params.get('terrainKind') === 'prop'
        ? 'prop'
        : params.get('terrainKind') === 'material'
          ? 'material'
          : 'all',
    zoom: galleryZoom(params.get('zoom')),
    direction: Math.floor(bounded(params.get('direction'), 5, 0, 7)),
    clip: params.get('clip') ?? 'walk',
    playing: params.get('pause') !== '1' && !params.has('frame'),
    speed: bounded(params.get('speed'), 1, 0.1, 3),
    time: bounded(params.get('time'), 0, 0, Number.MAX_SAFE_INTEGER),
    ...(params.has('frame') ? { frame: Math.floor(bounded(params.get('frame'), 0, 0, 10000)) } : {}),
    progress: bounded(params.get('progress'), 100, 0, 100),
    terrainView: params.get('terrainView') === 'repeat' ? 'repeat' : 'atlas',
    background: background === 'light' || background === 'checker' ? background : 'dark',
    geometry: params.get('geometry') === '1',
    assets: params.get('assets') === 'original' ? 'original' : 'own',
  };
}
export function galleryQuery(state: GalleryState): string {
  const params = new URLSearchParams({ art: 'gallery', tab: state.tab });
  for (const key of ['asset', 'q', 'clip', 'background', 'terrainView', 'terrainKind'] as const)
    if (state[key]) params.set(key, state[key]);
  if (state.compare.length) params.set('compare', state.compare.join(','));
  for (const key of ['zoom', 'direction', 'speed', 'progress', 'time'] as const)
    params.set(key, String(state[key]));
  if (!state.playing) params.set('pause', '1');
  if (state.frame !== undefined) params.set('frame', String(state.frame));
  if (state.geometry) params.set('geometry', '1');
  if (state.assets !== 'own') params.set('assets', state.assets);
  return `?${params}`;
}
