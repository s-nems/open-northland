import { setDebugFlag } from '../diag/debug-flags.js';

export interface MapSceneDefinition {
  readonly id: string;
  readonly mapId: string;
}

export const MAP_SCENES: readonly MapSceneDefinition[] = [{ id: 'mission-map', mapId: 'wielkie_sprzatanie' }];

export function mapSceneParams(scene: MapSceneDefinition, source: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(source);
  params.delete('scene');
  params.set('map', scene.mapId);
  if (!params.has('missions')) params.set('missions', 'on');
  setDebugFlag(params, 'missions', true);
  return params;
}
