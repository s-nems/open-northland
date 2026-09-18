import { FOG_MODE, type FogMode, fogSettings, hasMetContact, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { FOG_STATE, type FogState } from './state.js';

/** The cell holding half-cell node (hx, hy): cell (c, r) owns the 2×2 node block (2c..2c+1, 2r..2r+1).
 *  Source basis: mapdat lane layout, as built by `halfCellMapFromCells`. */
export function cellOfNode(hx: number, hy: number): { cx: number; cy: number } {
  return { cx: hx >> 1, cy: hy >> 1 };
}

/**
 * The state a player's eye effectively sees at a cell under `mode`: the raw mask with the known-terrain
 * rule of a RECON map, under which an UNEXPLORED cell reads EXPLORED. The one mapping render, minimap,
 * and the headless checks share.
 */
export function effectiveFogState(
  fog: FogState,
  mode: FogMode,
  player: number,
  cellX: number,
  cellY: number,
): number {
  const raw = fog.stateAt(player, cellX, cellY);
  if (raw === FOG_STATE.UNEXPLORED && fogSettings(mode)?.terrainKnown === true) return FOG_STATE.EXPLORED;
  return raw;
}

/**
 * Whether `player` currently sees the half-cell node (hx, hy). With fog off, or with no fog resource at all
 * in a mapless sim, everything is seen, so pre-fog behaviour stays byte-identical.
 */
function playerSeesNode(fog: FogState | undefined, player: number, hx: number, hy: number): boolean {
  if (fog === undefined || fog.activeMode === FOG_MODE.OFF) return true;
  const { cx, cy } = cellOfNode(hx, hy);
  return fog.stateAt(player, cx, cy) === FOG_STATE.VISIBLE;
}

/**
 * Whether `player` has explored the half-cell node (hx, hy): its cell reads at least EXPLORED under the
 * mode the last rebuild ran, so a RECON map's known terrain counts as explored, and fog off or absent
 * reads explored everywhere.
 */
export function playerExploredNode(
  fog: FogState | undefined,
  player: number,
  hx: number,
  hy: number,
): boolean {
  if (fog === undefined || fog.activeMode === FOG_MODE.OFF) return true;
  const { cx, cy } = cellOfNode(hx, hy);
  return effectiveFogState(fog, fog.activeMode, player, cx, cy) >= FOG_STATE.EXPLORED;
}

/**
 * Whether `viewer` has discovered `other` - the first-contact gate the diplomacy roster reads. With fog
 * off or absent everything is in plain sight, so every player reads discovered, mirroring
 * {@link playerSeesEntity}; under fog the vision system's recorded contacts decide. A player always
 * knows itself.
 */
export function playerHasMet(
  world: World,
  fog: FogState | undefined,
  viewer: number,
  other: number,
): boolean {
  if (viewer === other) return true;
  if (fog === undefined || fog.activeMode === FOG_MODE.OFF) return true;
  return hasMetContact(world, viewer, other);
}

/**
 * Whether `player` currently sees the entity `target`. Authored rule: a unit in fog can be neither
 * auto-engaged nor fled from, while a position-less target has no cell to hide in and is seen. A pure read
 * of the mask frozen this tick, so nearest-search winners stay deterministic.
 */
export function playerSeesEntity(
  world: World,
  fog: FogState | undefined,
  player: number,
  target: Entity,
): boolean {
  if (fog === undefined || fog.activeMode === FOG_MODE.OFF) return true;
  const p = world.tryGet(target, Position);
  if (p === undefined) return true;
  const n = nodeOfPosition(p.x, p.y);
  return playerSeesNode(fog, player, n.hx, n.hy);
}
