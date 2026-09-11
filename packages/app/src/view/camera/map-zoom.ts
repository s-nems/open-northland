import { assetSetFor } from '../asset-settings.js';
import { MAX_ZOOM, MIN_ZOOM } from './pan-zoom.js';

export function mapZoomParam(params: URLSearchParams): number {
  const fallback = assetSetFor(params) === 'own' ? 2 : 1;
  const zoom = Number(params.get('zoom'));
  return Number.isFinite(zoom) && zoom > 0 ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) : fallback;
}
