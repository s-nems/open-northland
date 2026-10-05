import { MAX_ZOOM, MIN_ZOOM } from './pan-zoom.js';

/** `?zoom` pins the opening zoom for reproducible captures; otherwise the game opens at `fallback`. */
export function mapZoomParam(params: URLSearchParams, fallback: number): number {
  const zoom = Number(params.get('zoom'));
  return Number.isFinite(zoom) && zoom > 0 ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) : fallback;
}
