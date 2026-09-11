import type { SimEvent } from '../core/events.js';
import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import type { HalfCellNode } from '../nav/halfcell.js';

export interface GroundMissionMarker {
  readonly style: 'area' | 'magic' | 'import';
  readonly point: HalfCellNode;
}
export interface MissionWeatherRegion {
  readonly weather: 'rain' | 'snow';
  readonly min: HalfCellNode;
  readonly max: HalfCellNode;
  readonly density: number;
}
export interface MissionPresentationView {
  readonly guiMarkers: readonly { readonly marker: number; readonly point: HalfCellNode }[];
  readonly groundMarkers: readonly GroundMissionMarker[];
  readonly weather: readonly MissionWeatherRegion[];
}

const presentation = defineWorldSingleton<{
  gui: Map<number, HalfCellNode>;
  ground: Map<string, GroundMissionMarker>;
  weather: MissionWeatherRegion[];
}>('MissionPresentation', () => ({ gui: new Map(), ground: new Map(), weather: [] }));

export const MissionPresentation = presentation.component;

type PersistentEvent = Extract<
  SimEvent,
  { kind: 'missionGuiMarker' | 'missionAreaMarkers' | 'missionImportMarker' | 'missionWeather' }
>;

const pointKey = (point: HalfCellNode): string => `${point.hx},${point.hy}`;

export function retainMissionPresentation(world: World, event: PersistentEvent): void {
  presentation.write(world, (state) => {
    switch (event.kind) {
      case 'missionGuiMarker':
        if (event.placed) state.gui.set(event.marker, { ...event.point });
        else state.gui.delete(event.marker);
        break;
      case 'missionImportMarker':
        if (event.placed)
          state.ground.set(pointKey(event.point), { style: 'import', point: { ...event.point } });
        else state.ground.delete(pointKey(event.point));
        break;
      case 'missionAreaMarkers':
        for (const point of event.points) {
          if (event.placed) {
            state.ground.set(pointKey(point), { style: event.magic ? 'magic' : 'area', point: { ...point } });
          } else state.ground.delete(pointKey(point));
        }
        break;
      case 'missionWeather': {
        // A repeated extent moves to the end: overlap follows write order, including zero-density clears.
        state.weather = state.weather.filter(
          (region) =>
            region.weather !== event.weather ||
            region.min.hx !== event.min.hx ||
            region.min.hy !== event.min.hy ||
            region.max.hx !== event.max.hx ||
            region.max.hy !== event.max.hy,
        );
        state.weather.push({
          weather: event.weather,
          min: { ...event.min },
          max: { ...event.max },
          density: event.density,
        });
        break;
      }
    }
  });
}

export function missionPresentation(world: World): MissionPresentationView {
  const state = presentation.read(world);
  return {
    guiMarkers: [...state.gui].map(([marker, point]) => ({ marker, point: { ...point } })),
    groundMarkers: [...state.ground.values()].map(({ style, point }) => ({ style, point: { ...point } })),
    weather: state.weather.map(({ weather, min, max, density }) => ({
      weather,
      min: { ...min },
      max: { ...max },
      density,
    })),
  };
}
