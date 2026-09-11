import { defineComponent, type World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import type { ScriptLandscapePlacement } from '../nav/terrain/landscapes.js';

export const LandscapeResource = defineComponent<{ id: number }>('LandscapeResource');

export interface LandscapeEditState {
  removed: number[];
  added: ScriptLandscapePlacement[];
  nextId: number;
  topologyRevision: number;
  forbiddenRevision: number;
  forbidden: Map<number, boolean>;
  tints: Map<number, number>;
}

const edits = defineWorldSingleton<LandscapeEditState>('LandscapeEdits', () => ({
  removed: [],
  added: [],
  nextId: 0,
  topologyRevision: 0,
  forbiddenRevision: 0,
  forbidden: new Map(),
  tints: new Map(),
}));
export const LandscapeEdits = edits.component;
export const landscapeEditState = (world: World) => edits.read(world);
export function writeLandscapeEdits(world: World, apply: (state: LandscapeEditState) => void): void {
  edits.write(world, apply);
}
export function landscapeRevision(world: World): number {
  return (
    world.componentValueGeneration(LandscapeEdits) +
    world.componentGeneration(LandscapeEdits) +
    world.componentGeneration(LandscapeResource)
  );
}

export function landscapeTopologyRevision(world: World): number {
  return landscapeEditState(world).topologyRevision + world.componentGeneration(LandscapeResource);
}
export function landscapePlacementRevision(world: World): number {
  return landscapeTopologyRevision(world) + landscapeEditState(world).forbiddenRevision;
}
