import { ONE, type WorldSnapshot } from '@open-northland/sim';
import { tileToScreen } from '../projection/index.js';
import { signpostsOf } from './snapshot-index.js';
import { readPosition } from './snapshot-readers/index.js';

/**
 * Which angular board frames each signpost shows: one board per linked same-player neighbour, pointing
 * at it (observed original - the boards indicate that, and where, the network continues). The links are
 * the sim's own `Signpost.links`, so the drawn boards can never disagree with the network. Angles are
 * measured in projected screen space, so a board points along the on-screen line to its neighbour.
 */

/** The decoded `ls_guidepost` board frame count: bobs 1..18 sweep a full turn in ~20° steps. */
export const SIGNPOST_BOARD_FRAMES = 18;

interface Post {
  /** Tile-space position. */
  readonly x: number;
  readonly y: number;
  readonly links: readonly number[];
}

/** Per-snapshot memo: pairing runs once per snapshot, not once per frame. */
const boardsBySnapshot = new WeakMap<WorldSnapshot, ReadonlyMap<number, readonly number[]>>();
const EMPTY_BOARDS: ReadonlyMap<number, readonly number[]> = new Map();

/** Signpost entity id → its 0-based board frame indices, deduplicated per angle bucket. */
export function signpostBoardsOf(snapshot: WorldSnapshot): ReadonlyMap<number, readonly number[]> {
  const cached = boardsBySnapshot.get(snapshot);
  if (cached !== undefined) return cached;
  const posts = new Map<number, Post>();
  for (const entity of signpostsOf(snapshot)) {
    const post = readPost(entity.components);
    if (post !== null) posts.set(entity.id, post);
  }
  let index: ReadonlyMap<number, readonly number[]> = EMPTY_BOARDS;
  const byId = new Map<number, number[]>();
  for (const [id, post] of posts) {
    for (const linked of post.links) {
      const other = posts.get(linked);
      if (other !== undefined) addBoard(byId, id, post, other);
    }
  }
  if (byId.size > 0) index = byId;
  boardsBySnapshot.set(snapshot, index);
  return index;
}

/** Append `from`'s board frame pointing at `to` (screen-space bearing → 20° bucket), deduped. */
function addBoard(byId: Map<number, number[]>, fromId: number, from: Post, to: Post): void {
  const sa = tileToScreen(from.x, from.y);
  const sb = tileToScreen(to.x, to.y);
  // Clockwise bearing from screen-north: bob 1 points away from the camera and the series sweeps
  // clockwise in even steps (decoded frame offsets; the frame↔bearing join is an approximation).
  const theta = Math.atan2(sb.x - sa.x, -(sb.y - sa.y));
  const step = (2 * Math.PI) / SIGNPOST_BOARD_FRAMES;
  const bucket =
    ((Math.round(theta / step) % SIGNPOST_BOARD_FRAMES) + SIGNPOST_BOARD_FRAMES) % SIGNPOST_BOARD_FRAMES;
  let list = byId.get(fromId);
  if (list === undefined) {
    list = [];
    byId.set(fromId, list);
  }
  if (!list.includes(bucket)) list.push(bucket);
}

/** Decode one signpost entity into a {@link Post}; null when it carries no links or position. */
function readPost(components: Readonly<Record<string, unknown>>): Post | null {
  const signpost = components.Signpost as { links?: unknown } | undefined;
  if (signpost === undefined || !Array.isArray(signpost.links)) return null;
  const p = readPosition(components);
  if (p === null) return null;
  const links = signpost.links.filter((e): e is number => typeof e === 'number');
  return { x: p.x / ONE, y: p.y / ONE, links };
}
