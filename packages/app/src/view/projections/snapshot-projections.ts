import { buildHud, fogTileVisible, type HudLayout, layoutHud, ONE } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { HUD_TRIBE } from '../../game/rules.js';
import type { WorkerRole } from '../../game/sandbox/index.js';
import { computeConstructionSigns } from './construction-signs.js';
import { type BuildingDoorInfo, computeDoorBadges } from './door-badges.js';
import type { FogGates } from './fog-gates.js';
import { hudLabels } from './hud-labels.js';
import { computeLifeHearts, type LifeHeartInputs } from './life-hearts.js';
import { computeSettlerBubbles } from './settler-bubbles.js';

/**
 * Memoize a snapshot projection while the simulation returns the same memoized snapshot instance, so an
 * O(entities) read runs once per tick, not once per RAF frame. `versionOf` additionally keys the memo on
 * caller state outside the snapshot (a counter bumped on change); omit it for a projection of the
 * snapshot alone. Keyed weakly, so a consumer that stops pulling (a closed stats window) releases the
 * snapshot it last read instead of pinning it for the session.
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

/** The snapshot read projections the frame loop shares across HUD/render consumers. */
export function createSnapshotProjections(
  buildingsByType: ReadonlyMap<number, BuildingDoorInfo>,
  roleOf: (jobType: number) => WorkerRole,
  fogGates: FogGates,
  hearts: HeartProjectionInputs,
): {
  readonly hudFor: (snapshot: WorldSnapshot) => HudLayout;
  readonly doorBadgesFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeDoorBadges>;
  readonly constructionSignsFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeConstructionSigns>;
  readonly settlerBubblesFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeSettlerBubbles>;
  readonly lifeHeartsFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeLifeHearts>;
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
    constructionSignsFor: memoBySnapshot((snapshot) => {
      const signs = computeConstructionSigns(snapshot, buildingsByType);
      const fog = fogGates.current();
      return fog === null ? signs : signs.filter((sign) => fogTileVisible(fog, sign.x / ONE, sign.y / ONE));
    }),
    settlerBubblesFor: memoBySnapshot((snapshot) => {
      const bubbles = computeSettlerBubbles(snapshot);
      const fog = fogGates.current();
      return fog === null ? bubbles : bubbles.filter((b) => fogTileVisible(fog, b.x / ONE, b.y / ONE));
    }),
    lifeHeartsFor: memoBySnapshot(
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
    ),
  };
}
