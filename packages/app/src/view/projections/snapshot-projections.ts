import { buildHud, fogTileVisible, type HudLayout, layoutHud, ONE } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { HUD_TRIBE } from '../../game/rules.js';
import type { WorkerRole } from '../../game/sandbox/index.js';
import { type BuildingDoorInfo, computeDoorBadges } from './door-badges.js';
import type { FogGates } from './fog-gates.js';
import { hudLabels } from './hud-labels.js';
import { computeSettlerBubbles } from './settler-bubbles.js';

/**
 * Memoize a snapshot projection while the simulation returns the same memoized snapshot instance, so an
 * O(entities) read runs once per tick, not once per RAF frame. `versionOf` additionally keys the memo on
 * caller state outside the snapshot (a counter bumped on change); omit it for a projection of the
 * snapshot alone.
 */
export function memoBySnapshot<T>(
  build: (snapshot: WorldSnapshot) => T,
  versionOf?: () => number,
): (snapshot: WorldSnapshot) => T {
  let memo: { snapshot: WorldSnapshot; version: number; value: T } | null = null;
  return (snapshot) => {
    const version = versionOf?.() ?? 0;
    if (memo === null || memo.snapshot !== snapshot || memo.version !== version)
      memo = { snapshot, version, value: build(snapshot) };
    return memo.value;
  };
}

/** The two O(entities) read projections the frame loop shares across HUD/render consumers. */
export function createSnapshotProjections(
  buildingsByType: ReadonlyMap<number, BuildingDoorInfo>,
  roleOf: (jobType: number) => WorkerRole,
  fogGates: FogGates,
): {
  readonly hudFor: (snapshot: WorldSnapshot) => HudLayout;
  readonly doorBadgesFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeDoorBadges>;
  readonly settlerBubblesFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeSettlerBubbles>;
} {
  return {
    hudFor: memoBySnapshot((snapshot) => layoutHud(buildHud(snapshot, HUD_TRIBE), hudLabels())),
    doorBadgesFor: memoBySnapshot((snapshot) => {
      const badges = computeDoorBadges(snapshot, buildingsByType, roleOf);
      const fog = fogGates.current();
      return fog === null
        ? badges
        : badges.filter((badge) => fogTileVisible(fog, badge.x / ONE, badge.y / ONE));
    }),
    settlerBubblesFor: memoBySnapshot((snapshot) => {
      const bubbles = computeSettlerBubbles(snapshot);
      const fog = fogGates.current();
      return fog === null ? bubbles : bubbles.filter((b) => fogTileVisible(fog, b.x / ONE, b.y / ONE));
    }),
  };
}
