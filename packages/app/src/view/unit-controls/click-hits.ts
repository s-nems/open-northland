import type { DoorBadge, ElevationField } from '@open-northland/render';
import { pickableSeat, type ViewerSeat } from '../../game/viewer-seat.js';
import { drawnInFront, pickDoorBadgeRow, pickGarrisonFlag, pickTopAt, topTargetAt } from '../picking.js';
import type { UnitTargets } from './unit-targets.js';

/** A door marker's click owner: a sign row stands for its settler, a garrison flag for its building. */
export type DoorMarkerHit =
  | { readonly kind: 'settler'; readonly ref: number }
  | { readonly kind: 'building'; readonly ref: number };

export interface ClickHitDeps {
  readonly doorBadges?: () => readonly DoorBadge[];
  readonly targets: Pick<UnitTargets, 'owned' | 'flags' | 'signposts'>;
  readonly viewer: ViewerSeat;
  readonly elevation?: ElevationField;
}

export interface ClickHits {
  readonly doorMarkerAt: (wx: number, wy: number) => DoorMarkerHit | null;
  readonly selectionAt: (wx: number, wy: number) => number | null;
}

/**
 * The order a click resolves what it landed on: a door marker, then a settler or drop-off flag, then
 * a building, then a palisade segment or gate, then an owned vehicle, then a signpost. Sign rows and garrison
 * flags are small intentional targets that a building's larger sprite would otherwise swallow. A vehicle
 * comes after the units and houses: its crew standing beside it, and a house its sprite overlaps, must stay
 * clickable.
 */
export function createClickHits(deps: ClickHitDeps): ClickHits {
  /** An enemy building's markers are not selection proxies for the men behind them. */
  const clickableBadges = (): readonly DoorBadge[] => {
    const badges = deps.doorBadges?.() ?? [];
    const seat = pickableSeat(deps.viewer);
    return seat === null ? badges : badges.filter((b) => b.player === seat);
  };

  const doorMarkerAt = (wx: number, wy: number): DoorMarkerHit | null => {
    const badges = clickableBadges();
    const settler = pickDoorBadgeRow(badges, wx, wy, deps.elevation);
    if (settler !== null) return { kind: 'settler', ref: settler };
    const building = pickGarrisonFlag(badges, wx, wy, deps.elevation);
    return building === null ? null : { kind: 'building', ref: building };
  };

  /**
   * A drop-off flag stands for its gatherer and outranks every building. It ties with a settler, and the
   * one drawn in front takes the click. The original's world pick resolves a hit on a human's
   * work-centre marker to that human at the rank humans hold, above houses and signposts, and the later
   * hit of its front-to-back scan wins among equal ranks.
   */
  const unitAt = (wx: number, wy: number): number | null => {
    const flag = topTargetAt(deps.targets.flags(), wx, wy);
    const settler = topTargetAt(deps.targets.owned('settler'), wx, wy);
    if (flag === null) return settler?.ref ?? null;
    return settler !== null && drawnInFront(settler, flag) ? settler.ref : flag.ref;
  };

  return {
    doorMarkerAt,
    selectionAt: (wx, wy) =>
      doorMarkerAt(wx, wy)?.ref ??
      unitAt(wx, wy) ??
      pickTopAt(deps.targets.owned('building'), wx, wy) ??
      pickTopAt(deps.targets.owned('palisade'), wx, wy) ??
      pickTopAt(deps.targets.owned('vehicle'), wx, wy) ??
      pickTopAt(deps.targets.signposts(), wx, wy),
  };
}
