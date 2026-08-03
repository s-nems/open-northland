import { type Fixed, nodeOfPosition, ONE, systems, type WorldSnapshot } from '@open-northland/sim';
import { tileToScreen } from '../projection/index.js';
import { signpostsOf } from './snapshot-index.js';
import { readPosition } from './snapshot-readers/index.js';

/**
 * Which angular board frames each signpost shows: one board per connected in-range same-player
 * neighbour, pointing at it (observed original - the boards indicate that, and where, the network
 * continues). Angles are measured in projected screen space, so a board points along the on-screen
 * line to its neighbour.
 */

/** The decoded `ls_guidepost` board frame count: bobs 1..18 sweep a full turn in ~20° steps. */
export const SIGNPOST_BOARD_FRAMES = 18;

interface Post {
  readonly id: number;
  /** Tile-space position. */
  readonly x: number;
  readonly y: number;
  /** Half-cell node coords - the sim's connectivity lattice. */
  readonly hx: number;
  readonly hy: number;
  readonly player: number;
  readonly navRadius: number;
}

/** Per-snapshot memo: pairing runs once per snapshot, not once per frame. */
const boardsBySnapshot = new WeakMap<WorldSnapshot, ReadonlyMap<number, readonly number[]>>();
const EMPTY_BOARDS: ReadonlyMap<number, readonly number[]> = new Map();

/** Signpost entity id → its 0-based board frame indices, deduplicated per angle bucket. */
export function signpostBoardsOf(snapshot: WorldSnapshot): ReadonlyMap<number, readonly number[]> {
  const cached = boardsBySnapshot.get(snapshot);
  if (cached !== undefined) return cached;
  const posts: Post[] = [];
  for (const entity of signpostsOf(snapshot)) {
    const post = readPost(entity.id, entity.components);
    if (post !== null) posts.push(post);
  }
  let index: ReadonlyMap<number, readonly number[]> = EMPTY_BOARDS;
  if (posts.length > 1) {
    const byId = new Map<number, number[]>();
    for (let i = 0; i < posts.length; i++) {
      const a = posts[i] as Post;
      for (let j = i + 1; j < posts.length; j++) {
        const b = posts[j] as Post;
        if (a.player !== b.player) continue;
        // The sim's own link rule, over nodes taken through its `nodeOfPosition` seam, so the drawn
        // boards can never disagree with the network.
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
  // Clockwise bearing from screen-north: bob 1 points away from the camera and the series sweeps
  // clockwise in even steps (decoded frame offsets; the frame↔bearing join is an approximation).
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

/** Decode one signpost entity into a {@link Post}; null when it carries no radius, owner or position. */
function readPost(id: number, components: Readonly<Record<string, unknown>>): Post | null {
  const signpost = components.Signpost as { navRadius?: unknown } | undefined;
  if (signpost === undefined || typeof signpost.navRadius !== 'number') return null;
  const owner = components.Owner as { player?: unknown } | undefined;
  const p = readPosition(components);
  if (p === null || typeof owner?.player !== 'number') return null;
  // Snapshot Positions are raw Fixed ints, validated as numbers by the reader.
  const { hx, hy } = nodeOfPosition(p.x as Fixed, p.y as Fixed);
  return { id, x: p.x / ONE, y: p.y / ONE, hx, hy, player: owner.player, navRadius: signpost.navRadius };
}
