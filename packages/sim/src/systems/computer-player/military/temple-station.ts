import { PRAYER_SITE } from '@open-northland/data';
import type { World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import { type HalfCellNode, hexDistanceBetween } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { homeBuildings } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { TEMPLE_AURA_RANGE } from '../../lifecycle/temple-aura.js';
import { isFinishedPrayerSite } from '../../readviews/index.js';

// Owner ruling: a seat that owns a temple stations its waiting army inside the temple's aura, where the
// blessing lifts its soldiers' hitpoints past their max.

/** How far inside the aura's rim the station lies, in hex nodes (authored): a band at the army cap of 150
 *  spreads over one standing place per visual cell to about 17 nodes round its rally, so the whole band
 *  stands blessed. */
export const TEMPLE_STATION_INSET_NODES = 20;

/** How far from a temple's anchor the station may lie. */
const STATION_REACH = TEMPLE_AURA_RANGE - TEMPLE_STATION_INSET_NODES;

/** The anchors of `player`'s finished temples, ascending by entity id: the nodes the aura is measured
 *  from. A wounded temple still counts, since it blesses again once it is whole. */
export function seatTempleAnchors(world: World, ctx: SystemContext, player: number): HalfCellNode[] {
  const anchors: HalfCellNode[] = [];
  for (const e of homeBuildings(world, ctx, player)) {
    if (!isFinishedPrayerSite(world, ctx, e, PRAYER_SITE.temple)) continue;
    const at = anchorNodeOf(world, e);
    if (at !== null) anchors.push(at);
  }
  return anchors;
}

/**
 * The station inside a temple's aura nearest `toward`: `toward` itself when it lies within
 * {@link STATION_REACH} of a temple, else the first open, unblocked node on `toward`'s land walking from the
 * reach's rim straight toward the temple. Of several temples the spot nearest `toward`, the earlier temple
 * on a tie. Null with no temple, or no open ground of that land within any temple's reach. Approximation:
 * a straight step over the half-cell lattice.
 */
export function templeStationToward(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  temples: readonly HalfCellNode[],
  toward: NodeId,
): NodeId | null {
  const { x: px, y: py } = terrain.coordsOf(toward);
  const side = terrain.componentOf(toward);
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const t of temples) {
    const span = hexDistanceBetween(t.hx, t.hy, px, py);
    if (span <= STATION_REACH) return toward;
    for (let out = STATION_REACH; out >= 0; out--) {
      const x = t.hx + Math.round(((px - t.hx) * out) / span);
      const y = t.hy + Math.round(((py - t.hy) * out) / span);
      if (hexDistanceBetween(t.hx, t.hy, x, y) > STATION_REACH) continue;
      const node = terrain.nodeAtClamped(x, y);
      if (!terrain.isWalkable(node) || blocked.has(node) || terrain.componentOf(node) !== side) continue;
      const distance = hexDistanceBetween(x, y, px, py);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
      break;
    }
  }
  return best;
}

/** The ground the army's stands are picked on: `player`'s temple anchors ({@link seatTempleAnchors}) and
 *  the walk-blocked nodes, read once per decision. */
export interface StandGround {
  readonly temples: readonly HalfCellNode[];
  readonly blocked: BlockOverlay;
}

export function standGroundOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
): StandGround {
  return {
    temples: seatTempleAnchors(world, ctx, player),
    blocked: dynamicBlockOverlay(world, ctx, terrain),
  };
}

/** {@link templeStationToward} over the seat's own temples in `ground`; null for a seat with none. */
export function templeStationOf(terrain: TerrainGraph, ground: StandGround, toward: NodeId): NodeId | null {
  if (ground.temples.length === 0) return null;
  return templeStationToward(terrain, ground.blocked, ground.temples, toward);
}
