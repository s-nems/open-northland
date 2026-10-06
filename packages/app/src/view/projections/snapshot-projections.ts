import {
  buildHud,
  emptyHud,
  fogTileVisible,
  type HudLayout,
  type HudModel,
  layoutHud,
  ONE,
} from '@open-northland/render';
import { anchorTileBox, type Viewport } from '@open-northland/render/data';
import type { SignpostReachView } from '@open-northland/sim';
import { TILE_BUCKET_SIZE, type TileBox, type WorldSnapshot } from '@open-northland/sim';
import type { WorkerRole } from '../../game/sandbox/index.js';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import { computeConstructionSigns } from './construction-signs.js';
import { type BuildingDoorInfoOf, computeDoorBadges, type DoorBadgeCache } from './door-badges.js';
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

/** The candidate box of a mark over the sprites' cull `viewport`: every tile whose anchor can land in it,
 *  grown to whole position-index buckets so a scroll inside them keeps the memo. */
function markTileBox(viewport: Viewport): TileBox {
  const box = anchorTileBox(viewport);
  return {
    minX: Math.floor(box.minX / TILE_BUCKET_SIZE) * TILE_BUCKET_SIZE,
    minY: Math.floor(box.minY / TILE_BUCKET_SIZE) * TILE_BUCKET_SIZE,
    maxX: Math.ceil(box.maxX / TILE_BUCKET_SIZE) * TILE_BUCKET_SIZE,
    maxY: Math.ceil(box.maxY / TILE_BUCKET_SIZE) * TILE_BUCKET_SIZE,
  };
}

function sameBox(a: TileBox | undefined, b: TileBox | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

/** {@link memoBySnapshot} for a mark projection that reads only the units under the screen: keyed on the
 *  candidate box too, and no viewport reads the whole map. */
function memoByScreen<T>(
  build: (snapshot: WorldSnapshot, box: TileBox | undefined) => T,
  versionOf: () => number,
): (snapshot: WorldSnapshot, viewport?: Viewport) => T {
  const memo = new WeakMap<WorldSnapshot, { version: number; box: TileBox | undefined; value: T }>();
  return (snapshot, viewport) => {
    const version = versionOf();
    const box = viewport === undefined ? undefined : markTileBox(viewport);
    const hit = memo.get(snapshot);
    if (hit !== undefined && hit.version === version && sameBox(hit.box, box)) return hit.value;
    const value = build(snapshot, box);
    memo.set(snapshot, { version, box, value });
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
  signpostReach?: (player: number) => SignpostReachView | null,
  inventoryVersion?: () => number,
): {
  /** The panel's own aggregates, shared with any consumer needing a figure rather than its layout. */
  readonly hudModelFor: (snapshot: WorldSnapshot) => HudModel;
  readonly hudFor: (snapshot: WorldSnapshot) => HudLayout;
  /** `viewport` is the sprites' cull box: only buildings whose badges can draw there are read. */
  readonly doorBadgesFor: (
    snapshot: WorldSnapshot,
    viewport?: Viewport,
  ) => ReturnType<typeof computeDoorBadges>;
  readonly constructionSignsFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeConstructionSigns>;
  readonly settlerBubblesFor: (snapshot: WorldSnapshot) => ReturnType<typeof computeSettlerBubbles>;
  readonly lifeHeartsFor: (
    snapshot: WorldSnapshot,
    viewport?: Viewport,
  ) => ReturnType<typeof computeLifeHearts>;
} {
  // Keyed on the viewer too: a spectator switching seats under a paused sim holds one snapshot, and
  // the fog is the viewer's, so every fog-filtered memo keys on it as well.
  const viewerVersion = (): number => {
    const seat = viewer.seat();
    if (seat !== null) signpostReach?.(seat);
    return viewer.version() + (inventoryVersion?.() ?? 0);
  };
  const hudModelFor = memoBySnapshot((snapshot: WorldSnapshot) => {
    const seat = viewer.seat();
    if (seat === null) return emptyHud(snapshot.tick);
    return buildHud(snapshot, seat, signpostReach?.(seat));
  }, viewerVersion);
  const heartsMemo = (): ((
    snapshot: WorldSnapshot,
    viewport?: Viewport,
  ) => ReturnType<typeof computeLifeHearts>) =>
    memoByScreen(
      (snapshot, box) => {
        const list = computeLifeHearts(
          snapshot,
          {
            isLivestockTribe: hearts.isLivestockTribe,
            playerColourOf: hearts.playerColourOf,
            selected: hearts.selection?.ids(),
          },
          box,
        );
        const fog = fogGates.current();
        return fog === null ? list : list.filter((h) => fogTileVisible(fog, h.x / ONE, h.y / ONE));
      },
      () => hearts.selection?.version() ?? 0,
    );
  // The hearts key on the selection; a seat switch, rare beside a pick, replaces the memo instead.
  let heartsViewer = viewer.version();
  let lifeHearts = heartsMemo();
  const doorBadges: DoorBadgeCache = { held: new Map() };
  return {
    hudModelFor,
    hudFor: memoBySnapshot(
      (snapshot) => layoutHud(hudModelFor(snapshot), hudLabels(seatNameOf)),
      viewerVersion,
    ),
    doorBadgesFor: memoByScreen((snapshot, box) => {
      const badges = computeDoorBadges(snapshot, buildingInfoOf, roleOf, box, doorBadges);
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
    lifeHeartsFor: (snapshot, viewport) => {
      if (viewer.version() !== heartsViewer) {
        heartsViewer = viewer.version();
        lifeHearts = heartsMemo();
      }
      return lifeHearts(snapshot, viewport);
    },
  };
}
