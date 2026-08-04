import type { ContentSet } from '@open-northland/data';
import {
  Owner,
  Position,
  SIGNPOST_NAV_RADIUS_NODES,
  SIGNPOST_SPACING_RADIUS_NODES,
  Signpost,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import { withinNodeRadius } from '../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { canPlaceWorkFlag, workFlagBlockerVersion, workFlagPlacementBlocks } from '../footprint/index.js';
import { signpostNetwork } from './network.js';

/**
 * Whether `player` may erect a signpost at `node`: open walkable ground under the work-flag rule, off any
 * existing signpost's cell, and outside every same-player signpost's minimum-spacing circle. Signposts do
 * not block walking, so walkability is a ground-quality gate only.
 */
export function canPlaceSignpost(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  node: NodeId,
  player: number,
): boolean {
  // canPlaceWorkFlag already covers ground quality, standing bodies, markers, and existing signpost
  // cells; the spacing circle is the signpost-specific extra gate. Approximation: spacing is same-player
  // only, since the original's cross-player spacing rule is not observed.
  if (!canPlaceWorkFlag(world, ctx, terrain, node)) return false;
  const c = terrain.coordsOf(node);
  const posts = signpostNetwork(world).get(player) ?? [];
  for (const s of posts) {
    if (withinNodeRadius(s.hx, s.hy, c.x, c.y, s.spacingRadius)) return false;
  }
  return true;
}

/** A ready-to-query erectability test for one player: {@link canPlaceSignpost}'s rule with the blocked set
 *  and the player's spacing circles resolved once, asked per visible node by the placement overlay. */
export interface SignpostProbe {
  /** Whether `player` may erect a signpost at half-cell node `(x, y)`. */
  canPlace(x: number, y: number): boolean;
}

/**
 * Per-world memo of the last built probe, keyed by the {@link workFlagBlockerVersion} and its player. One
 * entry suffices, since the app probes for the one human player. A pure read-path cache feeding only the
 * overlay, never a sim decision, so it is not hashed and needs no `verifyCaches` registration.
 */
interface ProbeMemo {
  version: string;
  content: ContentSet;
  terrain: TerrainGraph;
  probe: SignpostProbe;
}
const probeMemo = new WeakMap<World, ProbeMemo>();

/**
 * Build a {@link SignpostProbe} for `player`: the world's blocked set is collected once, so each
 * `canPlace` costs only the player's post count, and the probe rebuilds only when a blocker changes.
 */
export function signpostProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
): SignpostProbe {
  const version = `${workFlagBlockerVersion(world)}:${player}`;
  const cached = probeMemo.get(world);
  if (
    cached !== undefined &&
    cached.version === version &&
    cached.content === content &&
    cached.terrain === terrain
  ) {
    return cached.probe;
  }
  const blocked = workFlagPlacementBlocks(world, content, terrain);
  const posts = signpostNetwork(world).get(player) ?? [];
  const probe: SignpostProbe = {
    canPlace: (x, y) => {
      if (!terrain.inBounds(x, y)) return false;
      const node = terrain.nodeAt(x, y);
      if (!terrain.isWalkable(node) || blocked.has(node)) return false;
      for (const s of posts) {
        if (withinNodeRadius(s.hx, s.hy, x, y, s.spacingRadius)) return false;
      }
      return true;
    },
  };
  probeMemo.set(world, { version, content, terrain, probe });
  return probe;
}

/**
 * Erect a signpost owned by `player` at `node`, the build-guide atomic's completion effect. Re-validates
 * {@link canPlaceSignpost}, since the world may have changed during the hammer swing, and returns null
 * when the spot is no longer legal. Source basis: observed original, one hammer strike and no materials.
 */
export function erectSignpost(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  node: NodeId,
  player: number,
): Entity | null {
  if (!canPlaceSignpost(world, ctx, terrain, node, player)) return null;
  const c = terrain.coordsOf(node);
  const pos = positionOfNode(c.x, c.y);
  const e = world.create();
  world.add(e, Position, { x: pos.x, y: pos.y });
  world.add(e, Owner, { player });
  world.add(e, Signpost, {
    navRadius: SIGNPOST_NAV_RADIUS_NODES,
    spacingRadius: SIGNPOST_SPACING_RADIUS_NODES,
  });
  return e;
}
