import { buildHud, fogTileVisible, type HudLayout, layoutHud, ONE } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { HUD_TRIBE } from '../../game/rules.js';
import type { WorkerRole } from '../../game/sandbox/index.js';
import { type BuildingDoorInfo, computeDoorBadges } from './door-badges.js';
import type { FogGates } from './fog-gates.js';
import { hudLabels } from './hud-labels.js';

/** Memoize a snapshot projection while the simulation returns the same immutable snapshot instance. */
function memoBySnapshot<T>(build: (snapshot: WorldSnapshot) => T): (snapshot: WorldSnapshot) => T {
  let memo: { snapshot: WorldSnapshot; value: T } | null = null;
  return (snapshot) => {
    if (memo === null || memo.snapshot !== snapshot) memo = { snapshot, value: build(snapshot) };
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
  };
}
