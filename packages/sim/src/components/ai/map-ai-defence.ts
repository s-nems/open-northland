import { defineComponent, type Entity } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';

export interface MapAiDefenceState {
  player: number;
  centre: HalfCellNode;
  home: HalfCellNode;
  /** Maximum pursuit distance from the defended camp, in map points. Approximation. */
  radius: number;
  threat: Entity;
  returning: boolean;
}

/** Ownership and leash of one reactive map-camp sortie, retained across saves and decision intervals. */
export const MapAiDefence = defineComponent<MapAiDefenceState>('MapAiDefence', 'players', { simOnly: true });
