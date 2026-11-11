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
  readonly targets: Pick<UnitTargets, 'owned' | 'signposts'> & SelectionHitTargets;
  readonly viewer: ViewerSeat;
  readonly elevation?: ElevationField;
}

/** The settler a sign row or a work flag under the point stands for; `covered` while a unit drawn in
 *  front of the marker takes the click instead. */
export interface SettlerProxy {
  readonly ref: number;
  readonly covered: boolean;
}

export interface ClickHits {
  readonly doorMarkerAt: (wx: number, wy: number) => DoorMarkerHit | null;
  readonly hasSelectableAt: (wx: number, wy: number) => boolean;
  readonly selectionAt: (wx: number, wy: number) => number | null;
  /** The settler a sign row or a work flag under the point stands for; null on the settler itself, a
   *  garrison flag or anything else. */
  readonly settlerProxyAt: (wx: number, wy: number) => SettlerProxy | null;
}

/**
 * The order a click resolves what it landed on: a door marker, then a settler or drop-off flag, then
 * a building, then a palisade segment or gate, then an owned vehicle, then a signpost. Sign rows and garrison
 * flags are small intentional targets that a building's larger sprite would otherwise swallow, yet a unit
 * standing in front of the house draws over its marker and takes the click. A vehicle
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

  /**
   * A drop-off flag stands for its gatherer, and a claimed wall or road site's flag for its builder; either
   * outranks every building. It ties with a settler, and the one drawn in front takes the click. The original's world pick resolves a hit on a human's
   * work-centre marker to that human at the rank humans hold, above houses and signposts, and the later
   * hit of its front-to-back scan wins among equal ranks.
   */
  const unitAt = (wx: number, wy: number): Pickable | null => {
    const flag = deps.targets.flagAt(wx, wy);
    const settler = deps.targets.ownSettlerAt(wx, wy);
    if (flag === null) return settler;
    return settler !== null && drawnInFront(settler, flag) ? settler : flag;
  };

  /** The door marker under the point, and whether a unit drawn in front of it covers it. */
  const markerAt = (wx: number, wy: number): { hit: DoorMarkerHit; covered: boolean } | null => {
    const badges = clickableBadges();
    const row = pickDoorBadgeRow(badges, wx, wy, deps.elevation);
    const flag = row === null ? pickGarrisonFlag(badges, wx, wy, deps.elevation) : null;
    const marker = row ?? flag;
    if (marker === null) return null;
    // The marker's stack draws just over its building, so a unit with its feet on the building's row or
    // further down draws over it.
    const unit = unitAt(wx, wy);
    const hit: DoorMarkerHit =
      row !== null ? { kind: 'settler', ref: row.ref } : { kind: 'building', ref: marker.ref };
    return { hit, covered: unit !== null && unit.y >= marker.depthY };
  };

  const doorMarkerAt = (wx: number, wy: number): DoorMarkerHit | null => {
    const marker = markerAt(wx, wy);
    return marker === null || marker.covered ? null : marker.hit;
  };

  /** A unit standing on the road plot under the cursor, or in front of it, covers it; one behind it does
   *  not. */
  const unitOrPlotAt = (wx: number, wy: number): number | null => {
    const unit = unitAt(wx, wy);
    const plot = topTargetAt(deps.targets.owned('roadsite'), wx, wy);
    if (plot === null) return unit?.ref ?? null;
    return unit !== null && unit.y >= plot.y ? unit.ref : plot.ref;
  };

  const settlerProxyAt = (wx: number, wy: number): SettlerProxy | null => {
    const marker = markerAt(wx, wy);
    if (marker !== null)
      return marker.hit.kind === 'settler' ? { ref: marker.hit.ref, covered: marker.covered } : null;
    const flag = deps.targets.flagAt(wx, wy);
    if (flag === null) return null;
    const settler = deps.targets.ownSettlerAt(wx, wy);
    return { ref: flag.ref, covered: settler !== null && drawnInFront(settler, flag) };
  };

  return {
    doorMarkerAt,
    settlerProxyAt,
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
