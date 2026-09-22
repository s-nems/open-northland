import type { UiCue } from '@open-northland/audio';
import { type BuildingType, type ContentSet, lastByTypeId } from '@open-northland/data';
import type { BuildingHighlightItem } from '@open-northland/render';
import type { Entity, PlayerCommand, WorldSnapshot } from '@open-northland/sim';
import { clampTile, nodeBounds, pickTopAt, type Tile } from '../picking.js';
import { memoBySnapshot } from '../projections/index.js';
import {
  computeAssignHighlight,
  computeHouseHighlight,
  drillPick,
  houseAssignableAt,
  sitePick,
  tradeHousePick,
  workerGroupAt,
} from './highlights/index.js';
import type { UnitOrderController } from './orders.js';
import type { UnitTargets } from './unit-targets.js';

/**
 * Arming one mode replaces whatever was armed; a click of any kind, Esc, or a selection change resolves
 * or cancels it. The map overview is the one surface that can leave a mode armed: it cannot name the
 * unit or building a picked-target mode wants. Every mode carries the settlers it orders, the ones that
 * allowed the order when it was armed, so a mixed selection's order skips the rest.
 */
export type PickMode =
  | { readonly kind: BuildingPickKind; readonly settlers: readonly number[] }
  | { readonly kind: ScoutPickKind; readonly scout: number }
  | { readonly kind: SpotPickKind; readonly units: readonly number[] }
  | { readonly kind: StrikePickKind; readonly units: readonly number[] };

/** The orders one scout resolves by clicking a spot on the map. */
type ScoutPickKind = 'signpost' | 'explore';

/** The orders that resolve by clicking one of the player's own buildings. */
export type BuildingPickKind = 'workplace' | 'home' | 'building-site' | 'learning-place' | 'trade-house';

/** The selection-wide orders that resolve against a spot on the ground. */
type SpotPickKind = 'destination' | 'work-area' | 'attack-move';

/** The selection-wide orders that resolve against the unit or building drawn under the cursor. */
type StrikePickKind = 'attack-settler' | 'attack-building' | 'attack-animal';

/** A mode whose target is a spot, so any surface that names one - the world view or the map overview -
 *  can resolve it. */
type SpotMode = Extract<PickMode, { readonly kind: SpotPickKind | ScoutPickKind }>;

interface BuildingPick {
  readonly highlight: (
    snapshot: WorldSnapshot,
    settlers: readonly number[],
    byType: ReadonlyMap<number, BuildingType>,
  ) => BuildingHighlightItem[];
  /** The orders a click on `building` issues, empty when that building refuses every settler. */
  readonly orders: (
    snapshot: WorldSnapshot,
    settlers: readonly number[],
    building: number,
    byType: ReadonlyMap<number, BuildingType>,
  ) => PlayerCommand[];
}

/**
 * The capacity-bound placements go out as one group order, so the sim seats unplaced members first at
 * the tick it applies them: a quick second click then places the rest, even before the snapshot shows
 * the first click's result. The unbounded ones issue one order per accepted settler.
 */
const BUILDING_PICKS: Readonly<Record<BuildingPickKind, BuildingPick>> = {
  workplace: {
    highlight: computeAssignHighlight,
    // This mode places each settler's current trade only; it never re-trades.
    orders: (snapshot, settlers, building, byType) => {
      const workers = workerGroupAt(snapshot, building, settlers, byType);
      return workers === null ? [] : [{ kind: 'assignWorkerGroup', building: building as Entity, workers }];
    },
  },
  home: {
    highlight: computeHouseHighlight,
    orders: (snapshot, settlers, building, byType) =>
      houseAssignableAt(snapshot, building, settlers, byType)
        ? [
            {
              kind: 'assignHouseGroup',
              entities: settlers.map((e) => e as Entity),
              house: building as Entity,
            },
          ]
        : [],
  },
  'building-site': {
    highlight: sitePick.highlight,
    orders: (snapshot, settlers, building, byType) =>
      settlers
        .filter((settler) => sitePick.assignableAt(snapshot, building, settler, byType))
        .map((settler) => ({ kind: 'assignBuilder', entity: settler as Entity, site: building as Entity })),
  },
  // The one building pick that reaches beyond the player's own houses: a trader's exchange happens at
  // another tribe's house, so every standing house lights up but the ones already on the route.
  'trade-house': {
    highlight: (snapshot, settlers) => tradeHousePick.highlight(snapshot, settlers),
    orders: (snapshot, settlers, building) =>
      settlers
        .filter((settler) => tradeHousePick.assignableAt(snapshot, building, settler))
        .map((settler) => ({
          kind: 'attachTradeHouse',
          entity: settler as Entity,
          house: building as Entity,
        })),
  },
  'learning-place': {
    highlight: drillPick.highlight,
    orders: (snapshot, settlers, building, byType) =>
      settlers
        .filter((settler) => drillPick.assignableAt(snapshot, building, settler, byType))
        .map((settler) => ({ kind: 'trainSoldier', entity: settler as Entity, house: building as Entity })),
  },
};

