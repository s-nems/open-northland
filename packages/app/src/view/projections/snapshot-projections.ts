import {
  buildHud,
  emptyHud,
  fogTileVisible,
  type HudLayout,
  type HudModel,
  layoutHud,
  ONE,
} from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import type { WorkerRole } from '../../game/sandbox/index.js';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import { computeConstructionSigns } from './construction-signs.js';
import { type BuildingDoorInfoOf, computeDoorBadges } from './door-badges.js';
import type { FogGates } from './fog-gates.js';
import { hudLabels } from './hud-labels.js';
import { computeLifeHearts, type LifeHeartInputs } from './life-hearts.js';
import { computeSettlerBubbles } from './settler-bubbles.js';

/**
 * Memoize a projection per snapshot instance, so an O(entities) read runs once per tick and not once
 * per frame. `versionOf` additionally keys the memo on caller state outside the snapshot. Keyed weakly,
 * so a consumer that stops pulling releases the snapshot it last read.
 */
export function memoBySnapshot<T>(
  build: (snapshot: WorldSnapshot) => T,
  versionOf?: () => number,
): (snapshot: WorldSnapshot) => T {
  const memo = new WeakMap<WorldSnapshot, { version: number; value: T }>();
  return (snapshot) => {
    const version = versionOf?.() ?? 0;
    const hit = memo.get(snapshot);
    if (hit !== undefined && hit.version === version) return hit.value;
    const value = build(snapshot);
    memo.set(snapshot, { version, value });
    return value;
  };
}

/** The live selection the heart projection reads, paired with its memo key. */
export interface HeartSelection {
  readonly ids: () => ReadonlySet<number>;
  readonly version: () => number;
}

/** {@link LifeHeartInputs} as the factory takes it: the selection arrives live, not as a frozen set. */
export interface HeartProjectionInputs extends Omit<LifeHeartInputs, 'selected'> {
  readonly selection?: HeartSelection | undefined;
}

/** The snapshot read projections the frame loop shares across HUD/render consumers; `viewer` is the
 *  seat the HUD aggregates count for, and `seatNameOf` names it in the panel header. */
export function createSnapshotProjections(
  viewer: ViewerSeat,
  buildingInfoOf: BuildingDoorInfoOf,
  roleOf: (jobType: number) => WorkerRole,
  fogGates: FogGates,
  hearts: HeartProjectionInputs,
  seatNameOf?: (player: number) => string | undefined,
): {
  /** The panel's own aggregates, shared with any consumer needing a figure rather than its layout. */
  readonly hudModelFor: (snapshot: WorldSnapshot) => HudModel;
  readonly hudFor: (snapshot: WorldSnapshot) => HudLayout;
  readonly doorBadgesFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeDoorBadges>;
  readonly constructionSignsFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeConstructionSigns>;
  readonly settlerBubblesFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeSettlerBubbles>;
  readonly lifeHeartsFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeLifeHearts>;
} {
  // Keyed on the viewer too: a spectator switching seats under a paused sim holds one snapshot, and
  // the fog is the viewer's, so every fog-filtered memo keys on it as well.
  const viewerVersion = (): number => viewer.version();
  const hudModelFor = memoBySnapshot((snapshot: WorldSnapshot) => {
    const seat = viewer.seat();
    return seat === null ? emptyHud(snapshot.tick) : buildHud(snapshot, seat);
  }, viewerVersion);
  const heartsMemo = (): ((snapshot: WorldSnapshot) => ReturnType<typeof computeLifeHearts>) =>
    memoBySnapshot(
      (snapshot) => {
        const list = computeLifeHearts(snapshot, {
          isLivestockTribe: hearts.isLivestockTribe,
          playerColourOf: hearts.playerColourOf,
          selected: hearts.selection?.ids(),
        });
        const fog = fogGates.current();
        return fog === null ? list : list.filter((h) => fogTileVisible(fog, h.x / ONE, h.y / ONE));
      },
      () => hearts.selection?.version() ?? 0,
    );
  // The hearts key on the selection; a seat switch, rare beside a pick, replaces the memo instead.
  let heartsViewer = viewer.version();
  let lifeHearts = heartsMemo();
  return {
    hudModelFor,
    hudFor: memoBySnapshot(
      (snapshot) => layoutHud(hudModelFor(snapshot), hudLabels(seatNameOf)),
      viewerVersion,
    ),
    doorBadgesFor: memoBySnapshot((snapshot) => {
      const badges = computeDoorBadges(snapshot, buildingInfoOf, roleOf);
      const fog = fogGates.current();
      return fog === null
        ? badges
        : badges.filter((badge) => fogTileVisible(fog, badge.x / ONE, badge.y / ONE));
    }, viewerVersion),
    constructionSignsFor: memoBySnapshot((snapshot) => {
      const signs = computeConstructionSigns(snapshot, buildingInfoOf);
      const fog = fogGates.current();
      return fog === null ? signs : signs.filter((sign) => fogTileVisible(fog, sign.x / ONE, sign.y / ONE));
    }, viewerVersion),
    settlerBubblesFor: memoBySnapshot((snapshot) => {
      const bubbles = computeSettlerBubbles(snapshot);
      const fog = fogGates.current();
      return fog === null ? bubbles : bubbles.filter((b) => fogTileVisible(fog, b.x / ONE, b.y / ONE));
    }, viewerVersion),
    lifeHeartsFor: (snapshot) => {
      if (viewer.version() !== heartsViewer) {
        heartsViewer = viewer.version();
        lifeHearts = heartsMemo();
      }
      return lifeHearts(snapshot);
    },
  };
}
