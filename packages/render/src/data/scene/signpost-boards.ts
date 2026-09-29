import { entityById, ONE, type WorldSnapshot } from '@open-northland/sim';
import { tileToScreen } from '../projection/index.js';
import { readPosition } from './snapshot-readers/index.js';

/**
 * Which angular board frames each signpost shows: one board per linked same-player neighbour, pointing
 * at it (observed original - the boards indicate that, and where, the network continues). The links are
 * the sim's own `Signpost.links`, so the drawn boards can never disagree with the network. Angles are
 * measured in projected screen space, so a board points along the on-screen line to its neighbour.
 */

/** The decoded `ls_guidepost` board frame count: bobs 1..18 sweep a full turn in ~20° steps. */
export const SIGNPOST_BOARD_FRAMES = 18;

const BOARD_STEP = (2 * Math.PI) / SIGNPOST_BOARD_FRAMES;

/**
 * A drawn post's 0-based board frame indices, one per bearing bucket, in link order. Read per post the
 * scene draws, so the cost follows the posts on screen: each link is one id lookup. A link to an entity
 * that is no signpost with a position (a post already gone) shows no board.
 */
export function signpostBoards(
  snapshot: WorldSnapshot,
  components: Readonly<Record<string, unknown>>,
): number[] {
  const links = signpostLinks(components);
  const from = readPosition(components);
  if (links === null || links.length === 0 || from === null) return [];
  const boards: number[] = [];
  const fromScreen = tileToScreen(from.x / ONE, from.y / ONE);
  for (const link of links) {
    if (typeof link !== 'number') continue;
    const other = entityById(snapshot, link);
    if (other === undefined || signpostLinks(other.components) === null) continue;
    const to = readPosition(other.components);
    if (to === null) continue;
    const bucket = boardBucket(fromScreen, tileToScreen(to.x / ONE, to.y / ONE));
    if (!boards.includes(bucket)) boards.push(bucket);
  }
  return boards;
}

/** The board frame pointing from `from` toward `to`, both screen px: the clockwise bearing from
 *  screen-north in 20° buckets. Bob 1 points away from the camera and the series sweeps clockwise in
 *  even steps (decoded frame offsets; the frame↔bearing join is an approximation). */
function boardBucket(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const theta = Math.atan2(to.x - from.x, -(to.y - from.y));
  return (
    ((Math.round(theta / BOARD_STEP) % SIGNPOST_BOARD_FRAMES) + SIGNPOST_BOARD_FRAMES) % SIGNPOST_BOARD_FRAMES
  );
}

function signpostLinks(components: Readonly<Record<string, unknown>>): readonly unknown[] | null {
  const signpost = components.Signpost as { links?: unknown } | undefined;
  return signpost !== undefined && Array.isArray(signpost.links) ? signpost.links : null;
}