const isBuildingPick = (mode: PickMode): mode is Extract<PickMode, { readonly kind: BuildingPickKind }> =>
  'settlers' in mode;

const SPOT_MODES: ReadonlySet<PickMode['kind']> = new Set<SpotPickKind | ScoutPickKind>([
  'destination',
  'work-area',
  'attack-move',
  'signpost',
  'explore',
]);

const isSpotMode = (mode: PickMode): mode is SpotMode => SPOT_MODES.has(mode.kind);

/** Modes whose target is a point or a unit rather than a lit building, so the cursor carries the prompt. */
const CROSSHAIR_MODES: ReadonlySet<PickMode['kind']> = new Set<SpotPickKind | StrikePickKind | ScoutPickKind>(
  [
    'destination',
    'work-area',
    'attack-move',
    'attack-settler',
    'attack-building',
    'attack-animal',
    'explore',
  ],
);

export interface PickModeDeps {
  readonly snapshot: () => WorldSnapshot;
  readonly targets: UnitTargets;
  readonly content: ContentSet;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** The half-cell node a click on the world view names. */
  readonly nodeAt: (clientX: number, clientY: number) => Tile;
  readonly enqueue: (command: PlayerCommand) => void;
  /** The order controller owns every selection-wide order, so a walk fans a group out through the same
   *  formation spread whether it was armed here or right-clicked. Read at click time: it is built after
   *  this controller. */
  readonly orders: () => UnitOrderController;
  /** Named addition: the original signals an armed mode with prompt text, not a cursor. */
  readonly setArmedCursor: (armed: boolean) => void;
}

/**
 * What a press did to an armed mode, for the caller's click feedback: `ordered` placed the order,
 * `missed` found no target under the press (approximation: the original keeps its tool armed after a
 * miss, this drops it), `calledOff` was any other button. Null when no mode was armed.
 */
export type PickPress = 'ordered' | 'missed' | 'calledOff';

/** The GUI click a pick press answers with: an order confirms, a call-off fails, a miss is silent. */
export function pickPressCue(press: PickPress): UiCue | null {
  switch (press) {
    case 'ordered':
      return 'confirm';
    case 'calledOff':
      return 'fail';
    case 'missed':
      return null;
    default: {
      const unreachable: never = press;
      return unreachable;
    }
  }
}

export interface PickModeController {
  arm(mode: PickMode): void;
  cancel(): void;
  isArmed(): boolean;
  signpostActive(): boolean;
  /** Non-null when a mode was armed: the press resolved or cancelled it, so the caller must not fall
   *  through to selection or an order. */
  handleMouseDown(event: MouseEvent): PickPress | null;
  /** A press on the map overview, which names the node `target` and nothing drawn there. A spot-target
   *  mode resolves; one that needs a picked unit or building stays armed, so scrolling the overview to
   *  find that target does not call it off. Non-null when the armed mode took the press. */
  handleOverviewPress(button: number, target: Tile): PickPress | null;
  highlight(): readonly BuildingHighlightItem[] | null;
}

