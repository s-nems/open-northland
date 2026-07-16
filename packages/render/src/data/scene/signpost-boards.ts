import type { WorldSnapshot } from '@open-northland/sim';
import { ONE, systems } from '@open-northland/sim';
import { tileToScreen } from '../iso.js';
import { readPosition } from './snapshot-readers/index.js';

/**
 * The signpost DIRECTION-BOARD prepass: which angular board frames each signpost shows — one board per
 * connected in-range same-player neighbour, pointing at it (observed original: the boards indicate that
 * — and where — the network continues; several neighbours nail several boards). Connectivity is the
 * sim's own circle-overlap rule (`systems.withinNodeRadius` on the posts' half-cell nodes — posts sit on
 * node anchors, so the rounding is exact), so the drawn boards can never disagree with the confinement;
 * angles are measured in projected screen space so a board visually points along the on-screen line to
 * its neighbour.
 */

/** The decoded `ls_guidepost` board frame count: bobs 1..18 sweep a full turn in ~20° steps. */
export const SIGNPOST_BOARD_FRAMES = 18;

interface Post {
  readonly id: number;
  /** Tile-space position (floats — render-side only). */
  readonly x: number;
  readonly y: number;
  /** Half-cell node coords (posts anchor exactly on nodes — the sim's connectivity lattice). */
  readonly hx: number;
  readonly hy: number;
  readonly player: number;
  readonly navRadius: number;
}

/** Per-snapshot memo — signposts change rarely but this must not rescan per frame. */
const boardsBySnapshot = new WeakMap<WorldSnapshot, ReadonlyMap<number, readonly number[]>>();
const EMPTY_BOARDS: ReadonlyMap<number, readonly number[]> = new Map();

/**
 * Map of signpost entity id → its board frame indices (0-based into
 * {@link import('../sprites/index.js').SignpostBinding.boards}), deduplicated per angle bucket.
 */
export function signpostBoardsOf(snapshot: WorldSnapshot): ReadonlyMap<number, readonly number[]> {
  const cached = boardsBySnapshot.get(snapshot);
  if (cached !== undefined) return cached;
  const posts: Post[] = [];
  for (const entity of snapshot.entities) {
    const signpost = entity.components.Signpost as { navRadius?: unknown } | undefined;
    if (signpost === undefined || typeof signpost.navRadius !== 'number') continue;
    const owner = entity.components.Owner as { player?: unknown } | undefined;
    const p = readPosition(entity.components);
    if (p === null || typeof owner?.player !== 'number') continue;
    posts.push({
      id: entity.id,
      x: p.x / ONE,
      y: p.y / ONE,
      hx: Math.round((p.x / ONE) * 2),
      hy: Math.round((p.y / ONE) * 2),
      player: owner.player,
      navRadius: signpost.navRadius,
    });
  }
  let index: ReadonlyMap<number, readonly number[]> = EMPTY_BOARDS;
  if (posts.length > 1) {
    const byId = new Map<number, number[]>();
    for (let i = 0; i < posts.length; i++) {
      const a = posts[i] as Post;
      for (let j = i + 1; j < posts.length; j++) {
        const b = posts[j] as Post;
        if (a.player !== b.player) continue;
        // The sim's exact link test — circles apart means no link, no board.
        if (!systems.withinNodeRadius(a.hx, a.hy, b.hx, b.hy, a.navRadius + b.navRadius)) continue;
        addBoard(byId, a, b);
        addBoard(byId, b, a);
      }
    }
    if (byId.size > 0) index = byId;
  }
  boardsBySnapshot.set(snapshot, index);
  return index;
}

/** Append `from`'s board frame pointing at `to` (screen-space bearing → 20° bucket), deduped. */
function addBoard(byId: Map<number, number[]>, from: Post, to: Post): void {
  const sa = tileToScreen(from.x, from.y);
  const sb = tileToScreen(to.x, to.y);
  // Clockwise bearing from screen-north (up): bob 1 points away from the camera (north), the series
  // sweeps clockwise in even steps (decoded frame offsets; the exact frame↔bearing join is a
  // human-validated approximation).
  const theta = Math.atan2(sb.x - sa.x, -(sb.y - sa.y));
  const step = (2 * Math.PI) / SIGNPOST_BOARD_FRAMES;
  const bucket =
    ((Math.round(theta / step) % SIGNPOST_BOARD_FRAMES) + SIGNPOST_BOARD_FRAMES) % SIGNPOST_BOARD_FRAMES;
  let list = byId.get(from.id);
  if (list === undefined) {
    list = [];
    byId.set(from.id, list);
  }
  if (!list.includes(bucket)) list.push(bucket);
}
