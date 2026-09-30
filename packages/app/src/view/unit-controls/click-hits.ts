import type { DoorBadge, ElevationField } from '@open-northland/render';
import { pickableSeat, type ViewerSeat } from '../../game/viewer-seat.js';
import {
  drawnInFront,
  type Pickable,
  pickDoorBadgeRow,
  pickGarrisonFlag,
  pickTopAt,
  topTargetAt,
} from '../picking.js';
import type { SelectionHitTargets, UnitTargets } from './unit-targets.js';

/** A door marker's click owner: a sign row stands for its settler, a garrison flag for its building. */
export type DoorMarkerHit =
  | { readonly kind: 'settler'; readonly ref: number }
  | { readonly kind: 'building'; readonly ref: number };

export interface ClickHitDeps {
  readonly doorBadges?: () => readonly DoorBadge[];
  readonly targets: Pick<UnitTargets, 'owned' | 'flags' | 'signposts'> & SelectionHitTargets;
  readonly viewer: ViewerSeat;
  readonly elevation?: ElevationField;
}

export interface ClickHits {
  readonly doorMarkerAt: (wx: number, wy: number) => DoorMarkerHit | null;
  readonly hasSelectableAt: (wx: number, wy: number) => boolean;
  readonly selectionAt: (wx: number, wy: number) => number | null;
}

/**
 * The order a click resolves what it landed on: a door marker, then a settler or drop-off flag, then
 * a building, then a palisade segment or gate, then an owned vehicle, then a signpost. Sign rows and garrison
 * flags are small intentional targets that a building's larger sprite would otherwise swallow. A vehicle
 * comes after the units and houses: its crew standing beside it, and a house its sprite overlaps, must stay
 * clickable. A road plot is smaller than all of them: under the cursor it outranks everything but a door
 * marker and a unit standing on it or in front of it.
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
  const unitAt = (wx: number, wy: number): Pickable | null => {
    const flag = topTargetAt(deps.targets.flags(), wx, wy);
    const settler = topTargetAt(deps.targets.owned('settler'), wx, wy);
    if (flag === null) return settler;
    return settler !== null && drawnInFront(settler, flag) ? settler : flag;
  };

  /** A unit standing on the road plot under the cursor, or in front of it, covers it; one behind it does
   *  not. */
  const unitOrPlotAt = (wx: number, wy: number): number | null => {
    const unit = unitAt(wx, wy);
    const plot = topTargetAt(deps.targets.owned('roadsite'), wx, wy);
    if (plot === null) return unit?.ref ?? null;
    return unit !== null && unit.y >= plot.y ? unit.ref : plot.ref;
  };

  return {
    doorMarkerAt,
    hasSelectableAt: (wx, wy) =>
      doorMarkerAt(wx, wy) !== null ||
      deps.targets.hasFlagAt(wx, wy) ||
      deps.targets.hasOwnedAt(wx, wy) ||
      deps.targets.hasSignpostAt(wx, wy),
    selectionAt: (wx, wy) =>
      doorMarkerAt(wx, wy)?.ref ??
      unitOrPlotAt(wx, wy) ??
      pickTopAt(deps.targets.owned('building'), wx, wy) ??
      pickTopAt(deps.targets.owned('palisade'), wx, wy) ??
      pickTopAt(deps.targets.owned('vehicle'), wx, wy) ??
      pickTopAt(deps.targets.signposts(), wx, wy),
  };
}
