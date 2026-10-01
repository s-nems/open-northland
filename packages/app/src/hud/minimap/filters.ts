/** What the minimap plots: one switch per marker layer, whose markers show and how much ground shows
 *  under them. Persisted in the settings. */

import { MINIMAP_GROUND_MODES, type MinimapGroundMode } from '@open-northland/render/data';

export const MINIMAP_LAYERS = [
  'civilians',
  'soldiers',
  'buildings',
  'vehicles',
  'animals',
  'roads',
  'signposts',
] as const;
export type MinimapLayer = (typeof MINIMAP_LAYERS)[number];

/** Whose owned markers show, read as the viewing seat's diplomacy toward each owner. */
export const MINIMAP_SCOPES = ['everyone', 'mine', 'friendly', 'hostile'] as const;
export type MinimapScope = (typeof MINIMAP_SCOPES)[number];

export interface MinimapFilters {
  readonly layers: Readonly<Record<MinimapLayer, boolean>>;
  readonly scope: MinimapScope;
  readonly ground: MinimapGroundMode;
}

function layersAll(shown: boolean): Record<MinimapLayer, boolean> {
  const layers = {} as Record<MinimapLayer, boolean>;
  for (const layer of MINIMAP_LAYERS) layers[layer] = shown;
  return layers;
}

/** The layers shown out of the box: the owned forces and works; wildlife, roads and posts are clutter
 *  a player opts into. Owner ruling. */
const DEFAULT_SHOWN_LAYERS: ReadonlySet<MinimapLayer> = new Set<MinimapLayer>([
  'civilians',
  'soldiers',
  'buildings',
  'vehicles',
]);

function defaultLayers(): Record<MinimapLayer, boolean> {
  const layers = {} as Record<MinimapLayer, boolean>;
  for (const layer of MINIMAP_LAYERS) layers[layer] = DEFAULT_SHOWN_LAYERS.has(layer);
  return layers;
}

export const DEFAULT_MINIMAP_FILTERS: MinimapFilters = {
  layers: defaultLayers(),
  scope: 'everyone',
  ground: 'natural',
};

/** A stored blob back to filters; a missing or deformed field keeps its default. */
export function parseMinimapFilters(value: unknown): MinimapFilters {
  if (typeof value !== 'object' || value === null) return DEFAULT_MINIMAP_FILTERS;
  const record = value as { layers?: unknown; scope?: unknown; ground?: unknown };
  const stored =
    typeof record.layers === 'object' && record.layers !== null
      ? (record.layers as Record<string, unknown>)
      : {};
  const layers = defaultLayers();
  for (const layer of MINIMAP_LAYERS) {
    const shown = stored[layer];
    if (typeof shown === 'boolean') layers[layer] = shown;
  }
  const scope =
    MINIMAP_SCOPES.find((candidate) => candidate === record.scope) ?? DEFAULT_MINIMAP_FILTERS.scope;
  const ground =
    MINIMAP_GROUND_MODES.find((candidate) => candidate === record.ground) ?? DEFAULT_MINIMAP_FILTERS.ground;
  return { layers, scope, ground };
}

export function toggleMinimapLayer(filters: MinimapFilters, layer: MinimapLayer): MinimapFilters {
  return { ...filters, layers: { ...filters.layers, [layer]: !filters.layers[layer] } };
}

export function withAllMinimapLayers(filters: MinimapFilters, shown: boolean): MinimapFilters {
  return { ...filters, layers: layersAll(shown) };
}

export function allMinimapLayersShown(filters: MinimapFilters): boolean {
  return MINIMAP_LAYERS.every((layer) => filters.layers[layer]);
}
