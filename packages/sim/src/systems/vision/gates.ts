import { FOG_MODE, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { FOG_STATE, type FogState } from './state.js';

/** The cell holding half-cell node (hx, hy) — the lane convention: cell (c, r) owns the 2×2 node
 *  block (2c..2c+1, 2r..2r+1) (`halfCellMapFromCells`, source basis: mapdat lane layout). */
export function cellOfNode(hx: number, hy: number): { cx: number; cy: number } {
  return { cx: hx >> 1, cy: hy >> 1 };
}

/**
 * The state a PLAYER'S EYE effectively sees at a cell under `mode` — the raw mask value with RECON's
 * one view rule applied (RECON starts with the terrain known: an UNEXPLORED cell reads EXPLORED).
 * This is the single mapping the render, the minimap and the headless checks share.
 */
export function effectiveFogState(
  fog: FogState,
  mode: number,
  player: number,
  cellX: number,
  cellY: number,
): number {
  const raw = fog.stateAt(player, cellX, cellY);
  if (mode === FOG_MODE.RECON && raw === FOG_STATE.UNEXPLORED) return FOG_STATE.EXPLORED;
  return raw;
}

/**
 * Whether `player` currently SEES the half-cell node (hx, hy) — its cell is {@link FOG_STATE.VISIBLE}.
 * The combat/AI gate (auto-acquire, flee threats): with fog OFF (or no fog resource — a mapless sim)
 * everything is seen, so every pre-fog behaviour is byte-identical. In REVEAL mode VISIBLE is sticky
 * (explored ground stays fully visible — the original's behaviour), so the gate follows automatically.
 */
function playerSeesNode(fog: FogState | undefined, player: number, hx: number, hy: number): boolean {
  if (fog === undefined || fog.activeMode === FOG_MODE.OFF) return true;
  const { cx, cy } = cellOfNode(hx, hy);
  return fog.stateAt(player, cx, cy) === FOG_STATE.VISIBLE;
}

/**
 * Whether `player` currently sees the entity `target` — {@link playerSeesNode} at the target's position. The
 * per-candidate form the combat auto-acquire and flee-threat filters compose into their `accept` relations
 * (full sim enforcement — user decision: a unit in fog can be neither auto-engaged nor fled from). A
 * position-less target has no cell to hide in — seen. Pure read of the frozen-this-tick mask (visionSystem runs
 * earlier in SYSTEM_ORDER), so ring-search winners stay deterministic.
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
