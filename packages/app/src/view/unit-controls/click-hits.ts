import type { DoorBadge, ElevationField } from '@open-northland/render';
import { pickDoorBadgeRow, pickGarrisonFlag, pickTopAt } from '../picking.js';
import type { UnitTargets } from './unit-targets.js';

/** A door marker's click owner: a sign row stands for its settler, a garrison flag for its building. */
export type DoorMarkerHit =
  | { readonly kind: 'settler'; readonly ref: number }
  | { readonly kind: 'building'; readonly ref: number };

export interface ClickHitDeps {
  readonly doorBadges?: () => readonly DoorBadge[];
  readonly targets: Pick<UnitTargets, 'owned' | 'flags' | 'signposts'>;
  readonly humanPlayer: number;
  readonly observer: boolean;
  readonly elevation?: ElevationField;
}

export interface ClickHits {
  readonly doorMarkerAt: (wx: number, wy: number) => DoorMarkerHit | null;
  readonly selectionAt: (wx: number, wy: number) => number | null;
}

/**
 * The order a click resolves what it landed on. Markers beat ordinary units and buildings: flags and
 * sign rows are small intentional targets, while a building's larger sprite may overlap them.
 */
export function createClickHits(deps: ClickHitDeps): ClickHits {
  /** An enemy building's markers are not selection proxies for the men behind them. */
  const clickableBadges = (): readonly DoorBadge[] => {
    const badges = deps.doorBadges?.() ?? [];
    if (deps.observer) return badges;
    return badges.filter((b) => b.player === deps.humanPlayer);
  };

  const doorMarkerAt = (wx: number, wy: number): DoorMarkerHit | null => {
    const badges = clickableBadges();
    const settler = pickDoorBadgeRow(badges, wx, wy, deps.elevation);
    if (settler !== null) return { kind: 'settler', ref: settler };
    const building = pickGarrisonFlag(badges, wx, wy, deps.elevation);
    return building === null ? null : { kind: 'building', ref: building };
  };

  return {
    doorMarkerAt,
    selectionAt: (wx, wy) =>
      doorMarkerAt(wx, wy)?.ref ??
      pickTopAt(deps.targets.flags(), wx, wy) ??
      pickTopAt(deps.targets.owned(), wx, wy) ??
      pickTopAt(deps.targets.signposts(), wx, wy),
  };
}