export function createPickModeController(deps: PickModeDeps): PickModeController {
  const buildingsByType = lastByTypeId(deps.content.buildings);
  let pickMode: PickMode | null = null;
  let pickVersion = 0;
  const setMode = (next: PickMode | null): void => {
    pickMode = next;
    pickVersion++;
    deps.setArmedCursor(next !== null && CROSSHAIR_MODES.has(next.kind));
  };
  const cancel = (): void => setMode(null);

  const resolveBuilding = (
    event: MouseEvent,
    kind: BuildingPickKind,
    settlers: readonly number[],
  ): boolean => {
    const w = deps.toWorld(event.clientX, event.clientY);
    const candidates = kind === 'trade-house' ? deps.targets.buildings() : deps.targets.owned('building');
    const building = pickTopAt(candidates, w.x, w.y);
    if (building === null) return false;
    const orders = BUILDING_PICKS[kind].orders(deps.snapshot(), settlers, building, buildingsByType);
    for (const order of orders) deps.enqueue(order);
    return orders.length > 0;
  };

  const resolveSpot = (mode: SpotMode, named: Tile): boolean => {
    const { width, height } = nodeBounds(deps.mapSize);
    const target = clampTile(named, width, height);
    switch (mode.kind) {
      case 'destination':
        return deps.orders().issueMoveTo(target, mode.units);
      case 'work-area':
        return deps.orders().issueSetWorkFlag(target, mode.units);
      case 'attack-move':
        return deps.orders().issueAttackMove(target, mode.units);
      // Named deviation from the observed original, which erects with a right-click on lit ground: this
      // places with a left-click and dims blocked ground, matching build placement.
      case 'signpost':
        deps.enqueue({
          kind: 'placeSignpost',
          entity: mode.scout as Entity,
          x: target.col,
          y: target.row,
        });
        return true;
      // The explore order centres the scout's sweep on the named spot, as the original does.
      case 'explore':
        deps.enqueue({
          kind: 'exploreArea',
          entity: mode.scout as Entity,
          x: target.col,
          y: target.row,
        });
        return true;
      default: {
        const unreachable: never = mode;
        throw new Error(`unhandled spot pick mode: ${JSON.stringify(unreachable)}`);
      }
    }
  };

  const resolvePicked = (mode: Exclude<PickMode, SpotMode>, event: MouseEvent): boolean => {
    switch (mode.kind) {
      case 'workplace':
      case 'home':
      case 'building-site':
      case 'learning-place':
      case 'trade-house':
        return resolveBuilding(event, mode.kind, mode.settlers);
      case 'attack-settler':
        return deps.orders().issueAttackTarget(event, 'settler', mode.units);
      case 'attack-building':
        return deps.orders().issueAttackTarget(event, 'building', mode.units);
      case 'attack-animal':
        return deps.orders().issueAttackAnimal(event, mode.units);
      default: {
        const unreachable: never = mode;
        throw new Error(`unhandled pick mode: ${JSON.stringify(unreachable)}`);
      }
    }
  };

  const pressOutcome = (ordered: boolean): PickPress => (ordered ? 'ordered' : 'missed');

  const handleMouseDown = (event: MouseEvent): PickPress | null => {
    const mode = pickMode;
    if (mode === null) return null;
    // A selection change cancels any armed mode, so the selection read at click time is still the one
    // this mode was armed for.
    cancel();
    if (event.button !== 0) return 'calledOff'; // any other button just calls the mode off
    if (isSpotMode(mode)) return pressOutcome(resolveSpot(mode, deps.nodeAt(event.clientX, event.clientY)));
    return pressOutcome(resolvePicked(mode, event));
  };

  const handleOverviewPress = (button: number, target: Tile): PickPress | null => {
    const mode = pickMode;
    if (mode === null) return null;
    if (button !== 0) {
      cancel(); // any other button just calls the mode off
      return 'calledOff';
    }
    if (!isSpotMode(mode)) return null;
    cancel();
    return pressOutcome(resolveSpot(mode, target));
  };

  /** Read every frame, so the O(entities) pass is memoized on everything it reads: the snapshot instance
   *  plus `pickVersion`, which every arm and cancel bumps. */
  const highlightFor = memoBySnapshot(
    (snapshot: WorldSnapshot) => {
      const mode = pickMode;
      // Only the building picks light targets up; the rest show on the ground or the cursor.
      if (mode === null || !isBuildingPick(mode)) return null;
      return BUILDING_PICKS[mode.kind].highlight(snapshot, mode.settlers, buildingsByType);
    },
    () => pickVersion,
  );

  return {
    arm: setMode,
    cancel,
    isArmed: () => pickMode !== null,
    signpostActive: () => pickMode?.kind === 'signpost',
    handleMouseDown,
    handleOverviewPress,
    highlight: () => highlightFor(deps.snapshot()),
  };
}
