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
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { canPlaceWorkFlag, workFlagPlacementBlocks } from '../footprint/index.js';
import { withinNodeRadius } from '../node-metric.js';
import { signpostNetwork } from './network.js';

/**
 * Whether `player` may erect a signpost at `node`: open walkable ground (outside every standing
 * resource/building body and off other markers — the work-flag ground rule), not on any existing
 * signpost's cell, and outside every same-player signpost's minimum-spacing circle. Signposts do NOT
 * block walking, so walkability is a ground-quality gate only (the placement-block side lives in
 * `footprint/placement.ts`, which rejects buildings over signpost cells).
 */
export function canPlaceSignpost(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  node: NodeId,
  player: number,
): boolean {
  // canPlaceWorkFlag covers ground quality, standing bodies, markers AND existing signpost cells (its
  // blocked set includes signpost anchors); the spacing circle is the signpost-specific extra gate.
  // Spacing is SAME-PLAYER only — a rival's post blocks just its own cell (approximation: the
  // original's cross-player spacing rule is not observed; per-player networks make per-player spacing
  // the conservative reading).
  if (!canPlaceWorkFlag(world, ctx, terrain, node)) return false;
  const c = terrain.coordsOf(node);
  const posts = signpostNetwork(world).get(player) ?? [];
  for (const s of posts) {
    if (withinNodeRadius(s.hx, s.hy, c.x, c.y, s.spacingRadius)) return false;
  }
  return true;
}

/** A ready-to-query erectability test for ONE player: the same rule as {@link canPlaceSignpost}, with the
 *  blocked set and the player's spacing circles resolved once — the signpost placement-overlay's
 *  screen-bounded seam (asked per visible node, like the building `PlacementProbe`). */
export interface SignpostProbe {
  /** Whether `player` may erect a signpost at half-cell node `(x, y)`. */
  canPlace(x: number, y: number): boolean;
}

/**
 * Build a {@link SignpostProbe} for `player`. Mirrors `placementProbe`: the world's blocked set is
 * collected once (O(world)), then each `canPlace` is O(player's posts). The overlay memoizes the whole
 * band result on `workFlagBlockerVersion`, so this rebuilds only when a blocker appears or disappears.
 */
export function signpostProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
): SignpostProbe {
  const blocked = workFlagPlacementBlocks(world, content, terrain);
  const posts = signpostNetwork(world).get(player) ?? [];
  return {
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
}

/**
 * Erect a signpost owned by `player` at node `(hx, hy)` — the build-guide atomic's completion effect.
 * Re-validates {@link canPlaceSignpost} (the world may have changed during the hammer swing) and
 * returns the new entity, or `null` when the spot is no longer legal (the swing whiffs, no post).
 * Free and instant by design (source basis: observed original — one hammer strike, no materials).
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
