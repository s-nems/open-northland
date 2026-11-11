import type { RallyBanner } from '@open-northland/render';
import { entityById, nodeOfPosition, type WorldSnapshot } from '@open-northland/sim';
import { ownerPlayerOf, positionOf, rallyFlagOf } from '../../game/snapshot/index.js';

const NONE: readonly RallyBanner[] = [];

/**
 * The rally banners the world shows for the current selection: one where each selected barracks of the
 * viewer's own keeps its flag (owner ruling: only its owner sees it, and only with the barracks
 * selected). `seat` is the viewer's own seat, null for the whole map, which shows every selected one.
 * Resolved through the selection, a handful of ids, never the world.
 */
export function rallyBanners(
  snapshot: WorldSnapshot,
  selected: ReadonlySet<number>,
  seat: number | null,
  colourOf: (player: number) => number,
): readonly RallyBanner[] {
  let banners: RallyBanner[] | undefined;
  for (const id of selected) {
    const barracks = entityById(snapshot, id);
    const flagId = barracks === undefined ? undefined : rallyFlagOf(barracks);
    if (barracks === undefined || flagId === undefined) continue;
    const owner = ownerPlayerOf(barracks);
    if (owner === undefined || (seat !== null && owner !== seat)) continue;
    const flag = entityById(snapshot, flagId);
    const at = flag === undefined ? undefined : positionOf(flag);
    if (at === undefined) continue;
    const node = nodeOfPosition(at.x, at.y);
    banners ??= [];
    banners.push({ id: flagId, hx: node.hx, hy: node.hy, colour: colourOf(owner) });
  }
  return banners ?? NONE;
}
